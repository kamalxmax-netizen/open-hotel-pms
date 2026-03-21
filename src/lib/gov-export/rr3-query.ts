/**
 * รร.3 Query — Load checked-out guests for monthly hotel registration report
 *
 * Scope: reservations checked out in the target month
 * Filter logic: OR between source filter and tax invoice filter
 * Accompanying guest toggle: separate include/exclude
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import type { RR3GuestRecord, RR3FilterParams, RR3Validation } from "./types";

function monthDateRange(year: number, month: number): { from: string; to: string } {
  const from = `${year}-${String(month).padStart(2, "0")}-01`;
  const lastDay = new Date(year, month, 0).getDate();
  const to = `${year}-${String(month).padStart(2, "0")}-${String(lastDay).padStart(2, "0")}`;
  return { from, to };
}

export interface RR3QueryResult {
  entries: RR3GuestRecord[];
  validations: RR3Validation[];
  summary: {
    total_entries: number;
    total_price: number;
  };
}

/**
 * Apply OR-based filter logic.
 * - If no filters active → include all
 * - Source filter OR Tax Invoice filter (either matches → include)
 */
function matchesFilters(
  record: { source: string; tax_invoice_requested: boolean },
  filters: RR3FilterParams
): boolean {
  const hasSourceFilter = filters.sources.length > 0;
  const hasTaxFilter = filters.tax_invoice_only;
  const normalizedRecordSource = record.source.trim().toLowerCase();
  const normalizedFilterSources = filters.sources.map((s) => s.trim().toLowerCase());

  if (!hasSourceFilter && !hasTaxFilter) return true;

  if (hasSourceFilter && normalizedFilterSources.includes(normalizedRecordSource)) return true;
  if (hasTaxFilter && record.tax_invoice_requested) return true;

  return false;
}

/**
 * Query checked-out guests for รร.3 monthly report.
 */
export async function queryRR3Guests(
  supabase: SupabaseClient,
  filters: RR3FilterParams
): Promise<RR3QueryResult> {
  const { from: dateFrom, to: dateTo } = monthDateRange(filters.year, filters.month);

  // 1. Load checked-out reservations in target month
  const { data: reservations, error: resError } = await supabase
    .from("reservations")
    .select("id, booking_code, guest_name, source, checkin_date, checkout_date, checked_in_at, tax_invoice_requested, guest_profile_id")
    .eq("status", "checked_out")
    .gte("checkout_date", dateFrom)
    .lte("checkout_date", dateTo)
    .order("checkout_date", { ascending: true });

  if (resError) {
    throw new Error(`Failed to load reservations: ${resError.message}`);
  }

  const reservationRows = (reservations ?? []) as any[];

  // 2. Apply source + tax invoice filters (OR logic)
  const filteredReservations = reservationRows.filter((r) =>
    matchesFilters(
      { source: String(r.source ?? ""), tax_invoice_requested: Boolean(r.tax_invoice_requested) },
      filters
    )
  );

  if (filteredReservations.length === 0) {
    return { entries: [], validations: [], summary: { total_entries: 0, total_price: 0 } };
  }

  const reservationIds = filteredReservations.map((r) => String(r.id));

  // 3. Load folio_payments to compute full folio price per reservation
  //    Revenue = SUM(payment rows) excluding deposit/commission/tip/transportation
  const { data: folioRows } = await supabase
    .from("folio_payments")
    .select("reservation_id, tx_type, amount, revenue_category")
    .in("reservation_id", reservationIds);

  const folioPriceMap = new Map<string, number>();
  for (const row of (folioRows ?? []) as any[]) {
    const resId = String(row.reservation_id);
    const txType = String(row.tx_type ?? "").toLowerCase();
    const category = String(row.revenue_category ?? "").toLowerCase();
    if (txType !== "payment") continue;
    // Exclude non-revenue categories
    if (["deposit", "commission", "tip", "transportation"].includes(category)) continue;
    const amount = Number(row.amount ?? 0);
    folioPriceMap.set(resId, (folioPriceMap.get(resId) ?? 0) + amount);
  }

  // 4. Load all guests for these reservations (was step 3)
  const { data: guestRows, error: guestError } = await supabase
    .from("reservation_guests")
    .select("reservation_id, guest_profile_id, role, guest_profiles(id, first_name, last_name, gender, nationality_code, country, province, id_type, id_number, passport_no)")
    .in("reservation_id", reservationIds);

  if (guestError) {
    throw new Error(`Failed to load reservation guests: ${guestError.message}`);
  }

  // 4. Load room numbers (latest night per reservation)
  const { data: nightRows } = await supabase
    .from("reservation_nights")
    .select("reservation_id, rooms(room_number)")
    .in("reservation_id", reservationIds)
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

  // 5. Build reservation lookup
  const resMap = new Map<string, any>();
  for (const r of filteredReservations) {
    resMap.set(String(r.id), r);
  }

  // 6. Build guest records
  const entries: RR3GuestRecord[] = [];

  for (const row of (guestRows ?? []) as any[]) {
    const resId = String(row.reservation_id);
    const res = resMap.get(resId);
    if (!res) continue;

    const role = String(row.role) as "primary" | "accompanying";

    // Apply accompanying filter
    if (!filters.include_accompanying && role === "accompanying") continue;

    const gp = Array.isArray(row.guest_profiles) ? row.guest_profiles[0] : row.guest_profiles;
    if (!gp) continue;

    entries.push({
      reservation_id: resId,
      guest_profile_id: String(gp.id),
      role,
      first_name: gp.first_name ?? null,
      last_name: gp.last_name ?? null,
      nationality_code: gp.nationality_code ?? null,
      country: gp.country ?? null,
      province: gp.province ?? null,
      id_type: gp.id_type ?? null,
      id_number: gp.id_number ?? null,
      passport_no: gp.passport_no ?? null,
      checkin_date: String(res.checkin_date ?? ""),
      checkout_date: String(res.checkout_date ?? ""),
      checked_in_at: res.checked_in_at ?? null,
      checked_out_at: null, // Not stored separately; use checkout_date
      room_number: roomMap.get(resId) ?? null,
      source: String(res.source ?? ""),
      tax_invoice_requested: Boolean(res.tax_invoice_requested),
      total_price: role === "primary" ? (folioPriceMap.get(resId) ?? 0) : 0,
      booking_code: res.booking_code ?? null,
    });
  }

  // Sort: by checkout_date, then reservation_id, then role (primary first)
  entries.sort((a, b) => {
    const dateCompare = a.checkout_date.localeCompare(b.checkout_date);
    if (dateCompare !== 0) return dateCompare;
    const resCompare = a.reservation_id.localeCompare(b.reservation_id);
    if (resCompare !== 0) return resCompare;
    // primary first
    if (a.role === "primary" && b.role !== "primary") return -1;
    if (a.role !== "primary" && b.role === "primary") return 1;
    return 0;
  });

  // 7. Validations
  const validations: RR3Validation[] = [];
  for (const e of entries) {
    if (!e.first_name && !e.last_name) {
      validations.push({ reservation_id: e.reservation_id, guest_profile_id: e.guest_profile_id, field: "name", message: "ขาด: ชื่อ-สกุล" });
    }
    if (!e.nationality_code) {
      validations.push({ reservation_id: e.reservation_id, guest_profile_id: e.guest_profile_id, field: "nationality", message: "ขาด: สัญชาติ" });
    }
    if (!e.id_number && !e.passport_no) {
      validations.push({ reservation_id: e.reservation_id, guest_profile_id: e.guest_profile_id, field: "id", message: "ขาด: เลขบัตร/passport" });
    }
  }

  // 8. Summary (price only from primary guests to avoid double-counting)
  const totalPrice = entries
    .filter((e) => e.role === "primary")
    .reduce((sum, e) => sum + e.total_price, 0);

  return {
    entries,
    validations,
    summary: {
      total_entries: entries.length,
      total_price: Math.round(totalPrice * 100) / 100,
    },
  };
}
