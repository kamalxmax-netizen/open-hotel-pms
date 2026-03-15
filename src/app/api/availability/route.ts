import { NextRequest, NextResponse } from "next/server";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { listNights, isValidDateString } from "@/lib/dates";
import { expandPlannedMoveNights, listOverlappingPlannedRoomHolds } from "@/lib/planned-room-moves";

// GET /api/availability?checkin=YYYY-MM-DD&checkout=YYYY-MM-DD
// Returns per-room-type availability count, rate/night, and total for stay
export async function GET(request: NextRequest) {
    const checkin = request.nextUrl.searchParams.get("checkin");
    const checkout = request.nextUrl.searchParams.get("checkout");

    if (!checkin || !checkout) {
        return NextResponse.json({ error: "checkin and checkout required" }, { status: 400 });
    }
    if (!isValidDateString(checkin) || !isValidDateString(checkout)) {
        return NextResponse.json({ error: "Invalid date format. Use YYYY-MM-DD." }, { status: 400 });
    }
    if (checkout <= checkin) {
        return NextResponse.json({ error: "checkout must be after checkin" }, { status: 400 });
    }

    const nights = listNights(checkin, checkout);
    const supabase = createServerSupabaseClient();

    // 1. All sellable overnight rooms with type (exclude day-use inventory)
    const { data: rooms, error: roomsErr } = await supabase
        .from("rooms")
        .select("id, room_type_id, room_number")
        .eq("is_sellable", true)
        .eq("is_dayuse", false);
    if (roomsErr) return NextResponse.json({ error: roomsErr.message }, { status: 500 });

    // 2. Count sellable overnight rooms per type
    const totalByType: Record<number, number> = {};
    const roomIdsByType: Record<number, string[]> = {};
    const roomMetaById = new Map<string, { room_type_id: number }>();
    for (const r of rooms ?? []) {
        const tid = r.room_type_id as number;
        totalByType[tid] = (totalByType[tid] ?? 0) + 1;
        if (!roomIdsByType[tid]) roomIdsByType[tid] = [];
        roomIdsByType[tid].push(r.id);
        roomMetaById.set(String(r.id), { room_type_id: Number(r.room_type_id) });
    }

    // 3. OOO blocks active during stay (per-night)
    const { data: oooBlocks } = await supabase
        .from("room_blocks")
        .select("room_id, start_date, end_date")
        .eq("block_type", "OOO")
        .lt("start_date", checkout)
        .gt("end_date", checkin);

    const blockedRoomIdsByNight = new Map<string, Set<string>>();
    for (const night of nights) blockedRoomIdsByNight.set(night, new Set<string>());
    for (const block of oooBlocks ?? []) {
        const roomId = String(block.room_id ?? "");
        if (!roomId) continue;
        const startDate = String(block.start_date ?? "");
        const endDate = String(block.end_date ?? "");
        for (const night of nights) {
            if (startDate <= night && endDate > night) {
                blockedRoomIdsByNight.get(night)?.add(roomId);
            }
        }
    }

    const capacityByTypePerNight: Record<number, Record<string, number>> = {};
    for (const [tidText, roomIds] of Object.entries(roomIdsByType)) {
        const tid = Number(tidText);
        capacityByTypePerNight[tid] = {};
        for (const night of nights) {
            const blocked = blockedRoomIdsByNight.get(night) ?? new Set<string>();
            const capacity = roomIds.reduce((count, roomId) => count + (blocked.has(roomId) ? 0 : 1), 0);
            capacityByTypePerNight[tid][night] = capacity;
        }
    }

    // 4. Count active non-dayuse reservation_nights per room_type per stay_date
    const { data: bookedNights, error: bErr } = await supabase
        .from("reservation_nights")
        .select(`
            reservation_id,
            room_id,
            room_type_id,
            stay_date,
            reservations!inner(status, is_dayuse)
        `)
        .in("stay_date", nights)
        .is("cancelled_at", null)
        .eq("reservations.status", "active")
        .eq("reservations.is_dayuse", false);
    if (bErr) return NextResponse.json({ error: bErr.message }, { status: 500 });

    const bookedPerTypePerNight: Record<number, Record<string, Set<string>>> = {};
    for (const n of bookedNights ?? []) {
        const stayDate = String(n.stay_date ?? "");
        const reservationId = String((n as any).reservation_id ?? "");
        if (!stayDate || !reservationId) continue;

        const typeCandidates = new Set<number>();
        const rowRoomTypeId = n.room_type_id != null ? Number(n.room_type_id) : NaN;
        if (Number.isFinite(rowRoomTypeId) && rowRoomTypeId > 0) {
            typeCandidates.add(rowRoomTypeId);
        }

        const rowRoomId = n.room_id ? String(n.room_id) : "";
        if (rowRoomId) {
            const roomMeta = roomMetaById.get(rowRoomId);
            if (roomMeta?.room_type_id) typeCandidates.add(roomMeta.room_type_id);
        }

        for (const tid of typeCandidates) {
            if (!roomIdsByType[tid]) continue;
            if (!bookedPerTypePerNight[tid]) bookedPerTypePerNight[tid] = {};
            if (!bookedPerTypePerNight[tid][stayDate]) bookedPerTypePerNight[tid][stayDate] = new Set<string>();
            bookedPerTypePerNight[tid][stayDate].add(reservationId);
        }
    }

    const plannedRows = await listOverlappingPlannedRoomHolds(supabase as any, {
        checkinDate: checkin,
        checkoutDate: checkout,
        roomIds: (rooms ?? []).map((row) => String(row.id)),
    });
    const plannedHoldPerTypePerNight: Record<number, Record<string, number>> = {};
    for (const row of plannedRows) {
        const roomMeta = roomMetaById.get(String(row.to_room_id));
        const tid = roomMeta?.room_type_id ?? Number(row.to_room_type_id ?? 0);
        if (!Number.isFinite(tid) || tid <= 0 || !roomIdsByType[tid]) continue;
        if (!plannedHoldPerTypePerNight[tid]) plannedHoldPerTypePerNight[tid] = {};
        for (const stayDate of expandPlannedMoveNights(row)) {
            if (stayDate < checkin || stayDate >= checkout) continue;
            plannedHoldPerTypePerNight[tid][stayDate] = (plannedHoldPerTypePerNight[tid][stayDate] ?? 0) + 1;
        }
    }

    // Min available over all nights = bottleneck night
    const minAvailableByType: Record<number, number> = {};
    for (const tid of Object.keys(totalByType).map(Number)) {
        let min = Number.MAX_SAFE_INTEGER;
        for (const night of nights) {
            const capacity = capacityByTypePerNight[tid]?.[night] ?? 0;
            const booked = bookedPerTypePerNight[tid]?.[night]?.size ?? 0;
            const planned = plannedHoldPerTypePerNight[tid]?.[night] ?? 0;
            min = Math.min(min, capacity - booked - planned);
        }
        if (!Number.isFinite(min)) min = 0;
        minAvailableByType[tid] = Math.max(0, min);
    }

    // 5. Get room type names
    const { data: roomTypes } = await supabase
        .from("room_types")
        .select("id, name_en, code");

    // 6. Get rate per type — use the first room of each type, avg price over stay
    const rateByType: Record<number, number> = {};
    for (const [tid, roomIds] of Object.entries(roomIdsByType)) {
        const typeId = Number(tid);
        const sampleRoomId = roomIds[0];
        const { data: rates } = await supabase
            .from("rate_templates")
            .select("price")
            .eq("room_id", sampleRoomId)
            .in("stay_date", nights);

        if (rates && rates.length > 0) {
            const sum = rates.reduce((s, r) => s + Number(r.price ?? 0), 0);
            rateByType[typeId] = Math.round(sum / nights.length);
        } else {
            rateByType[typeId] = 0;
        }
    }

    // 7. Build response
    const result = (roomTypes ?? [])
        .filter(rt => totalByType[rt.id] !== undefined)
        .map(rt => {
            const total = totalByType[rt.id] ?? 0;
            const available = minAvailableByType[rt.id] ?? 0;
            const ratePerNight = rateByType[rt.id] ?? 0;
            return {
                room_type_id: rt.id,
                name: rt.name_en,
                code: rt.code,
                total_rooms: total,
                available_rooms: available,
                is_available: available > 0,
                rate_per_night: ratePerNight,
                total_for_stay: ratePerNight * nights.length,
                nights: nights.length,
            };
        })
        .sort((a, b) => {
            // Available first, then by room_type_id (natural order)
            if (a.is_available !== b.is_available) return a.is_available ? -1 : 1;
            return a.room_type_id - b.room_type_id;
        });

    return NextResponse.json({
        success: true,
        checkin,
        checkout,
        nights: nights.length,
        availability: result,
    });
}
