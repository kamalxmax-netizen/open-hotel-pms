import { NextResponse } from "next/server";
import { refreshBookingGroupTotalRooms, syncBookingGroupStatusById } from "@/lib/booking-group-status";
import { createServerSupabaseClient } from "@/lib/supabase/server";

export async function DELETE(
  _request: Request,
  context: { params: Promise<{ id: string; reservationId: string }> }
) {
  try {
    const supabase = createServerSupabaseClient();
    const { id, reservationId } = await context.params;

    if (!id || !reservationId) {
      return NextResponse.json(
        { success: false, error: "Missing group id or reservation id." },
        { status: 400 }
      );
    }

    const { data: reservation, error: reservationError } = await supabase
      .from("reservations")
      .select("id, booking_group_id, booking_code")
      .eq("id", reservationId)
      .maybeSingle();

    if (reservationError) {
      return NextResponse.json({ success: false, error: reservationError.message }, { status: 500 });
    }

    if (!reservation) {
      return NextResponse.json({ success: false, error: "Reservation not found." }, { status: 404 });
    }

    if (String(reservation.booking_group_id ?? "") !== String(id)) {
      return NextResponse.json(
        { success: false, error: "Reservation is not linked to this group." },
        { status: 400 }
      );
    }

    const { error: unlinkError } = await supabase
      .from("reservations")
      .update({ booking_group_id: null })
      .eq("id", reservationId);

    if (unlinkError) {
      return NextResponse.json({ success: false, error: unlinkError.message }, { status: 500 });
    }

    await refreshBookingGroupTotalRooms(supabase, id);
    await syncBookingGroupStatusById(supabase, id);

    return NextResponse.json({
      success: true,
      reservation_id: reservationId,
      booking_code: reservation.booking_code ?? null,
    });
  } catch (err: any) {
    return NextResponse.json({ success: false, error: err.message }, { status: 500 });
  }
}
