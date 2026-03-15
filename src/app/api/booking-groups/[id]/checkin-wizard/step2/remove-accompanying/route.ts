import { assertReservationInGroup } from "@/lib/group-checkin-wizard-service";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { NextRequest, NextResponse } from "next/server";

export async function POST(
  request: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  try {
    const { id: groupId } = await context.params;
    if (!groupId) {
      return NextResponse.json({ success: false, error: "Missing group ID." }, { status: 400 });
    }

    const body = await request.json().catch(() => ({}));
    const reservationId = String(body?.reservation_id ?? "").trim();
    const guestProfileId = String(body?.guest_profile_id ?? "").trim();

    if (!reservationId || !guestProfileId) {
      return NextResponse.json(
        { success: false, error: "reservation_id and guest_profile_id are required." },
        { status: 400 }
      );
    }

    const supabase = createServerSupabaseClient();
    const reservation = await assertReservationInGroup(supabase, groupId, reservationId);
    if (!reservation) {
      return NextResponse.json({ success: false, error: "Reservation not found in this group." }, { status: 404 });
    }

    const { data: deleted, error } = await supabase
      .from("reservation_guests")
      .delete()
      .eq("reservation_id", reservationId)
      .eq("guest_profile_id", guestProfileId)
      .eq("role", "accompanying")
      .select("id");

    if (error) {
      return NextResponse.json({ success: false, error: error.message }, { status: 500 });
    }

    if (!deleted || deleted.length === 0) {
      return NextResponse.json({ success: false, error: "Accompanying guest link not found." }, { status: 404 });
    }

    return NextResponse.json({ success: true, removed: deleted.length });
  } catch (err) {
    return NextResponse.json(
      { success: false, error: err instanceof Error ? err.message : "Internal server error" },
      { status: 500 }
    );
  }
}
