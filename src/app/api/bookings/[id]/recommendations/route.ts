import { NextResponse } from "next/server";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { listOverlappingPlannedRoomHolds } from "@/lib/planned-room-moves";
import { listSwapCandidatesForReservation, loadReservationSwapContext } from "@/lib/room-swap";
import { isLegacyDayUseRoom } from "@/lib/dayuse-rooms";

function parseRoomTypeId(raw: string | null): number | null {
    if (!raw) return null;
    const parsed = Number.parseInt(raw, 10);
    if (!Number.isFinite(parsed) || parsed <= 0) return null;
    return parsed;
}

function isDateString(value: string | null): value is string {
    if (!value) return false;
    return /^\d{4}-\d{2}-\d{2}$/.test(value);
}

export async function GET(
    request: Request,
    { params }: { params: { id: string } }
) {
    const reservationId = params.id;
    if (!reservationId) {
        return NextResponse.json({ error: "Missing reservation id." }, { status: 400 });
    }

    try {
        const supabase = createServerSupabaseClient();
        const { searchParams } = new URL(request.url);
        const roomTypeOverrideRaw = searchParams.get("room_type_id");
        const checkinOverrideRaw = searchParams.get("checkin_date");
        const checkoutOverrideRaw = searchParams.get("checkout_date");
        const includeSwap = searchParams.get("include_swap") === "true";
        const roomTypeOverride = parseRoomTypeId(roomTypeOverrideRaw);

        if (roomTypeOverrideRaw && !roomTypeOverride) {
            return NextResponse.json({ error: "Invalid room_type_id override." }, { status: 400 });
        }
        if (checkinOverrideRaw && !isDateString(checkinOverrideRaw)) {
            return NextResponse.json({ error: "Invalid checkin_date override." }, { status: 400 });
        }
        if (checkoutOverrideRaw && !isDateString(checkoutOverrideRaw)) {
            return NextResponse.json({ error: "Invalid checkout_date override." }, { status: 400 });
        }

        // 1. Fetch Reservation details & guest preferences
        const { data: resData, error: resError } = await supabase
            .from("reservations")
            .select(`
                checkin_date, checkout_date,
                reservation_nights!inner(room_type_id),
                reservation_preferences(feature_code, room_features(name))
            `)
            .eq("id", reservationId)
            .maybeSingle();

        if (resError || !resData) {
            return NextResponse.json({ error: "Reservation not found." }, { status: 404 });
        }

        const reservationRoomTypeId = Array.isArray(resData.reservation_nights)
            ? resData.reservation_nights[0]?.room_type_id
            : null;
        const roomTypeId = roomTypeOverride ?? reservationRoomTypeId;
        const checkinDate = checkinOverrideRaw || resData.checkin_date;
        const checkoutDate = checkoutOverrideRaw || resData.checkout_date;

        if (!roomTypeId) {
            return NextResponse.json({ error: "No room type associated with this reservation." }, { status: 400 });
        }
        if (!checkinDate || !checkoutDate || checkoutDate <= checkinDate) {
            return NextResponse.json({ error: "Invalid stay date range for room recommendations." }, { status: 400 });
        }

        // Extract preferences
        const prefs = (resData.reservation_preferences as any[] || []).map(p => ({
            code: p.feature_code,
            name: p.room_features?.name || p.feature_code
        }));

        const prefCodes = prefs.map(p => p.code);

        // 2. Find all rooms of this room_type_id
        const { data: roomsRaw, error: roomsError } = await supabase
            .from("rooms")
            .select(`
                id, room_number, is_sellable,
                room_feature_mapping(feature_code, room_features(name))
            `)
            .eq("room_type_id", roomTypeId)
            .eq("is_sellable", true)
            .eq("is_dayuse", false);

        if (roomsError || !roomsRaw) {
            return NextResponse.json({ error: "Error fetching rooms." }, { status: 500 });
        }
        const roomsData = roomsRaw.filter((room: any) => !isLegacyDayUseRoom(String(room?.room_number ?? "")));

        // 3. Find conflicts directly on those specific dates (check for overlap)
        // using reservation_nights stay_date
        const { data: conflictsData, error: conflictsErr } = await supabase
            .from("reservation_nights")
            .select("room_id")
            .in("room_id", roomsData.map(r => r.id))
            .gte("stay_date", checkinDate)
            .lt("stay_date", checkoutDate)
            .is("cancelled_at", null)
            .neq("reservation_id", reservationId);
        if (conflictsErr) {
            return NextResponse.json({ error: conflictsErr.message }, { status: 500 });
        }

        const conflictedRoomIds = new Set((conflictsData || []).map(c => c.room_id));

        // 3.5 Find OOO Room Block conflicts (use room_id, not room_number)
        const { data: allBlocks } = await supabase
            .from("room_blocks")
            .select("room_id, start_date, end_date")
            .eq("block_type", "OOO")
            .in("room_id", roomsData.map(r => r.id));

        const oooConflictedRoomIds = new Set(
            (allBlocks || []).filter(b => {
                return (b.start_date < checkoutDate && b.end_date > checkinDate);
            }).map(b => b.room_id)
        );

        const plannedHolds = await listOverlappingPlannedRoomHolds(supabase as any, {
            checkinDate,
            checkoutDate,
            roomIds: roomsData.map((r) => String(r.id)),
            excludeReservationId: reservationId,
        });
        const plannedConflictedRoomIds = new Set(plannedHolds.map((row) => row.to_room_id));

        // 4. Calculate Scores
        const recommendations = roomsData.map(room => {
            const roomFeatures = (room.room_feature_mapping as any[] || []).map(m => m.feature_code);

            let score = 0;
            const matched: string[] = [];
            const missing: string[] = [];

            prefCodes.forEach(code => {
                if (roomFeatures.includes(code)) {
                    score += 1;
                    matched.push(prefs.find(p => p.code === code)?.name || code);
                } else {
                    missing.push(prefs.find(p => p.code === code)?.name || code);
                }
            });

            const hasConflict =
                conflictedRoomIds.has(room.id) ||
                oooConflictedRoomIds.has(room.id) ||
                plannedConflictedRoomIds.has(room.id);

            return {
                room_id: room.id,
                room_number: room.room_number,
                score,
                matched_features: matched,
                missing_features: missing,
                status: hasConflict ? "conflict" : "available"
            };
        });

        // 5. Sort: non-conflicts first, then highest score, then room number
        recommendations.sort((a, b) => {
            if (a.status !== b.status) return a.status === "available" ? -1 : 1;
            if (b.score !== a.score) return b.score - a.score;
            return a.room_number.localeCompare(b.room_number);
        });

        const swapCandidates = includeSwap
            ? await listSwapCandidatesForReservation(supabase as any, reservationId)
            : [];
        const swapSource = includeSwap
            ? await loadReservationSwapContext(supabase as any, reservationId)
            : null;

        return NextResponse.json({
            success: true,
            preferences: prefs,
            applied_room_type_id: roomTypeId,
            applied_checkin_date: checkinDate,
            applied_checkout_date: checkoutDate,
            recommendations,
            swap_source: swapSource
                ? {
                    reservation_id: swapSource.reservation_id,
                    room_id: swapSource.current_room_id,
                    room_number: swapSource.current_room_number,
                    do_not_move_assigned_room: swapSource.do_not_move_assigned_room,
                    do_not_move_reason: swapSource.do_not_move_reason,
                }
                : null,
            swap_candidates: swapCandidates,
        });

    } catch (err: any) {
        return NextResponse.json({ error: err.message }, { status: 500 });
    }
}
