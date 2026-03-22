import { createServerSupabaseClient } from "@/lib/supabase/server";
import { NextRequest, NextResponse } from "next/server";
import { unstable_noStore as noStore } from "next/cache";
import { listOverlappingPlannedRoomHolds } from "@/lib/planned-room-moves";
import { isValidDateString, listNights } from "@/lib/dates";
import { isLegacyDayUseRoom } from "@/lib/dayuse-rooms";

export const dynamic = "force-dynamic";

/**
 * GET /api/available-rooms?room_type_id=X&checkin=YYYY-MM-DD&checkout=YYYY-MM-DD
 *     &exclude_reservation_id=UUID (optional)
 *
 * Returns rooms of the given type that have NO active reservation_nights
 * in the [checkin, checkout) date range.
 */
export async function GET(request: NextRequest) {
    noStore();
    try {
        const sp = request.nextUrl.searchParams;
        const roomTypeId = sp.get("room_type_id");
        const checkin = sp.get("checkin") || sp.get("checkin_date");
        const checkout = sp.get("checkout") || sp.get("checkout_date");
        const excludeReservationId = sp.get("exclude_reservation_id") || sp.get("reservation_id");
        const excludePlanId = sp.get("exclude_plan_id");

        if (!roomTypeId || !checkin || !checkout) {
            return NextResponse.json(
                { error: "Required: room_type_id, checkin, checkout" },
                { status: 400 }
            );
        }
        if (!isValidDateString(checkin) || !isValidDateString(checkout)) {
            return NextResponse.json({ error: "Invalid date format. Use YYYY-MM-DD." }, { status: 400 });
        }
        if (checkout <= checkin) {
            return NextResponse.json({ error: "checkout must be after checkin" }, { status: 400 });
        }

        const parsedRoomTypeId = Number.parseInt(roomTypeId, 10);
        if (!Number.isFinite(parsedRoomTypeId) || parsedRoomTypeId <= 0) {
            return NextResponse.json({ error: "Invalid room_type_id" }, { status: 400 });
        }

        const nights = listNights(checkin, checkout);
        const todayBangkok = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Bangkok" }).format(new Date());
        const includesToday = checkin <= todayBangkok && checkout > todayBangkok;

        const supabase = createServerSupabaseClient();

        // 1. Get all sellable rooms of this type
        const { data: allRoomsRaw, error: roomsError } = await supabase
            .from("rooms")
            .select("id, room_number, room_type_id, is_sellable, is_dayuse, room_types(name_en)")
            .eq("room_type_id", parsedRoomTypeId)
            .eq("is_sellable", true)
            .eq("is_dayuse", false)
            .order("sort_order", { ascending: true })
            .order("room_number", { ascending: true });

        if (roomsError) {
            return NextResponse.json({ error: roomsError.message }, { status: 500 });
        }

        const allRooms = (allRoomsRaw ?? []).filter((room: any) => !isLegacyDayUseRoom(String(room?.room_number ?? "")));

        if (!allRooms || allRooms.length === 0) {
            return NextResponse.json({
                success: true,
                rooms: [],
                count: 0
            });
        }

        const overnightRoomIds = allRooms.map((r) => r.id);
        const overnightRoomIdSet = new Set(overnightRoomIds);

        // 1.5 Type-level capacity guard (includes floating reservations without room_id)
        const { data: typeRows, error: typeRowsError } = await supabase
            .from("reservation_nights")
            .select(`
                reservation_id,
                stay_date,
                room_id,
                room_type_id,
                reservations!inner(status, is_dayuse)
            `)
            .gte("stay_date", checkin)
            .lt("stay_date", checkout)
            .is("cancelled_at", null)
            .eq("reservations.status", "active")
            .eq("reservations.is_dayuse", false);
        if (typeRowsError) {
            return NextResponse.json({ error: typeRowsError.message }, { status: 500 });
        }

        const { data: oooBlocks, error: oooBlocksError } = await supabase
            .from("room_blocks")
            .select("room_id, start_date, end_date")
            .eq("block_type", "OOO")
            .in("room_id", overnightRoomIds)
            .lt("start_date", checkout)
            .gt("end_date", checkin);
        if (oooBlocksError) {
            return NextResponse.json({ error: oooBlocksError.message }, { status: 500 });
        }

        const plannedHolds = await listOverlappingPlannedRoomHolds(supabase as any, {
            checkinDate: checkin,
            checkoutDate: checkout,
            roomIds: overnightRoomIds,
            excludePlanId,
            excludeReservationId: excludeReservationId || null,
        });

        const occupiedAssignedRoomIdsByNight = new Map<string, Set<string>>();
        const occupiedFloatingReservationIdsByNight = new Map<string, Set<string>>();
        for (const night of nights) {
            occupiedAssignedRoomIdsByNight.set(night, new Set<string>());
            occupiedFloatingReservationIdsByNight.set(night, new Set<string>());
        }
        for (const row of typeRows ?? []) {
            const reservationId = String((row as any).reservation_id ?? "");
            if (!reservationId || (excludeReservationId && reservationId === excludeReservationId)) continue;
            const stayDate = String((row as any).stay_date ?? "");
            if (!occupiedAssignedRoomIdsByNight.has(stayDate)) continue;
            const rowRoomTypeId = Number((row as any).room_type_id ?? 0);
            const rowRoomId = row && (row as any).room_id ? String((row as any).room_id) : "";
            const belongsToType =
                rowRoomTypeId === parsedRoomTypeId ||
                (rowRoomId ? overnightRoomIdSet.has(rowRoomId) : false);
            if (!belongsToType) continue;

            if (rowRoomId && overnightRoomIdSet.has(rowRoomId)) {
                occupiedAssignedRoomIdsByNight.get(stayDate)?.add(rowRoomId);
            } else {
                occupiedFloatingReservationIdsByNight.get(stayDate)?.add(reservationId);
            }
        }

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

        const plannedHeldRoomIdsByNight = new Map<string, Set<string>>();
        for (const night of nights) plannedHeldRoomIdsByNight.set(night, new Set<string>());
        for (const hold of plannedHolds) {
            const holdStart = String((hold as any).start_date ?? "");
            const holdEnd = String((hold as any).end_date ?? "");
            const holdRoomId = String((hold as any).to_room_id ?? "");
            if (!holdRoomId || !overnightRoomIdSet.has(holdRoomId)) continue;
            if (!holdStart || !holdEnd) continue;
            for (const night of nights) {
                if (holdStart <= night && holdEnd > night) {
                    plannedHeldRoomIdsByNight.get(night)?.add(holdRoomId);
                }
            }
        }

        const hkBlockedRoomIds = new Set<string>();
        if (includesToday && overnightRoomIds.length > 0) {
            const { data: hkRows, error: hkError } = await supabase
                .from("housekeeping_tasks")
                .select("room_id, status, task_seq")
                .eq("stay_date", todayBangkok)
                .in("room_id", overnightRoomIds)
                .order("task_seq", { ascending: false });

            if (hkError) {
                return NextResponse.json({ error: hkError.message }, { status: 500 });
            }

            const seenRooms = new Set<string>();
            for (const row of hkRows ?? []) {
                const roomId = String((row as any).room_id ?? "");
                if (!roomId || seenRooms.has(roomId)) continue;
                seenRooms.add(roomId);
                const status = String((row as any).status ?? "").toLowerCase();
                if (status === "dirty" || status === "in_progress" || status === "paused") {
                    hkBlockedRoomIds.add(roomId);
                }
            }
        }

        const blockedByTypeCapacity = nights.some((night) => {
            const blockedRooms = blockedRoomIdsByNight.get(night) ?? new Set<string>();
            const capacity = overnightRoomIds.reduce((count, id) => count + (blockedRooms.has(id) ? 0 : 1), 0);
            if (capacity <= 0) return true;

            const committedRoomIds = new Set<string>();
            for (const roomId of occupiedAssignedRoomIdsByNight.get(night) ?? new Set<string>()) {
                if (!blockedRooms.has(roomId)) committedRoomIds.add(roomId);
            }
            for (const roomId of plannedHeldRoomIdsByNight.get(night) ?? new Set<string>()) {
                if (!blockedRooms.has(roomId)) committedRoomIds.add(roomId);
            }

            const floatingReservations = occupiedFloatingReservationIdsByNight.get(night)?.size ?? 0;
            return committedRoomIds.size + floatingReservations >= capacity;
        });

        if (blockedByTypeCapacity) {
            return NextResponse.json({
                success: true,
                rooms: [],
                count: 0,
                total_rooms: allRooms.length,
                occupied_count: null,
                planned_hold_count: plannedHolds.length,
                capacity_blocked: true
            });
        }

        // 2. Find rooms that are occupied in the date range
        // reservation_nights covers [checkin, checkout-1day]
        let occupiedQuery = supabase
            .from("reservation_nights")
            .select(`
                room_id,
                reservations!inner(status, is_dayuse)
            `)
            .gte("stay_date", checkin)
            .lt("stay_date", checkout)
            .is("cancelled_at", null)
            .eq("reservations.status", "active")
            .eq("reservations.is_dayuse", false)
            .in("room_id", overnightRoomIds);

        if (excludeReservationId) {
            occupiedQuery = occupiedQuery.neq("reservation_id", excludeReservationId);
        }

        const { data: occupiedNights, error: occupiedError } = await occupiedQuery;

        if (occupiedError) {
            return NextResponse.json({ error: occupiedError.message }, { status: 500 });
        }

        const occupiedRoomIds = new Set((occupiedNights ?? []).map(n => n.room_id));

        const heldRoomIds = new Set(plannedHolds.map((row) => row.to_room_id));

        // 3. Filter to available rooms
        const availableRooms = allRooms
            .filter(r => !occupiedRoomIds.has(r.id) && !heldRoomIds.has(r.id) && !hkBlockedRoomIds.has(r.id))
            .map(r => ({
                id: r.id,
                room_number: r.room_number,
                room_type_id: String(r.room_type_id),
                room_type_name: (r.room_types as any)?.name_en ?? null,
                is_available: true
            }));

        return NextResponse.json({
            success: true,
            rooms: availableRooms,
            count: availableRooms.length,
            total_rooms: allRooms.length,
            occupied_count: occupiedRoomIds.size,
            planned_hold_count: heldRoomIds.size,
            hk_blocked_count: hkBlockedRoomIds.size
        });
    } catch (err) {
        return NextResponse.json({ error: String(err) }, { status: 500 });
    }
}
