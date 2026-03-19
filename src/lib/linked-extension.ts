import { isValidDateString, listNights } from "@/lib/dates";
import { assertRoomAvailableForDateRange, PlannedRoomMoveError } from "@/lib/planned-room-moves";
import { assertRoomTypeCapacityForDateRange } from "@/lib/room-type-capacity";
import { linkPrimaryGuestToReservation, ReservationPartyError } from "@/lib/reservation-party";

type SupabaseLike = {
  from: (table: string) => any;
  rpc: (fn: string, args?: Record<string, unknown>) => any;
};

export class LinkedExtensionError extends Error {
  status: number;

  constructor(message: string, status = 400) {
    super(message);
    this.name = "LinkedExtensionError";
    this.status = status;
  }
}

export type CreateLinkedExtensionPayload = {
  checkin_date: string;
  checkout_date: string;
  source: "walkin" | "ota" | "direct" | "agent";
  room_type_id?: number | null;
  room_id?: string | null;
  rate_plan_id?: string | null;
  note?: string | null;
  copy_accompanying?: boolean;
  copy_preferences?: boolean;
};

export type CreateLinkedExtensionResult = {
  success: true;
  reservation_id: string;
  parent_reservation_id: string;
  locked_room_id: string;
  locked_room_type_id: number;
  locked_room_number: string | null;
  reservation: any;
};

function addDaysYmd(dateYmd: string, days: number): string {
  const d = new Date(`${dateYmd}T12:00:00`);
  if (Number.isNaN(d.getTime())) return dateYmd;
  d.setDate(d.getDate() + days);
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}

export async function createLinkedExtensionReservation(params: {
  supabase: SupabaseLike;
  originalReservationId: string;
  payload: CreateLinkedExtensionPayload;
}): Promise<CreateLinkedExtensionResult> {
  const { supabase, originalReservationId } = params;
  const payload = params.payload;

  if (!isValidDateString(payload.checkin_date) || !isValidDateString(payload.checkout_date)) {
    throw new LinkedExtensionError("Invalid date format. Use YYYY-MM-DD.", 400);
  }
  if (payload.checkout_date <= payload.checkin_date) {
    throw new LinkedExtensionError("checkout_date must be after checkin_date.", 400);
  }

  const nights = listNights(payload.checkin_date, payload.checkout_date);

  const { data: originalReservation, error: originalError } = await supabase
    .from("reservations")
    .select("id, parent_reservation_id, booking_group_id, booking_code, guest_name, phone, source, status, checkin_date, checkout_date, checkin_time, note, specials, guest_profile_id")
    .eq("id", originalReservationId)
    .maybeSingle();

  if (originalError) {
    throw new LinkedExtensionError(originalError.message ?? "Failed to load original reservation.", 500);
  }
  if (!originalReservation) {
    throw new LinkedExtensionError("Original reservation not found.", 404);
  }

  const previousStayDate = addDaysYmd(payload.checkin_date, -1);
  const { data: lastAssignedNight, error: lastAssignedNightError } = await supabase
    .from("reservation_nights")
    .select("room_id, room_type_id, stay_date, rooms(room_number)")
    .eq("reservation_id", originalReservationId)
    .is("cancelled_at", null)
    .lte("stay_date", previousStayDate)
    .order("stay_date", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (lastAssignedNightError) {
    throw new LinkedExtensionError(lastAssignedNightError.message ?? "Failed to resolve current room assignment.", 500);
  }

  const lockedRoomId = String(lastAssignedNight?.room_id ?? "");
  const lockedRoomTypeId = Number(lastAssignedNight?.room_type_id ?? 0);
  const lockedRoomNumber = String((lastAssignedNight as any)?.rooms?.room_number ?? "");

  if (!lockedRoomId) {
    throw new LinkedExtensionError("Cannot extend stay: current assigned room is missing. Please assign room first.", 409);
  }
  if (!Number.isFinite(lockedRoomTypeId) || lockedRoomTypeId <= 0) {
    throw new LinkedExtensionError("Cannot extend stay: current room type is missing.", 409);
  }

  if (payload.room_id && payload.room_id !== lockedRoomId) {
    throw new LinkedExtensionError("Linked extension is locked to the current room. Use Plan Move / Move Room after extension.", 409);
  }
  if (payload.room_type_id && Number(payload.room_type_id) !== lockedRoomTypeId) {
    throw new LinkedExtensionError("Linked extension is locked to the current room type. Use Plan Move / Move Room after extension.", 409);
  }

  await assertRoomAvailableForDateRange(supabase as any, {
    roomId: lockedRoomId,
    checkinDate: payload.checkin_date,
    checkoutDate: payload.checkout_date,
  });

  await assertRoomTypeCapacityForDateRange(supabase as any, {
    roomTypeId: lockedRoomTypeId,
    nights,
  });

  const { data: reservation, error } = await supabase.rpc("booking_create_reservation", {
    p_guest_name: String(originalReservation.guest_name ?? "").trim(),
    p_room_id: lockedRoomId,
    p_room_type_id: lockedRoomTypeId,
    p_checkin_date: payload.checkin_date,
    p_checkout_date: payload.checkout_date,
    p_source: payload.source,
    p_phone: String(originalReservation.phone ?? "").trim() || null,
    p_checkin_time: String(originalReservation.checkin_time ?? "").trim() || null,
    p_note: String(payload.note ?? "").trim() || null,
    p_ota_prices: null,
  });

  if (error) {
    throw new LinkedExtensionError(error.message ?? "Failed to create linked extension reservation.", 500);
  }
  if (!reservation?.id) {
    throw new LinkedExtensionError("Failed to create linked extension reservation.", 500);
  }

  const newReservationId = String(reservation.id);
  const rootParentReservationId = String(
    originalReservation?.parent_reservation_id ?? originalReservationId
  );
  const inheritedBookingGroupId = originalReservation?.booking_group_id
    ? String(originalReservation.booking_group_id)
    : null;

  const { error: updateExtensionError } = await supabase
    .from("reservations")
    .update({
      parent_reservation_id: rootParentReservationId,
      booking_group_id: inheritedBookingGroupId,
      specials: payload.copy_preferences ? originalReservation.specials ?? null : null,
      note: String(payload.note ?? "").trim() || (payload.copy_preferences ? originalReservation.note ?? null : null),
      rate_plan_id: payload.rate_plan_id || null,
    })
    .eq("id", newReservationId);

  if (updateExtensionError) {
    throw new LinkedExtensionError(updateExtensionError.message ?? "Failed to update linked extension metadata.", 500);
  }

  if (originalReservation.guest_profile_id) {
    await linkPrimaryGuestToReservation(supabase as any, newReservationId, String(originalReservation.guest_profile_id));
  }

  if (payload.copy_accompanying) {
    const { data: originalGuests, error: guestsError } = await supabase
      .from("reservation_guests")
      .select("guest_profile_id, role, display_order")
      .eq("reservation_id", originalReservationId)
      .eq("role", "accompanying");

    if (guestsError) {
      throw new LinkedExtensionError(guestsError.message ?? "Failed to load accompanying guests.", 500);
    }

    if ((originalGuests ?? []).length > 0) {
      const companionRows = (originalGuests ?? []).map((row: any) => ({
        reservation_id: newReservationId,
        guest_profile_id: row.guest_profile_id,
        role: "accompanying",
        display_order: row.display_order,
      }));
      const { error: insertGuestsError } = await supabase.from("reservation_guests").insert(companionRows);
      if (insertGuestsError) {
        throw new LinkedExtensionError(insertGuestsError.message ?? "Failed to copy accompanying guests.", 500);
      }
    }
  }

  if (payload.copy_preferences) {
    const { data: prefs, error: prefsError } = await supabase
      .from("reservation_preferences")
      .select("feature_code")
      .eq("reservation_id", originalReservationId);

    if (prefsError) {
      throw new LinkedExtensionError(prefsError.message ?? "Failed to load reservation preferences.", 500);
    }

    if ((prefs ?? []).length > 0) {
      const inserts = (prefs ?? []).map((row: any) => ({
        reservation_id: newReservationId,
        feature_code: row.feature_code,
      }));
      const { error: prefInsertError } = await supabase.from("reservation_preferences").insert(inserts);
      if (prefInsertError) {
        throw new LinkedExtensionError(prefInsertError.message ?? "Failed to copy reservation preferences.", 500);
      }
    }
  }

  await supabase.from("audit_logs").insert({
    action: "linked_extension_created",
    entity_type: "reservation",
    entity_id: newReservationId,
    before_json: {
      parent_reservation_id: rootParentReservationId,
      parent_booking_code: originalReservation.booking_code,
      booking_group_id: inheritedBookingGroupId,
    },
    after_json: {
      source: payload.source,
      checkin_date: payload.checkin_date,
      checkout_date: payload.checkout_date,
      room_id: lockedRoomId,
      room_type_id: lockedRoomTypeId,
      room_number: lockedRoomNumber || null,
      copy_accompanying: Boolean(payload.copy_accompanying),
      copy_preferences: Boolean(payload.copy_preferences),
    },
  });

  return {
    success: true,
    reservation_id: newReservationId,
    parent_reservation_id: rootParentReservationId,
    locked_room_id: lockedRoomId,
    locked_room_type_id: lockedRoomTypeId,
    locked_room_number: lockedRoomNumber || null,
    reservation,
  };
}

export function isKnownLinkedExtensionError(error: unknown): error is PlannedRoomMoveError | ReservationPartyError | LinkedExtensionError {
  return error instanceof PlannedRoomMoveError || error instanceof ReservationPartyError || error instanceof LinkedExtensionError;
}
