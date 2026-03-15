import { NextResponse } from "next/server";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { assertRoomAvailableForDateRange, PlannedRoomMoveError, syncReservationNightDependencyMetadata } from "@/lib/planned-room-moves";
import { assertAssignedRoomUnlockedOrOverride, clearAssignedRoomLock, AssignedRoomLockError, getAssignedRoomLockContext } from "@/lib/assigned-room-lock";

export async function POST(
    request: Request,
    { params }: { params: { id: string } }
) {
    const reservationId = params.id;
    if (!reservationId) {
        return NextResponse.json({ error: "Missing reservation id." }, { status: 400 });
    }

    try {
        const json = await request.json().catch(() => null);
        if (!json || !json.room_id) {
            return NextResponse.json({ error: "Missing room_id" }, { status: 400 });
        }
        const overrideAssignedNote = String(json.override_assigned_note ?? "").trim();

        const supabase = createServerSupabaseClient();

        // 1. Verify reservation and get nights
        const { data: resData, error: resError } = await supabase
            .from("reservations")
            .select("checkin_date, checkout_date, status")
            .eq("id", reservationId)
            .maybeSingle();

        if (resError || !resData) {
            return NextResponse.json({ error: "Reservation not found." }, { status: 404 });
        }

        if (resData.status !== "active") {
            return NextResponse.json({ error: "Cannot assign room to a non-active reservation." }, { status: 400 });
        }

        const currentLockContext = await getAssignedRoomLockContext(supabase as any, reservationId);
        const changingAssignedRoom =
            Boolean(currentLockContext.currentRoomId) &&
            currentLockContext.currentRoomId !== String(json.room_id);
        const assignedLockContext = changingAssignedRoom
            ? await assertAssignedRoomUnlockedOrOverride({
                supabase: supabase as any,
                reservationId,
                action: "assign",
                overrideNote: overrideAssignedNote,
            })
            : null;

        try {
            await assertRoomAvailableForDateRange(supabase as any, {
                roomId: json.room_id,
                checkinDate: resData.checkin_date,
                checkoutDate: resData.checkout_date,
                excludeReservationId: reservationId,
            });
        } catch (error) {
            if (error instanceof PlannedRoomMoveError) {
                return NextResponse.json({ error: error.message }, { status: error.status });
            }
            throw error;
        }

        // 3. Perform assignment (Update reservation_nights only)
        const { error: updateNightsError } = await supabase
            .from("reservation_nights")
            .update({
                room_id: json.room_id,
                assignment_source: "manual",
                dependency_plan_id: null,
                dependency_reason: null,
            })
            .eq("reservation_id", reservationId)
            .is("cancelled_at", null);

        if (updateNightsError) throw updateNightsError;

        await syncReservationNightDependencyMetadata(supabase as any, {
            reservationId,
        });

        if (assignedLockContext?.isLocked) {
            await clearAssignedRoomLock({
                supabase: supabase as any,
                reservationId,
                actor: "FO",
                reason: overrideAssignedNote,
                clearReason: "override_assign",
                appendNote: true,
            });
        }

        return NextResponse.json({ success: true });

    } catch (err: any) {
        if (err instanceof AssignedRoomLockError) {
            return NextResponse.json({ error: err.message, reason_code: err.code }, { status: err.status });
        }
        return NextResponse.json({ error: err.message }, { status: 500 });
    }
}
