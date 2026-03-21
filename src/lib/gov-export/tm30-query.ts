/**
 * TM.30 Query — Load foreign guests who checked in on a specific date
 *
 * Two cases:
 * 1. All guests (primary + accompanying) from reservations that checked in on target_date
 * 2. Accompanying guests added LATER to already-checked-in reservations
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import type { TM30GuestRecord, TM30Validation } from "./types";

/** Bangkok timezone date string from a JS Date */
function toBangkokDate(d: Date): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Bangkok" }).format(d);
}

/** Extract Bangkok date from ISO timestamp string */
function isoToBangkokDate(iso: string): string {
  return toBangkokDate(new Date(iso));
}

export interface TM30QueryResult {
  guests: TM30GuestRecord[];
  validations: TM30Validation[];
}

/**
 * Query foreign guests who need TM.30 reporting for a given date.
 *
 * @param supabase - Supabase client (service role)
 * @param targetDate - YYYY-MM-DD (Bangkok timezone)
 */
export async function queryTM30Guests(
  supabase: SupabaseClient,
  targetDate: string
): Promise<TM30QueryResult> {
  const guests: TM30GuestRecord[] = [];
  const seen = new Set<string>(); // "reservationId:guestProfileId"

  // ─── Case 1: All guests from reservations checked in on target_date ───
  // Pre-filter at DB level: Bangkok date = targetDate means UTC range is [targetDate-1 17:00, targetDate 17:00)
  // This narrows the result set before JS-side Bangkok timezone verification
  const utcRangeStart = `${targetDate}T00:00:00+07:00`; // midnight Bangkok = previous day 17:00 UTC
  const utcRangeEnd = `${targetDate}T23:59:59+07:00`;   // end of day Bangkok

  const { data: checkinReservations, error: checkinError } = await supabase
    .from("reservations")
    .select("id, checkin_date, checkout_date, checked_in_at")
    .not("checked_in_at", "is", null)
    .gte("checked_in_at", utcRangeStart)
    .lte("checked_in_at", utcRangeEnd)
    .in("status", ["active", "checked_out"]);

  if (checkinError) {
    throw new Error(`Failed to load reservations: ${checkinError.message}`);
  }

  // Filter by Bangkok timezone date
  const matchingReservationIds = (checkinReservations ?? [])
    .filter((r: any) => {
      if (!r.checked_in_at) return false;
      return isoToBangkokDate(String(r.checked_in_at)) === targetDate;
    })
    .map((r: any) => String(r.id));

  // Build reservation date map
  const reservationDateMap = new Map<string, { checkin_date: string; checkout_date: string }>();
  for (const r of (checkinReservations ?? []) as any[]) {
    reservationDateMap.set(String(r.id), {
      checkin_date: String(r.checkin_date ?? ""),
      checkout_date: String(r.checkout_date ?? ""),
    });
  }

  if (matchingReservationIds.length > 0) {
    // Load guests for these reservations
    const { data: guestRows, error: guestError } = await supabase
      .from("reservation_guests")
      .select("reservation_id, guest_profile_id, role, guest_profiles(id, first_name, last_name, gender, passport_no, nationality_code, dob)")
      .in("reservation_id", matchingReservationIds);

    if (guestError) {
      throw new Error(`Failed to load reservation guests: ${guestError.message}`);
    }

    for (const row of (guestRows ?? []) as any[]) {
      const gp = Array.isArray(row.guest_profiles) ? row.guest_profiles[0] : row.guest_profiles;
      if (!gp) continue;

      // Skip Thai nationals
      const natCode = String(gp.nationality_code ?? "").toUpperCase();
      if (natCode === "THA") continue;

      const key = `${row.reservation_id}:${gp.id}`;
      if (seen.has(key)) continue;
      seen.add(key);

      const dates = reservationDateMap.get(String(row.reservation_id));
      guests.push({
        guest_profile_id: String(gp.id),
        reservation_id: String(row.reservation_id),
        first_name: gp.first_name ?? null,
        last_name: gp.last_name ?? null,
        gender: gp.gender ?? null,
        passport_no: gp.passport_no ?? null,
        nationality_code: gp.nationality_code ?? null,
        dob: gp.dob ?? null,
        checkin_date: dates?.checkin_date ?? "",
        checkout_date: dates?.checkout_date ?? "",
        role: String(row.role) as "primary" | "accompanying",
        room_number: null, // filled below
      });
    }
  }

  // ─── Case 2: Accompanying guests added LATER ───
  // reservation_guests.created_at (Bangkok date) = targetDate
  // AND reservation is already checked in (before targetDate)
  // AND role = 'accompanying'
  const { data: lateAccompanying, error: lateError } = await supabase
    .from("reservation_guests")
    .select("reservation_id, guest_profile_id, role, created_at, guest_profiles(id, first_name, last_name, gender, passport_no, nationality_code, dob)")
    .eq("role", "accompanying")
    .gte("created_at", utcRangeStart)
    .lte("created_at", utcRangeEnd);

  if (lateError) {
    throw new Error(`Failed to load late accompanying guests: ${lateError.message}`);
  }

  for (const row of (lateAccompanying ?? []) as any[]) {
    if (!row.created_at) continue;
    const createdDate = isoToBangkokDate(String(row.created_at));
    if (createdDate !== targetDate) continue;

    // Skip if reservation already matched in Case 1
    const resId = String(row.reservation_id);
    const gp = Array.isArray(row.guest_profiles) ? row.guest_profiles[0] : row.guest_profiles;
    if (!gp) continue;

    const key = `${resId}:${gp.id}`;
    if (seen.has(key)) continue;

    // Check: reservation must be checked in before today
    const reservation = (checkinReservations ?? []).find((r: any) => String(r.id) === resId) as any;
    if (!reservation?.checked_in_at) {
      // Load it
      const { data: resRow } = await supabase
        .from("reservations")
        .select("id, checkin_date, checkout_date, checked_in_at, status")
        .eq("id", resId)
        .maybeSingle();
      if (!resRow?.checked_in_at) continue;
      if (!["active", "checked_out"].includes(String(resRow.status))) continue;
      const checkinBkkDate = isoToBangkokDate(String(resRow.checked_in_at));
      if (checkinBkkDate >= targetDate) continue; // same day = already handled in Case 1
      reservationDateMap.set(resId, {
        checkin_date: String(resRow.checkin_date ?? ""),
        checkout_date: String(resRow.checkout_date ?? ""),
      });
    } else {
      const checkinBkkDate = isoToBangkokDate(String(reservation.checked_in_at));
      if (checkinBkkDate >= targetDate) continue;
    }

    // Skip Thai nationals
    const natCode = String(gp.nationality_code ?? "").toUpperCase();
    if (natCode === "THA") continue;

    seen.add(key);

    const dates = reservationDateMap.get(resId);
    guests.push({
      guest_profile_id: String(gp.id),
      reservation_id: resId,
      first_name: gp.first_name ?? null,
      last_name: gp.last_name ?? null,
      gender: gp.gender ?? null,
      passport_no: gp.passport_no ?? null,
      nationality_code: gp.nationality_code ?? null,
      dob: gp.dob ?? null,
      checkin_date: dates?.checkin_date ?? "",
      checkout_date: dates?.checkout_date ?? "",
      role: "accompanying",
      room_number: null,
    });
  }

  // ─── Resolve room numbers ───
  if (guests.length > 0) {
    const resIds = [...new Set(guests.map((g) => g.reservation_id))];
    const { data: nightRows } = await supabase
      .from("reservation_nights")
      .select("reservation_id, rooms(room_number)")
      .in("reservation_id", resIds)
      .is("cancelled_at", null)
      .order("stay_date", { ascending: false });

    const roomMap = new Map<string, string>();
    for (const row of (nightRows ?? []) as any[]) {
      const resId = String(row.reservation_id);
      if (roomMap.has(resId)) continue;
      const roomObj = Array.isArray(row.rooms) ? row.rooms[0] : row.rooms;
      if (roomObj?.room_number) {
        roomMap.set(resId, String(roomObj.room_number));
      }
    }

    for (const guest of guests) {
      guest.room_number = roomMap.get(guest.reservation_id) ?? null;
    }
  }

  // ─── Validations ───
  const validations: TM30Validation[] = [];
  for (const g of guests) {
    if (!g.first_name) {
      validations.push({ guest_profile_id: g.guest_profile_id, field: "first_name", message: "Missing first name" });
    }
    if (!g.passport_no) {
      validations.push({ guest_profile_id: g.guest_profile_id, field: "passport_no", message: "Missing passport number" });
    }
    if (!g.nationality_code) {
      validations.push({ guest_profile_id: g.guest_profile_id, field: "nationality_code", message: "Missing nationality" });
    }
    if (!g.gender || g.gender === "Other") {
      validations.push({ guest_profile_id: g.guest_profile_id, field: "gender", message: "Missing or invalid gender" });
    }
  }

  return { guests, validations };
}
