import { NextResponse } from "next/server";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { refreshBookingGroupTotalRooms, syncBookingGroupStatusById } from "@/lib/booking-group-status";

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
    try {
        const supabase = createServerSupabaseClient();
        const { id } = await context.params;
        const body = await request.json();

        if (!id) {
            return NextResponse.json({ success: false, error: "Missing group ID" }, { status: 400 });
        }

        const reservationId = body.reservation_id;
        const linkSameName = body.link_same_name === true;
        if (!reservationId) {
            return NextResponse.json({ success: false, error: "Missing reservation_id" }, { status: 400 });
        }

        const { data: reservation, error: reservationError } = await supabase
            .from("reservations")
            .select("id, booking_group_id, guest_name, checkin_date, status")
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

        if (linkSameName) {
            const seedGuestName = String(reservation.guest_name ?? "").trim();
            const seedCheckinDate = String(reservation.checkin_date ?? "").trim();

            if (!seedGuestName || !seedCheckinDate) {
                return NextResponse.json(
                    { success: false, error: "Selected reservation is missing guest name or due-in date." },
                    { status: 400 }
                );
            }

            const { data: matchingReservations, error: matchingReservationsError } = await supabase
                .from("reservations")
                .select("id, booking_code, booking_group_id, guest_name, checkin_date, status")
                .eq("guest_name", seedGuestName)
                .eq("checkin_date", seedCheckinDate)
                .eq("status", "active");

            if (matchingReservationsError) {
                return NextResponse.json({ success: false, error: matchingReservationsError.message }, { status: 500 });
            }

            const candidates = (matchingReservations ?? []).filter((row: any) => {
                const currentGroupId = row.booking_group_id ? String(row.booking_group_id) : null;
                return !currentGroupId || currentGroupId === id;
            });

            if (candidates.length === 0) {
                return NextResponse.json(
                    { success: false, error: "No same-name reservations are available to link." },
                    { status: 409 }
                );
            }

            const candidateIds = candidates.map((row: any) => String(row.id));
            const { error: batchUpdateError } = await supabase
                .from("reservations")
                .update({ booking_group_id: id })
                .in("id", candidateIds);

            if (batchUpdateError) {
                return NextResponse.json({ success: false, error: batchUpdateError.message }, { status: 500 });
            }

            await refreshBookingGroupTotalRooms(supabase, id);
            try {
                await syncBookingGroupStatusById(supabase, String(id));
            } catch (syncError) {
                console.error("group status sync after same-name add failed:", syncError);
            }

            const blockedCount = (matchingReservations ?? []).length - candidates.length;
            return NextResponse.json({
                success: true,
                linked_count: candidateIds.length,
                blocked_count: blockedCount,
                seed_guest_name: seedGuestName,
                due_in_date: seedCheckinDate,
            });
        }

        // 1. Update reservation to link to group
        const { error: updateError } = await supabase
            .from("reservations")
            .update({ booking_group_id: id })
            .eq("id", reservationId);

        if (updateError) {
            return NextResponse.json({ success: false, error: updateError.message }, { status: 500 });
        }

        // 2. Re-sync total rooms for destination + source group (if moved)
        await refreshBookingGroupTotalRooms(supabase, id);
        if (previousGroupId && previousGroupId !== id) {
            await refreshBookingGroupTotalRooms(supabase, previousGroupId);
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
