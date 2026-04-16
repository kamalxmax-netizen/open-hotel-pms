/**
 * TM.30 Query — Load foreign guests relevant to a specific TM.30 report date.
 *
 * Default rows follow the actual arrival date. If an accompanying foreign
 * passport holder is added after the original check-in day, we also surface a
 * warning row on the added date so staff can decide whether that duplicate
 * should still be exported for that day's submission.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import type { TM30GuestRecord, TM30Validation } from "./types";

const TM30_LATE_ADDED_EXCLUSION_TYPE = "late_added_duplicate" as const;

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

export interface TM30QueryOptions {
  includeExcluded?: boolean;
}

function shouldIncludeTM30Guest(profile: {
  nationality_code?: unknown;
  id_type?: unknown;
} | null | undefined): boolean {
  const natCode = String(profile?.nationality_code ?? "").trim().toUpperCase();
  const idType = String(profile?.id_type ?? "").trim().toLowerCase();
  return natCode !== "THA" && idType === "passport";
}

function exclusionKey(reportDate: string, reservationId: string, guestProfileId: string): string {
  return `${reportDate}:${reservationId}:${guestProfileId}:${TM30_LATE_ADDED_EXCLUSION_TYPE}`;
}

/**
 * Query foreign guests who need TM.30 reporting for a given date.
 *
 * @param supabase - Supabase client (service role)
 * @param targetDate - YYYY-MM-DD (Bangkok timezone)
 */
export async function queryTM30Guests(
  supabase: SupabaseClient,
  targetDate: string,
  options: TM30QueryOptions = {}
): Promise<TM30QueryResult> {
  const includeExcluded = options.includeExcluded ?? true;
  const guests: TM30GuestRecord[] = [];
  const seen = new Set<string>(); // "reservationId:guestProfileId"

  // ─── Case 1: All guests from reservations checked in on target_date ───
  // Pre-filter at DB level: Bangkok date = targetDate means UTC range is [targetDate-1 17:00, targetDate 17:00)
  // This narrows the result set before JS-side Bangkok timezone verification
  const utcRangeStart = `${targetDate}T00:00:00+07:00`; // midnight Bangkok = previous day 17:00 UTC
  const utcRangeEnd = `${targetDate}T23:59:59+07:00`;   // end of day Bangkok

  const { data: checkedInAuditRows, error: checkedInAuditError } = await supabase
    .from("audit_logs")
    .select("entity_id, business_date")
    .eq("entity_type", "reservation")
    .eq("action", "checked_in")
    .eq("business_date", targetDate);

  if (checkedInAuditError) {
    throw new Error(`Failed to load check-in audit logs: ${checkedInAuditError.message}`);
  }

  const auditTargetReservationIds = [
    ...new Set(
      (checkedInAuditRows ?? [])
        .map((row: any) => String(row.entity_id ?? "").trim())
        .filter(Boolean)
    ),
  ];

  let auditReservations: any[] = [];
  if (auditTargetReservationIds.length > 0) {
    const { data, error } = await supabase
      .from("reservations")
      .select("id, parent_reservation_id, checkin_date, checkout_date, checked_in_at, status")
      .in("id", auditTargetReservationIds)
      .in("status", ["active", "checked_out"]);

    if (error) {
      throw new Error(`Failed to load audited reservations: ${error.message}`);
    }
    auditReservations = data ?? [];
  }

  const { data: timestampReservations, error: checkinError } = await supabase
    .from("reservations")
    .select("id, parent_reservation_id, checkin_date, checkout_date, checked_in_at")
    .not("checked_in_at", "is", null)
    .gte("checked_in_at", utcRangeStart)
    .lte("checked_in_at", utcRangeEnd)
    .in("status", ["active", "checked_out"]);

  if (checkinError) {
    throw new Error(`Failed to load reservations: ${checkinError.message}`);
  }

  const timestampReservationIds = [
    ...new Set((timestampReservations ?? []).map((r: any) => String(r.id)).filter(Boolean)),
  ];
  const auditBusinessDateByReservation = new Map<string, string>();
  for (const row of checkedInAuditRows ?? []) {
    const id = String((row as any).entity_id ?? "").trim();
    const businessDate = String((row as any).business_date ?? "").trim();
    if (id && businessDate) auditBusinessDateByReservation.set(id, businessDate);
  }

  if (timestampReservationIds.length > 0) {
    const { data: timestampAuditRows, error: timestampAuditError } = await supabase
      .from("audit_logs")
      .select("entity_id, business_date, created_at")
      .eq("entity_type", "reservation")
      .eq("action", "checked_in")
      .in("entity_id", timestampReservationIds)
      .order("created_at", { ascending: false });

    if (timestampAuditError) {
      throw new Error(`Failed to load timestamp check-in audit logs: ${timestampAuditError.message}`);
    }

    for (const row of timestampAuditRows ?? []) {
      const id = String((row as any).entity_id ?? "").trim();
      const businessDate = String((row as any).business_date ?? "").trim();
      if (id && businessDate && !auditBusinessDateByReservation.has(id)) {
        auditBusinessDateByReservation.set(id, businessDate);
      }
    }
  }

  const checkinReservationMap = new Map<string, any>();
  for (const reservation of [...auditReservations, ...(timestampReservations ?? [])] as any[]) {
    const id = String(reservation?.id ?? "").trim();
    if (id) checkinReservationMap.set(id, reservation);
  }
  const checkinReservations = Array.from(checkinReservationMap.values());
  const auditTargetReservationSet = new Set(auditTargetReservationIds);

  // Filter by Bangkok timezone date
  const matchingReservationIds = checkinReservations
    .filter((r: any) => {
      if (r.parent_reservation_id) return false;
      const reservationId = String(r.id);
      if (auditTargetReservationSet.has(reservationId)) return true;
      if (!r.checked_in_at) return false;

      const auditBusinessDate = auditBusinessDateByReservation.get(reservationId);
      if (auditBusinessDate && auditBusinessDate !== targetDate) return false;

      return isoToBangkokDate(String(r.checked_in_at)) === targetDate;
    })
    .map((r: any) => String(r.id));

  // Build reservation date map
  const reservationDateMap = new Map<string, { checkin_date: string; checkout_date: string }>();
  for (const r of checkinReservations as any[]) {
    reservationDateMap.set(String(r.id), {
      checkin_date: String(r.checkin_date ?? ""),
      checkout_date: String(r.checkout_date ?? ""),
    });
  }

  if (matchingReservationIds.length > 0) {
    // Load guests for these reservations
    const { data: guestRows, error: guestError } = await supabase
      .from("reservation_guests")
      .select("reservation_id, guest_profile_id, role, guest_profiles(id, first_name, last_name, gender, id_type, passport_no, nationality_code, dob)")
      .in("reservation_id", matchingReservationIds);

    if (guestError) {
      throw new Error(`Failed to load reservation guests: ${guestError.message}`);
    }

    for (const row of (guestRows ?? []) as any[]) {
      const gp = Array.isArray(row.guest_profiles) ? row.guest_profiles[0] : row.guest_profiles;
      if (!gp) continue;

      if (!shouldIncludeTM30Guest(gp)) continue;

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
        id_type: gp.id_type ?? null,
        passport_no: gp.passport_no ?? null,
        nationality_code: gp.nationality_code ?? null,
        dob: gp.dob ?? null,
        checkin_date: dates?.checkin_date ?? "",
        checkout_date: dates?.checkout_date ?? "",
        role: String(row.role) as "primary" | "accompanying",
        room_number: null, // filled below
        report_date: targetDate,
        entry_kind: "checkin",
        late_added_at: null,
        excluded_from_export: false,
      });
    }
  }

  // ─── Case 2: Accompanying guests added later ────────────────────────────────
  // Keep the original check-in-day logic, but also surface the added-later row
  // on the day it was added so staff can choose whether to re-export it.
  const { data: lateAccompanying, error: lateError } = await supabase
    .from("reservation_guests")
    .select("reservation_id, guest_profile_id, role, created_at, guest_profiles(id, first_name, last_name, gender, id_type, passport_no, nationality_code, dob)")
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

    const resId = String(row.reservation_id);
    const gp = Array.isArray(row.guest_profiles) ? row.guest_profiles[0] : row.guest_profiles;
    if (!gp) continue;
    if (!shouldIncludeTM30Guest(gp)) continue;

    const key = `${resId}:${gp.id}`;
    if (seen.has(key)) continue;

    const reservation = checkinReservations.find((r: any) => String(r.id) === resId) as any;
    if (!reservation?.checked_in_at) {
      const { data: resRow, error: resError } = await supabase
        .from("reservations")
        .select("id, parent_reservation_id, checkin_date, checkout_date, checked_in_at, status")
        .eq("id", resId)
        .maybeSingle();
      if (resError) {
        throw new Error(`Failed to load reservation for late accompanying guest: ${resError.message}`);
      }
      if (!resRow?.checked_in_at) continue;
      if (resRow.parent_reservation_id) continue;
      if (!["active", "checked_out"].includes(String(resRow.status))) continue;
      const checkinBkkDate = isoToBangkokDate(String(resRow.checked_in_at));
      if (checkinBkkDate >= targetDate) continue;
      reservationDateMap.set(resId, {
        checkin_date: String(resRow.checkin_date ?? ""),
        checkout_date: String(resRow.checkout_date ?? ""),
      });
    } else {
      if (reservation.parent_reservation_id) continue;
      const checkinBkkDate = isoToBangkokDate(String(reservation.checked_in_at));
      if (checkinBkkDate >= targetDate) continue;
    }

    seen.add(key);

    const dates = reservationDateMap.get(resId);
    guests.push({
      guest_profile_id: String(gp.id),
      reservation_id: resId,
      first_name: gp.first_name ?? null,
      last_name: gp.last_name ?? null,
      gender: gp.gender ?? null,
      id_type: gp.id_type ?? null,
      passport_no: gp.passport_no ?? null,
      nationality_code: gp.nationality_code ?? null,
      dob: gp.dob ?? null,
      checkin_date: dates?.checkin_date ?? "",
      checkout_date: dates?.checkout_date ?? "",
      role: "accompanying",
      room_number: null,
      report_date: targetDate,
      entry_kind: "late_added_duplicate",
      late_added_at: String(row.created_at),
      excluded_from_export: false,
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

  const lateDuplicateGuests = guests.filter((guest) => guest.entry_kind === "late_added_duplicate");
  if (lateDuplicateGuests.length > 0) {
    const reservationIds = [...new Set(lateDuplicateGuests.map((guest) => guest.reservation_id))];
    const guestProfileIds = [...new Set(lateDuplicateGuests.map((guest) => guest.guest_profile_id))];
    const { data: exclusionRows, error: exclusionError } = await supabase
      .from("tm30_report_exclusions")
      .select("report_date, reservation_id, guest_profile_id, exclusion_type")
      .eq("report_date", targetDate)
      .eq("exclusion_type", TM30_LATE_ADDED_EXCLUSION_TYPE)
      .in("reservation_id", reservationIds)
      .in("guest_profile_id", guestProfileIds);

    if (exclusionError) {
      throw new Error(`Failed to load TM.30 exclusions: ${exclusionError.message}`);
    }

    const excludedKeys = new Set(
      (exclusionRows ?? []).map((row: any) =>
        exclusionKey(
          String(row.report_date ?? targetDate),
          String(row.reservation_id),
          String(row.guest_profile_id)
        )
      )
    );

    for (const guest of guests) {
      if (guest.entry_kind !== "late_added_duplicate") continue;
      guest.excluded_from_export = excludedKeys.has(
        exclusionKey(targetDate, guest.reservation_id, guest.guest_profile_id)
      );
    }
  }

  const visibleGuests = includeExcluded
    ? guests
    : guests.filter((guest) => !guest.excluded_from_export);

  // ─── Validations ───
  const validations: TM30Validation[] = [];
  for (const g of visibleGuests) {
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

  return { guests: visibleGuests, validations };
}
