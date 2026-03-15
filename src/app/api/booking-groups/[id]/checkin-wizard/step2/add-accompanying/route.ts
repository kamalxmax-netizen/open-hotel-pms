import { assertGuestProfileLinkable } from "@/lib/reservation-party";
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
    const requestedDisplayOrder = body?.display_order == null ? null : Number(body.display_order);

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

    await assertGuestProfileLinkable(supabase, guestProfileId);

    const { data: existingGuests, error: existingGuestsError } = await supabase
      .from("reservation_guests")
      .select("id, guest_profile_id, role, display_order")
      .eq("reservation_id", reservationId);

    if (existingGuestsError) {
      return NextResponse.json({ success: false, error: existingGuestsError.message }, { status: 500 });
    }

    const rows = existingGuests ?? [];
    const hasPersistedPrimary = rows.some((row: any) => row.role === "primary");
    const currentPrimaryGuestId = hasPersistedPrimary
      ? String(rows.find((row: any) => row.role === "primary")?.guest_profile_id ?? "")
      : reservation.guest_profile_id
        ? String(reservation.guest_profile_id)
        : null;

    if (currentPrimaryGuestId && currentPrimaryGuestId === guestProfileId) {
      return NextResponse.json(
        { success: false, error: "Primary guest cannot be added as accompanying." },
        { status: 409 }
      );
    }

    if (rows.some((row: any) => String(row.guest_profile_id) === guestProfileId)) {
      return NextResponse.json(
        { success: false, error: "Guest already linked in this reservation." },
        { status: 409 }
      );
    }

    const effectiveTotal = rows.length + (!hasPersistedPrimary && currentPrimaryGuestId ? 1 : 0);
    if (effectiveTotal >= 4) {
      return NextResponse.json({ success: false, error: "Maximum 4 total guests per reservation." }, { status: 409 });
    }

    const occupied = new Set(
      rows
        .filter((row: any) => row.role === "accompanying")
        .map((row: any) => Number(row.display_order))
    );

    let displayOrder = Number.isFinite(requestedDisplayOrder) ? Math.trunc(Number(requestedDisplayOrder)) : null;
    if (displayOrder != null && (displayOrder < 2 || displayOrder > 4)) {
      return NextResponse.json({ success: false, error: "display_order must be between 2 and 4." }, { status: 400 });
    }

    if (displayOrder != null && occupied.has(displayOrder)) {
      return NextResponse.json({ success: false, error: `display_order ${displayOrder} is already used.` }, { status: 409 });
    }

    if (displayOrder == null) {
      for (const slot of [2, 3, 4]) {
        if (!occupied.has(slot)) {
          displayOrder = slot;
          break;
        }
      }
    }

    if (displayOrder == null) {
      return NextResponse.json({ success: false, error: "No available display_order slots." }, { status: 409 });
    }

    const { data: inserted, error: insertError } = await supabase
      .from("reservation_guests")
      .insert({
        reservation_id: reservationId,
        guest_profile_id: guestProfileId,
        role: "accompanying",
        display_order: displayOrder,
      })
      .select("id, reservation_id, guest_profile_id, role, display_order, created_at")
      .maybeSingle();

    if (insertError) {
      if (insertError.code === "23505") {
        return NextResponse.json(
          { success: false, error: "Guest already linked or display order is not available." },
          { status: 409 }
        );
      }
      return NextResponse.json({ success: false, error: insertError.message }, { status: 500 });
    }

    return NextResponse.json({ success: true, guest: inserted });
  } catch (err) {
    return NextResponse.json(
      { success: false, error: err instanceof Error ? err.message : "Internal server error" },
      { status: 500 }
    );
  }
}
