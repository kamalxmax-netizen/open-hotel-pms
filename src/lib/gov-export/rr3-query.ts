/**
 * รร.3 Query — Load checked-out guests for monthly hotel registration report
 *
 * Scope: reservations checked out in the target month
 * Filter logic: OR between source filter and tax invoice filter
 * Accompanying guest toggle: separate include/exclude
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import type { RR3GuestRecord, RR3FilterParams, RR3Validation } from "./types";
import { loadIssuedFullTaxInvoiceMap } from "@/lib/monthly-audit";

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

function normalizeStatus(value: unknown): string {
  return String(value ?? "").trim().toLowerCase();
}

function isSuppressedLinkedStatus(value: unknown): boolean {
  const status = normalizeStatus(value);
  return status === "cancelled" || status === "no_show";
}

function normalizeAuditChannel(value: unknown): string {
  const normalized = String(value ?? "").trim().toLowerCase();
  if (normalized === "ota" || normalized === "agent") return "ota";
  if (normalized === "direct") return "direct";
  return "walkin";
}

function matchesRR3Source(reportSource: string, hasIssuedFullTaxInvoice: boolean, filters: RR3FilterParams): boolean {
  const normalizedFilterSources = filters.sources.map((s) => s.trim().toLowerCase());
  const hasSourceFilter = normalizedFilterSources.length > 0;
  if (!hasSourceFilter && !filters.tax_invoice_only) return true;
  if (filters.tax_invoice_only && hasIssuedFullTaxInvoice) return true;
  return hasSourceFilter && normalizedFilterSources.includes(reportSource);
}

async function queryRR3GuestsFromMonthlyAudit(
  supabase: SupabaseClient,
  filters: RR3FilterParams,
  periodId: string
): Promise<RR3QueryResult> {
  const { from: dateFrom, to: dateTo } = monthDateRange(filters.year, filters.month);

  const { data: auditRows, error: auditError } = await supabase
    .from("monthly_audit_entries")
    .select("id, reservation_id, source, checkin_date, checkout_date, total_revenue")
    .eq("period_id", periodId);

  if (auditError) {
    throw new Error(`Failed to load Monthly Audit entries for รร.3: ${auditError.message}`);
  }

  const auditEntries = (auditRows ?? []) as any[];
  if (auditEntries.length === 0) {
    return { entries: [], validations: [], summary: { total_entries: 0, total_price: 0 } };
  }

  const auditEntryIds = auditEntries.map((row) => String(row.id));
  const reservationIds = auditEntries.map((row) => String(row.reservation_id)).filter(Boolean);
  const auditEntryByReservationId = new Map(auditEntries.map((row) => [String(row.reservation_id), row]));

  const { data: channelFlags, error: channelFlagError } = await supabase
    .from("monthly_audit_channel_flag")
    .select("entry_id, tax_invoice_channel")
    .in("entry_id", auditEntryIds);

  if (channelFlagError) {
    throw new Error(`Failed to load Monthly Audit channel flags for รร.3: ${channelFlagError.message}`);
  }

  const channelByEntryId = new Map(
    ((channelFlags ?? []) as any[]).map((row) => [String(row.entry_id), normalizeAuditChannel(row.tax_invoice_channel)])
  );
  const issuedFullTaxInvoiceMap = await loadIssuedFullTaxInvoiceMap(supabase as any, reservationIds);

  const { data: seedReservations, error: seedError } = await supabase
    .from("reservations")
    .select("id, parent_reservation_id, booking_code, guest_name, source, checkin_date, checkout_date, checked_in_at, tax_invoice_requested, guest_profile_id, status")
    .in("id", reservationIds);

  if (seedError) {
    throw new Error(`Failed to load Monthly Audit reservations for รร.3: ${seedError.message}`);
  }

  const seedRows = (seedReservations ?? []) as any[];
  const rootIds = Array.from(
    new Set(seedRows.map((row) => String(row.parent_reservation_id ?? row.id ?? "")).filter(Boolean))
  );
  if (rootIds.length === 0) {
    return { entries: [], validations: [], summary: { total_entries: 0, total_price: 0 } };
  }

  const [rootsResult, childrenResult] = await Promise.all([
    supabase
      .from("reservations")
      .select("id, parent_reservation_id, booking_code, guest_name, source, checkin_date, checkout_date, checked_in_at, tax_invoice_requested, guest_profile_id, status")
      .in("id", rootIds),
    supabase
      .from("reservations")
      .select("id, parent_reservation_id, booking_code, guest_name, source, checkin_date, checkout_date, checked_in_at, tax_invoice_requested, guest_profile_id, status")
      .in("parent_reservation_id", rootIds),
  ]);

  if (rootsResult.error) throw new Error(`Failed to load linked reservation roots: ${rootsResult.error.message}`);
  if (childrenResult.error) throw new Error(`Failed to load linked reservation children: ${childrenResult.error.message}`);

  const reservationChains = new Map<string, any[]>();
  for (const row of ([...(rootsResult.data ?? []), ...(childrenResult.data ?? [])] as any[])) {
    const rootId = String(row.parent_reservation_id ?? row.id ?? "").trim();
    if (!rootId) continue;
    const bucket = reservationChains.get(rootId) ?? [];
    bucket.push(row);
    reservationChains.set(rootId, bucket);
  }

  const includedChains = new Map<string, { rows: any[]; finalRow: any; reportSource: string; hasIssuedFullTaxInvoice: boolean; totalPrice: number }>();
  for (const [rootId, rows] of reservationChains.entries()) {
    const activeRows = rows
      .filter((row) => !isSuppressedLinkedStatus(row.status) && row.checkin_date && row.checkout_date)
      .sort((left, right) => {
        const checkoutCompare = String(left.checkout_date ?? "").localeCompare(String(right.checkout_date ?? ""));
        if (checkoutCompare !== 0) return checkoutCompare;
        return String(left.checkin_date ?? "").localeCompare(String(right.checkin_date ?? ""));
      });
    if (activeRows.length === 0) continue;

    const finalRow = activeRows[activeRows.length - 1];
    const finalCheckout = String(finalRow.checkout_date ?? "");
    if (!finalCheckout || finalCheckout < dateFrom || finalCheckout > dateTo) continue;
    if (normalizeStatus(finalRow.status) !== "checked_out") continue;

    const chainEntries = activeRows
      .map((row) => auditEntryByReservationId.get(String(row.id)))
      .filter(Boolean);
    if (chainEntries.length === 0) continue;

    const hasIssuedFullTaxInvoice = activeRows.some((row) => issuedFullTaxInvoiceMap.has(String(row.id)));
    const finalAuditEntry =
      auditEntryByReservationId.get(String(finalRow.id)) ?? chainEntries[chainEntries.length - 1];
    const reportSource = hasIssuedFullTaxInvoice
      ? "ota"
      : (channelByEntryId.get(String(finalAuditEntry.id)) ?? normalizeAuditChannel(finalAuditEntry.source));

    if (!matchesRR3Source(reportSource, hasIssuedFullTaxInvoice, filters)) continue;

    const totalPrice = chainEntries.reduce((sum, entry) => sum + Number(entry.total_revenue ?? 0), 0);
    includedChains.set(rootId, { rows: activeRows, finalRow, reportSource, hasIssuedFullTaxInvoice, totalPrice });
  }

  if (includedChains.size === 0) {
    return { entries: [], validations: [], summary: { total_entries: 0, total_price: 0 } };
  }

  const includedReservationIds = Array.from(
    new Set(Array.from(includedChains.values()).flatMap((chain) => chain.rows.map((row) => String(row.id))))
  );
  const rootIdByReservationId = new Map<string, string>();
  for (const [rootId, chain] of includedChains.entries()) {
    for (const row of chain.rows) rootIdByReservationId.set(String(row.id), rootId);
  }

  const { data: guestRows, error: guestError } = await supabase
    .from("reservation_guests")
    .select("reservation_id, guest_profile_id, role, guest_profiles(id, first_name, last_name, gender, nationality_code, country, province, id_type, id_number, passport_no)")
    .in("reservation_id", includedReservationIds);

  if (guestError) throw new Error(`Failed to load reservation guests: ${guestError.message}`);

  const { data: nightRows } = await supabase
    .from("reservation_nights")
    .select("reservation_id, rooms(room_number)")
    .in("reservation_id", includedReservationIds)
    .is("cancelled_at", null)
    .order("stay_date", { ascending: false });

  const roomMap = new Map<string, string>();
  for (const row of (nightRows ?? []) as any[]) {
    const resId = String(row.reservation_id);
    if (roomMap.has(resId)) continue;
    const roomObj = Array.isArray(row.rooms) ? row.rooms[0] : row.rooms;
    if (roomObj?.room_number) roomMap.set(resId, String(roomObj.room_number));
  }

  const guestAggregateByRootAndProfile = new Map<string, any>();
  for (const row of (guestRows ?? []) as any[]) {
    const resId = String(row.reservation_id);
    const rootId = rootIdByReservationId.get(resId);
    if (!rootId) continue;
    const gp = Array.isArray(row.guest_profiles) ? row.guest_profiles[0] : row.guest_profiles;
    if (!gp?.id) continue;
    const role = String(row.role) as "primary" | "accompanying";
    const key = `${rootId}:${String(gp.id)}`;
    const existing = guestAggregateByRootAndProfile.get(key);
    if (!existing) {
      guestAggregateByRootAndProfile.set(key, {
        rootId,
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
      });
      continue;
    }

    if (existing.role !== "primary" && role === "primary") existing.role = "primary";
    if (!existing.first_name && gp.first_name) existing.first_name = gp.first_name;
    if (!existing.last_name && gp.last_name) existing.last_name = gp.last_name;
    if (!existing.nationality_code && gp.nationality_code) existing.nationality_code = gp.nationality_code;
    if (!existing.country && gp.country) existing.country = gp.country;
    if (!existing.province && gp.province) existing.province = gp.province;
    if (!existing.id_type && gp.id_type) existing.id_type = gp.id_type;
    if (!existing.id_number && gp.id_number) existing.id_number = gp.id_number;
    if (!existing.passport_no && gp.passport_no) existing.passport_no = gp.passport_no;
  }

  const entries: RR3GuestRecord[] = [];
  for (const aggregate of guestAggregateByRootAndProfile.values()) {
    const chain = includedChains.get(String(aggregate.rootId));
    if (!chain) continue;
    const role = aggregate.role as "primary" | "accompanying";
    if (!filters.include_accompanying && role === "accompanying") continue;

    const fullCheckin = String(chain.rows[0]?.checkin_date ?? "");
    const finalRow = chain.finalRow;
    const finalReservationId = String(finalRow?.id ?? "");
    const fullCheckout = String(finalRow?.checkout_date ?? "");

    entries.push({
      reservation_id: finalReservationId,
      guest_profile_id: String(aggregate.guest_profile_id),
      role,
      first_name: aggregate.first_name ?? null,
      last_name: aggregate.last_name ?? null,
      nationality_code: aggregate.nationality_code ?? null,
      country: aggregate.country ?? null,
      province: aggregate.province ?? null,
      id_type: aggregate.id_type ?? null,
      id_number: aggregate.id_number ?? null,
      passport_no: aggregate.passport_no ?? null,
      checkin_date: fullCheckin,
      checkout_date: fullCheckout,
      checked_in_at: chain.rows[0]?.checked_in_at ?? null,
      checked_out_at: null,
      room_number: roomMap.get(finalReservationId) ?? null,
      source: chain.reportSource,
      tax_invoice_requested: chain.hasIssuedFullTaxInvoice,
      total_price: role === "primary" ? Math.round(chain.totalPrice * 100) / 100 : 0,
      booking_code: finalRow?.booking_code ?? chain.rows[0]?.booking_code ?? null,
    });
  }

  entries.sort((a, b) => {
    const dateCompare = a.checkout_date.localeCompare(b.checkout_date);
    if (dateCompare !== 0) return dateCompare;
    const resCompare = a.reservation_id.localeCompare(b.reservation_id);
    if (resCompare !== 0) return resCompare;
    if (a.role === "primary" && b.role !== "primary") return -1;
    if (a.role !== "primary" && b.role === "primary") return 1;
    return 0;
  });

  const validations = buildRR3Validations(entries);
  const totalPrice = entries
    .filter((entry) => entry.role === "primary")
    .reduce((sum, entry) => sum + entry.total_price, 0);

  return {
    entries,
    validations,
    summary: {
      total_entries: entries.length,
      total_price: Math.round(totalPrice * 100) / 100,
    },
  };
}

function buildRR3Validations(entries: RR3GuestRecord[]): RR3Validation[] {
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
  return validations;
}

/**
 * Query checked-out guests for รร.3 monthly report.
 */
export async function queryRR3Guests(
  supabase: SupabaseClient,
  filters: RR3FilterParams
): Promise<RR3QueryResult> {
  const { from: dateFrom, to: dateTo } = monthDateRange(filters.year, filters.month);

  const { data: auditPeriod, error: auditPeriodError } = await supabase
    .from("monthly_audit_periods")
    .select("id")
    .eq("year", filters.year)
    .eq("month", filters.month)
    .maybeSingle();

  if (auditPeriodError) {
    throw new Error(`Failed to check Monthly Audit period for รร.3: ${auditPeriodError.message}`);
  }

  if (auditPeriod?.id) {
    return queryRR3GuestsFromMonthlyAudit(supabase, filters, String(auditPeriod.id));
  }

  // 1. Load checked-out reservations in target month (seed rows for linked chains)
  const { data: reservations, error: resError } = await supabase
    .from("reservations")
    .select("id, parent_reservation_id, booking_code, guest_name, source, checkin_date, checkout_date, checked_in_at, tax_invoice_requested, guest_profile_id, status")
    .eq("status", "checked_out")
    .gte("checkout_date", dateFrom)
    .lte("checkout_date", dateTo)
    .order("checkout_date", { ascending: true });

  if (resError) {
    throw new Error(`Failed to load reservations: ${resError.message}`);
  }

  const reservationRows = (reservations ?? []) as any[];
  if (reservationRows.length === 0) {
    return { entries: [], validations: [], summary: { total_entries: 0, total_price: 0 } };
  }

  const rootIds = Array.from(
    new Set(
      reservationRows.map((row) => String(row.parent_reservation_id ?? row.id ?? "")).filter(Boolean)
    )
  );

  const [rootsResult, childrenResult] = await Promise.all([
    supabase
      .from("reservations")
      .select("id, parent_reservation_id, booking_code, guest_name, source, checkin_date, checkout_date, checked_in_at, tax_invoice_requested, guest_profile_id, status")
      .in("id", rootIds),
    supabase
      .from("reservations")
      .select("id, parent_reservation_id, booking_code, guest_name, source, checkin_date, checkout_date, checked_in_at, tax_invoice_requested, guest_profile_id, status")
      .in("parent_reservation_id", rootIds),
  ]);

  if (rootsResult.error) {
    throw new Error(`Failed to load linked reservation roots: ${rootsResult.error.message}`);
  }
  if (childrenResult.error) {
    throw new Error(`Failed to load linked reservation children: ${childrenResult.error.message}`);
  }
  const chainRows = [
    ...(rootsResult.data ?? []),
    ...(childrenResult.data ?? []),
  ] as any[];

  const reservationChains = new Map<string, any[]>();
  for (const row of chainRows) {
    const rootId = String(row.parent_reservation_id ?? row.id ?? "").trim();
    if (!rootId) continue;
    const bucket = reservationChains.get(rootId) ?? [];
    bucket.push(row);
    reservationChains.set(rootId, bucket);
  }

  const includedChains = new Map<string, { rows: any[]; finalRow: any }>();
  for (const [rootId, rows] of reservationChains.entries()) {
    const activeRows = rows
      .filter((row) => !isSuppressedLinkedStatus(row.status) && row.checkin_date && row.checkout_date)
      .sort((left, right) => {
        const checkoutCompare = String(left.checkout_date ?? "").localeCompare(String(right.checkout_date ?? ""));
        if (checkoutCompare !== 0) return checkoutCompare;
        return String(left.checkin_date ?? "").localeCompare(String(right.checkin_date ?? ""));
      });
    if (activeRows.length === 0) continue;

    const finalRow = activeRows[activeRows.length - 1];
    const finalCheckout = String(finalRow.checkout_date ?? "");
    if (!finalCheckout || finalCheckout < dateFrom || finalCheckout > dateTo) continue;
    if (normalizeStatus(finalRow.status) !== "checked_out") continue;

    const chainMatches = activeRows.some((row) =>
      matchesFilters(
        {
          source: String(row.source ?? ""),
          tax_invoice_requested: Boolean(row.tax_invoice_requested),
        },
        filters
      )
    );
    if (!chainMatches) continue;

    includedChains.set(rootId, { rows: activeRows, finalRow });
  }

  if (includedChains.size === 0) {
    return { entries: [], validations: [], summary: { total_entries: 0, total_price: 0 } };
  }

  const reservationIds = Array.from(
    new Set(
      Array.from(includedChains.values()).flatMap((chain) => chain.rows.map((row) => String(row.id)))
    )
  );
  const rootIdByReservationId = new Map<string, string>();
  for (const [rootId, chain] of includedChains.entries()) {
    for (const row of chain.rows) {
      rootIdByReservationId.set(String(row.id), rootId);
    }
  }

  // 3. Load folio_payments to compute full folio price per linked stay
  //    Revenue = SUM(payment rows) excluding deposit/commission/tip/transportation
  const { data: folioRows } = await supabase
    .from("folio_payments")
    .select("reservation_id, tx_type, amount, revenue_category")
    .in("reservation_id", reservationIds);

  const folioPriceMap = new Map<string, number>();
  for (const row of (folioRows ?? []) as any[]) {
    const resId = String(row.reservation_id);
    const rootId = rootIdByReservationId.get(resId);
    if (!rootId) continue;
    const txType = String(row.tx_type ?? "").toLowerCase();
    const category = String(row.revenue_category ?? "").toLowerCase();
    if (txType !== "payment") continue;
    // Exclude non-revenue categories
    if (["deposit", "commission", "tip", "transportation"].includes(category)) continue;
    const amount = Number(row.amount ?? 0);
    folioPriceMap.set(rootId, (folioPriceMap.get(rootId) ?? 0) + amount);
  }

  // 4. Load all guests for these linked reservations
  const { data: guestRows, error: guestError } = await supabase
    .from("reservation_guests")
    .select("reservation_id, guest_profile_id, role, guest_profiles(id, first_name, last_name, gender, nationality_code, country, province, id_type, id_number, passport_no)")
    .in("reservation_id", reservationIds);

  if (guestError) {
    throw new Error(`Failed to load reservation guests: ${guestError.message}`);
  }

  // 5. Load room numbers (latest night per final reservation)
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

  const guestAggregateByRootAndProfile = new Map<string, any>();
  for (const row of (guestRows ?? []) as any[]) {
    const resId = String(row.reservation_id);
    const rootId = rootIdByReservationId.get(resId);
    if (!rootId) continue;
    const chain = includedChains.get(rootId);
    if (!chain) continue;

    const gp = Array.isArray(row.guest_profiles) ? row.guest_profiles[0] : row.guest_profiles;
    if (!gp?.id) continue;
    const role = String(row.role) as "primary" | "accompanying";
    const key = `${rootId}:${String(gp.id)}`;
    const existing = guestAggregateByRootAndProfile.get(key);
    if (!existing) {
      guestAggregateByRootAndProfile.set(key, {
        rootId,
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
      });
      continue;
    }

    if (existing.role !== "primary" && role === "primary") {
      existing.role = "primary";
    }
    if (!existing.first_name && gp.first_name) existing.first_name = gp.first_name;
    if (!existing.last_name && gp.last_name) existing.last_name = gp.last_name;
    if (!existing.nationality_code && gp.nationality_code) existing.nationality_code = gp.nationality_code;
    if (!existing.country && gp.country) existing.country = gp.country;
    if (!existing.province && gp.province) existing.province = gp.province;
    if (!existing.id_type && gp.id_type) existing.id_type = gp.id_type;
    if (!existing.id_number && gp.id_number) existing.id_number = gp.id_number;
    if (!existing.passport_no && gp.passport_no) existing.passport_no = gp.passport_no;
  }

  // 6. Build guest records (one row per linked chain guest)
  const entries: RR3GuestRecord[] = [];

  for (const aggregate of guestAggregateByRootAndProfile.values()) {
    const chain = includedChains.get(String(aggregate.rootId));
    if (!chain) continue;

    const role = aggregate.role as "primary" | "accompanying";
    if (!filters.include_accompanying && role === "accompanying") continue;

    const fullCheckin = String(chain.rows[0]?.checkin_date ?? "");
    const finalRow = chain.finalRow;
    const finalReservationId = String(finalRow?.id ?? "");
    const fullCheckout = String(finalRow?.checkout_date ?? "");
    const finalSource = String(finalRow?.source ?? chain.rows[0]?.source ?? "");
    const anyTaxInvoiceRequested = chain.rows.some((row) => Boolean(row.tax_invoice_requested));

    entries.push({
      reservation_id: finalReservationId,
      guest_profile_id: String(aggregate.guest_profile_id),
      role,
      first_name: aggregate.first_name ?? null,
      last_name: aggregate.last_name ?? null,
      nationality_code: aggregate.nationality_code ?? null,
      country: aggregate.country ?? null,
      province: aggregate.province ?? null,
      id_type: aggregate.id_type ?? null,
      id_number: aggregate.id_number ?? null,
      passport_no: aggregate.passport_no ?? null,
      checkin_date: fullCheckin,
      checkout_date: fullCheckout,
      checked_in_at: chain.rows[0]?.checked_in_at ?? null,
      checked_out_at: null,
      room_number: roomMap.get(finalReservationId) ?? null,
      source: finalSource,
      tax_invoice_requested: anyTaxInvoiceRequested,
      total_price: role === "primary" ? (folioPriceMap.get(String(aggregate.rootId)) ?? 0) : 0,
      booking_code: finalRow?.booking_code ?? chain.rows[0]?.booking_code ?? null,
    });
  }

  // Sort: by full checkout_date, then reservation_id, then role (primary first)
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
