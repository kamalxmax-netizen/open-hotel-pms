import { NextResponse } from "next/server";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { syncBookingGroupStatusById } from "@/lib/booking-group-status";

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
    try {
        const supabase = createServerSupabaseClient();
        const { id } = await context.params;
        const body = await request.json();

        if (!id) {
            return NextResponse.json({ success: false, error: "Missing group ID" }, { status: 400 });
        }

        const reservationId = body.reservation_id;
        if (!reservationId) {
            return NextResponse.json({ success: false, error: "Missing reservation_id" }, { status: 400 });
        }

        const { data: reservation, error: reservationError } = await supabase
            .from("reservations")
            .select("id, booking_group_id")
            .eq("id", reservationId)
            .maybeSingle();

        if (reservationError) {
            return NextResponse.json({ success: false, error: reservationError.message }, { status: 500 });
        }
        if (!reservation) {
            return NextResponse.json({ success: false, error: "Reservation not found" }, { status: 404 });
        }

        const previousGroupId = reservation.booking_group_id;
        if (previousGroupId === id) {
            return NextResponse.json({ success: true, unchanged: true });
        }

        // 1. Update reservation to link to group
        const { error: updateError } = await supabase
            .from("reservations")
            .update({ booking_group_id: id })
            .eq("id", reservationId);

        if (updateError) {
            return NextResponse.json({ success: false, error: updateError.message }, { status: 500 });
        }

        const refreshTotalRooms = async (groupId: string) => {
            const { count, error: countError } = await supabase
                .from("reservations")
                .select("id", { count: "exact", head: true })
                .eq("booking_group_id", groupId);

            if (countError) return;

            await supabase
                .from("booking_groups")
                .update({ total_rooms: count ?? 0 })
                .eq("id", groupId);
        };

        // 2. Re-sync total rooms for destination + source group (if moved)
        await refreshTotalRooms(id);
        if (previousGroupId && previousGroupId !== id) {
            await refreshTotalRooms(previousGroupId);
        }

        try {
            await syncBookingGroupStatusById(supabase, String(id));
            if (previousGroupId && previousGroupId !== id) {
                await syncBookingGroupStatusById(supabase, String(previousGroupId));
            }
        } catch (syncError) {
            console.error("group status sync after add-reservation failed:", syncError);
        }

        return NextResponse.json({ success: true });
    } catch (err: any) {
        return NextResponse.json({ success: false, error: err.message }, { status: 500 });
    }
}
