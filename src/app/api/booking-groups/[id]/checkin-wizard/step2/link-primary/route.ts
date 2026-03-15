import {
  assertGuestProfileLinkable,
  linkPrimaryGuestToReservation,
  ReservationPartyError,
} from "@/lib/reservation-party";
import { checkProfileCompleteness } from "@/lib/guest-profile-completeness";
import { assertReservationInGroup } from "@/lib/group-checkin-wizard-service";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { NextRequest, NextResponse } from "next/server";

function buildGuestDisplayName(firstName: unknown, lastName: unknown, fallback: string) {
  const first = String(firstName ?? "").trim();
  const last = String(lastName ?? "").trim();
  const full = `${first} ${last}`.trim();
  return full || fallback;
}

function normalizeName(value: unknown): string {
  return String(value ?? "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .replace(/[^\p{L}\p{N}\s]/gu, "")
    .trim();
}

function classifyNameMatch(bookingName: unknown, profileName: unknown): "exact" | "likely" | "mismatch" {
  const booking = normalizeName(bookingName);
  const profile = normalizeName(profileName);
  if (!booking || !profile) return "mismatch";
  if (booking === profile) return "exact";
  if (booking.includes(profile) || profile.includes(booking)) return "likely";

  const bookingTokens = new Set(booking.split(" ").filter(Boolean));
  const profileTokens = new Set(profile.split(" ").filter(Boolean));
  let overlap = 0;
  bookingTokens.forEach((token) => {
    if (profileTokens.has(token)) overlap += 1;
  });
  return overlap >= 2 ? "likely" : "mismatch";
}

async function appendReservationNoteLine(
  supabase: ReturnType<typeof createServerSupabaseClient>,
  reservationId: string,
  line: string
) {
  const trimmed = String(line ?? "").trim();
  if (!trimmed) return;

  const { data: reservation, error: reservationError } = await supabase
    .from("reservations")
    .select("id, note")
    .eq("id", reservationId)
    .maybeSingle();

  if (reservationError) throw new Error(reservationError.message || "Failed to load reservation note.");
  if (!reservation) throw new Error("Reservation not found.");

  const current = typeof reservation.note === "string" ? reservation.note.trimEnd() : "";
  const nextNote = current ? `${current}\n${trimmed}` : trimmed;
  const { error: updateError } = await supabase
    .from("reservations")
    .update({ note: nextNote })
    .eq("id", reservationId);
  if (updateError) throw new Error(updateError.message || "Failed to update reservation note.");
}

async function appendProfileNoteLine(
  supabase: ReturnType<typeof createServerSupabaseClient>,
  profileId: string,
  line: string
) {
  const trimmed = String(line ?? "").trim();
  if (!trimmed) return;

  const { data: profile, error: profileError } = await supabase
    .from("guest_profiles")
    .select("id, notes")
    .eq("id", profileId)
    .maybeSingle();
  if (profileError) throw new Error(profileError.message || "Failed to load profile note.");
  if (!profile) throw new Error("Guest profile not found.");

  const current = typeof profile.notes === "string" ? profile.notes.trimEnd() : "";
  if (current.includes(trimmed)) return;
  const nextNote = current ? `${current}\n${trimmed}` : trimmed;
  const { error: updateError } = await supabase
    .from("guest_profiles")
    .update({ notes: nextNote })
    .eq("id", profileId);
  if (updateError) throw new Error(updateError.message || "Failed to update profile note.");
}

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
    const noteLine = String(body?.note_line ?? "").trim();

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
    await linkPrimaryGuestToReservation(supabase, reservationId, guestProfileId);

    const { data: profile, error: profileError } = await supabase
      .from("guest_profiles")
      .select("id, first_name, last_name, profile_status, id_type, notes, gender, nationality_code, id_number, country, province, phone")
      .eq("id", guestProfileId)
      .maybeSingle();
    if (profileError) {
      return NextResponse.json({ success: false, error: profileError.message }, { status: 500 });
    }
    const resolvedName = buildGuestDisplayName(profile?.first_name, profile?.last_name, reservation.guest_name || "Guest");
    const matchLevel = classifyNameMatch(reservation.guest_name, resolvedName);

    if (profile?.id_type === "thai_id") {
      const bookingName = String(reservation.guest_name ?? "").trim();
      const cardName = String(resolvedName ?? "").trim();
      if (bookingName && cardName && bookingName !== cardName) {
        await appendProfileNoteLine(supabase, guestProfileId, `จองมาในชื่อ ${bookingName}`);
      } else if (bookingName) {
        await appendProfileNoteLine(supabase, guestProfileId, `จองมาในชื่อ ${bookingName}`);
      }
    }

    if (profile) {
      const completeness = checkProfileCompleteness(profile as Record<string, unknown>);
      if (
        (matchLevel === "exact" || matchLevel === "likely")
        && completeness.is_complete
        && String(profile.profile_status ?? "draft") === "draft"
      ) {
        const { error: promoteError } = await supabase
          .from("guest_profiles")
          .update({ profile_status: "verified" })
          .eq("id", guestProfileId);
        if (promoteError) {
          return NextResponse.json({ success: false, error: promoteError.message }, { status: 500 });
        }
      }
    }

    const { error: nameUpdateError } = await supabase
      .from("reservations")
      .update({ guest_name: resolvedName })
      .eq("id", reservationId);
    if (nameUpdateError) {
      return NextResponse.json({ success: false, error: nameUpdateError.message }, { status: 500 });
    }

    if (noteLine) {
      await appendReservationNoteLine(supabase, reservationId, noteLine);
    }

    const { data: updatedReservation, error } = await supabase
      .from("reservations")
      .select("id, booking_code, guest_name, guest_profile_id, note")
      .eq("id", reservationId)
      .maybeSingle();

    if (error) {
      return NextResponse.json({ success: false, error: error.message }, { status: 500 });
    }

    return NextResponse.json({ success: true, reservation: updatedReservation, name_match: matchLevel });
  } catch (err) {
    if (err instanceof ReservationPartyError) {
      return NextResponse.json(
        { success: false, error: err.message, ...(err.details ?? {}) },
        { status: err.status }
      );
    }
    return NextResponse.json(
      { success: false, error: err instanceof Error ? err.message : "Internal server error" },
      { status: 500 }
    );
  }
}
