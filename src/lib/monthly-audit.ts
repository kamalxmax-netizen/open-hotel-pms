import { toBangkokDateString } from "@/lib/audit-utils";

type SupabaseLike = {
  from: (table: string) => any;
  rpc: (fn: string, args?: Record<string, unknown>) => any;
};

export class MonthlyAuditError extends Error {
  status: number;
  constructor(message: string, status = 400) {
    super(message);
    this.name = "MonthlyAuditError";
    this.status = status;
  }
}

// ============================================================
// Types
// ============================================================

export type MonthlyAuditStatus = "open" | "reviewing" | "audited" | "locked";

export interface MonthlyAuditPeriod {
  id: string;
  year: number;
  month: number;
  status: MonthlyAuditStatus;
  closed_at: string | null;
  closed_by: string | null;
  audited_at: string | null;
  audited_by: string | null;
  summary_json: MonthlyAuditSummary | null;
  note: string | null;
  created_at: string;
}

export interface MonthlyAuditEntry {
  id: string;
  period_id: string;
  reservation_id: string;
  booking_code: string | null;
  guest_name: string;
  source: string;
  checkin_date: string;
  checkout_date: string;
  room_number: string | null;
  room_type_name: string | null;
  total_nights: number;
  room_revenue: number;
  extra_revenue: number;
  pos_revenue: number;
  total_revenue: number;
  paid_cash: number;
  paid_transfer: number;
  paid_credit_card: number;
  paid_other: number;
  total_paid: number;
  refund_total: number;
  outstanding: number;
  tax_invoice_requested: boolean;
  tax_invoice_name: string | null;
  tax_id: string | null;
  nationality: string | null;
  passport_number: string | null;
  id_card_number: string | null;
  guest_count: number;
  channel_flag?: MonthlyAuditEntryChannelFlag | null;
  corrections?: MonthlyAuditCorrection[];
}

export interface MonthlyAuditEntryChannelFlag {
  actual_channel: string;
  tax_invoice_channel: string;
  display_label: string;
  reason: string | null;
  flagged_by_user_id: string | null;
  flagged_at: string | null;
}

export interface MonthlyAuditCorrection {
  id: string;
  entry_id: string;
  field_name: string;
  old_value: string | null;
  new_value: string | null;
  reason: string | null;
  corrected_by: string | null;
  corrected_at: string;
}

export interface MonthlyAuditSummary {
  total_reservations: number;
  by_source: Record<string, SourceSummary>;
  totals: SourceSummary;
}

export interface SourceSummary {
  count: number;
  room_revenue: number;
  extra_revenue: number;
  pos_revenue: number;
  total_revenue: number;
  paid_cash: number;
  paid_transfer: number;
  paid_credit_card: number;
  paid_other: number;
  total_paid: number;
  refund_total: number;
  outstanding: number;
  tax_invoice_count: number;
}

export interface MonthlyAuditPreviewResult {
  year: number;
  month: number;
  entries: MonthlyAuditEntry[];
  summary: MonthlyAuditSummary;
  available_sources: string[];
  generated_at: string;
}

// Correctable fields in monthly_audit_entries
export const CORRECTABLE_FIELDS = [
  "guest_name",
  "source",
  "room_number",
  "room_type_name",
  "total_nights",
  "room_revenue",
  "extra_revenue",
  "pos_revenue",
  "total_revenue",
  "paid_cash",
  "paid_transfer",
  "paid_credit_card",
  "paid_other",
  "total_paid",
  "refund_total",
  "outstanding",
  "tax_invoice_requested",
  "tax_invoice_name",
  "tax_id",
  "nationality",
  "passport_number",
  "id_card_number",
  "guest_count",
] as const;

export type CorrectableField = (typeof CORRECTABLE_FIELDS)[number];

// Numeric fields (need parseFloat for comparison)
const NUMERIC_FIELDS = new Set<string>([
  "total_nights",
  "room_revenue",
  "extra_revenue",
  "pos_revenue",
  "total_revenue",
  "paid_cash",
  "paid_transfer",
  "paid_credit_card",
  "paid_other",
  "total_paid",
  "refund_total",
  "outstanding",
  "guest_count",
]);

// ============================================================
// Helpers
// ============================================================

function monthDateRange(year: number, month: number): { from: string; to: string } {
  const from = `${year}-${String(month).padStart(2, "0")}-01`;
  const lastDay = new Date(year, month, 0).getDate();
  const to = `${year}-${String(month).padStart(2, "0")}-${String(lastDay).padStart(2, "0")}`;
  return { from, to };
}

function num(value: unknown): number {
  const n = Number(value ?? 0);
  return Number.isFinite(n) ? Math.round(n * 100) / 100 : 0;
}

function str(value: unknown): string {
  return String(value ?? "").trim();
}

function emptySourceSummary(): SourceSummary {
  return {
    count: 0,
    room_revenue: 0,
    extra_revenue: 0,
    pos_revenue: 0,
    total_revenue: 0,
    paid_cash: 0,
    paid_transfer: 0,
    paid_credit_card: 0,
    paid_other: 0,
    total_paid: 0,
    refund_total: 0,
    outstanding: 0,
    tax_invoice_count: 0,
  };
}

function addToSummary(summary: SourceSummary, entry: MonthlyAuditEntry): void {
  summary.count += 1;
  summary.room_revenue += entry.room_revenue;
  summary.extra_revenue += entry.extra_revenue;
  summary.pos_revenue += entry.pos_revenue;
  summary.total_revenue += entry.total_revenue;
  summary.paid_cash += entry.paid_cash;
  summary.paid_transfer += entry.paid_transfer;
  summary.paid_credit_card += entry.paid_credit_card;
  summary.paid_other += entry.paid_other;
  summary.total_paid += entry.total_paid;
  summary.refund_total += entry.refund_total;
  summary.outstanding += entry.outstanding;
  if (entry.tax_invoice_requested) summary.tax_invoice_count += 1;
}

export function computeSummary(entries: MonthlyAuditEntry[]): MonthlyAuditSummary {
  const bySource: Record<string, SourceSummary> = {};
  const totals = emptySourceSummary();

  for (const entry of entries) {
    const src = entry.source || "unknown";
    if (!bySource[src]) bySource[src] = emptySourceSummary();
    addToSummary(bySource[src], entry);
    addToSummary(totals, entry);
  }

  return {
    total_reservations: entries.length,
    by_source: bySource,
    totals,
  };
}

// ============================================================
// Close Month — Generate Snapshot
// ============================================================

export async function closeMonth(params: {
  supabase: SupabaseLike;
  year: number;
  month: number;
  closedByUserId: string | null;
  filterDayuse?: "only" | "exclude";
}): Promise<{ period: MonthlyAuditPeriod; entries: MonthlyAuditEntry[]; summary: MonthlyAuditSummary }> {
  const { supabase, year, month, closedByUserId, filterDayuse } = params;

  // 1. Check existing period state
  const { data: existing, error: existingError } = await supabase
    .from("monthly_audit_periods")
    .select("id, status")
    .eq("year", year)
    .eq("month", month)
    .maybeSingle();

  if (existingError) {
    throw new MonthlyAuditError(existingError.message, 500);
  }
  if (existing) {
    // Allow re-snapshot from open/reviewing for operational retest.
    // Keep audited/locked protected.
    if (existing.status === "locked") {
      throw new MonthlyAuditError(
        `Month ${year}-${String(month).padStart(2, "0")} is locked and cannot be regenerated.`,
        409
      );
    }
    if (existing.status === "audited") {
      throw new MonthlyAuditError(
        `Month ${year}-${String(month).padStart(2, "0")} is audited. Reopen it first before regenerating snapshot.`,
        409
      );
    }

    // Delete existing open/reviewing period and its entries to re-snapshot
    await supabase.from("monthly_audit_entries").delete().eq("period_id", existing.id);
    await supabase.from("monthly_audit_periods").delete().eq("id", existing.id);
  }

  const { from: dateFrom, to: dateTo } = monthDateRange(year, month);

  // 2. Load checked-out reservations in this month
  const { data: reservations, error: resError } = await supabase
    .from("reservations")
    .select(
      "id, booking_code, guest_name, source, checkin_date, checkout_date, total_price, tax_invoice_requested, guest_profile_id, is_dayuse"
    )
    .eq("status", "checked_out")
    .gte("checkout_date", dateFrom)
    .lte("checkout_date", dateTo)
    .order("checkout_date", { ascending: true });

  if (resError) {
    throw new MonthlyAuditError(`Failed to load reservations: ${resError.message}`, 500);
  }

  const reservationRows = ((reservations ?? []) as any[]).filter((row) => {
    if (filterDayuse === "only") return Boolean(row.is_dayuse);
    if (filterDayuse === "exclude") return !Boolean(row.is_dayuse);
    return true;
  });
  if (reservationRows.length === 0) {
    throw new MonthlyAuditError(
      `No checked-out reservations found for ${year}-${String(month).padStart(2, "0")}.`,
      404
    );
  }

  const reservationIds = reservationRows.map((r: any) => String(r.id));

  // 3. Load folio payments for all reservations (batched)
  const { data: folioRows, error: folioError } = await supabase
    .from("folio_payments")
    .select("reservation_id, tx_type, method, amount, revenue_category, is_record_only")
    .in("reservation_id", reservationIds)
    .eq("is_record_only", false);

  if (folioError) {
    throw new MonthlyAuditError(`Failed to load folio data: ${folioError.message}`, 500);
  }

  // 4. Load room assignments (latest night per reservation for room number)
  const { data: nightRows, error: nightError } = await supabase
    .from("reservation_nights")
    .select("reservation_id, room_id, rooms(room_number, room_type_id, room_types(name_en))")
    .in("reservation_id", reservationIds)
    .is("cancelled_at", null)
    .order("stay_date", { ascending: false });

  if (nightError) {
    throw new MonthlyAuditError(`Failed to load room assignments: ${nightError.message}`, 500);
  }

  // 5. Load guest profiles for identity data
  const guestProfileIds = reservationRows
    .map((r: any) => r.guest_profile_id)
    .filter(Boolean);

  let guestProfileMap = new Map<string, any>();
  if (guestProfileIds.length > 0) {
    const { data: profiles } = await supabase
      .from("guest_profiles")
      .select("id, nationality, passport_number, id_card_number")
      .in("id", guestProfileIds);

    if (profiles) {
      guestProfileMap = new Map(
        (profiles as any[]).map((p: any) => [String(p.id), p])
      );
    }
  }

  // 6. Build lookup maps
  // Folio: group by reservation_id
  type FolioAgg = {
    room_revenue: number;
    extra_revenue: number;
    pos_revenue: number;
    paid_cash: number;
    paid_transfer: number;
    paid_credit_card: number;
    paid_other: number;
    refund_total: number;
  };

  const folioMap = new Map<string, FolioAgg>();
  for (const row of (folioRows ?? []) as any[]) {
    const resId = String(row.reservation_id);
    if (!folioMap.has(resId)) {
      folioMap.set(resId, {
        room_revenue: 0,
        extra_revenue: 0,
        pos_revenue: 0,
        paid_cash: 0,
        paid_transfer: 0,
        paid_credit_card: 0,
        paid_other: 0,
        refund_total: 0,
      });
    }
    const agg = folioMap.get(resId)!;
    const amount = num(row.amount);
    const txType = str(row.tx_type).toLowerCase();
    const category = str(row.revenue_category).toLowerCase();
    const method = str(row.method).toLowerCase();

    if (txType === "refund") {
      if (category !== "deposit") {
        agg.refund_total += amount;
      }
    } else if (txType === "payment") {
      // This table stores both revenue category and payment method on the same payment row.
      // We intentionally aggregate both dimensions from the same rows:
      // - revenue side: by revenue_category (room/extra/pos)
      // - payment side: by method (cash/transfer/card/other)
      // Outstanding remains: total_revenue - total_paid + refund_total.
      if (category === "room_revenue" || category === "dayuse_revenue") agg.room_revenue += amount;
      else if (category === "extra_charge" || category === "no_show_fee") agg.extra_revenue += amount;
      else if (category === "pos_revenue") agg.pos_revenue += amount;
      // Skip deposit category

      // Payment method breakdown (only for non-deposit)
      if (category !== "deposit") {
        if (method === "cash") agg.paid_cash += amount;
        else if (method === "transfer") agg.paid_transfer += amount;
        else if (method === "credit_card") agg.paid_credit_card += amount;
        else agg.paid_other += amount;
      }
    }
  }

  // Room: first occurrence per reservation (sorted desc by stay_date, so first = latest)
  const roomMap = new Map<string, { room_number: string; room_type_name: string }>();
  for (const row of (nightRows ?? []) as any[]) {
    const resId = String(row.reservation_id);
    if (roomMap.has(resId)) continue; // already have latest
    const roomObj = Array.isArray(row.rooms) ? row.rooms[0] : row.rooms;
    const typeObj = roomObj?.room_types
      ? (Array.isArray(roomObj.room_types) ? roomObj.room_types[0] : roomObj.room_types)
      : null;
    roomMap.set(resId, {
      room_number: str(roomObj?.room_number),
      room_type_name: str(typeObj?.name_en),
    });
  }

  // Night count per reservation
  const nightCountMap = new Map<string, number>();
  for (const row of (nightRows ?? []) as any[]) {
    const resId = String(row.reservation_id);
    nightCountMap.set(resId, (nightCountMap.get(resId) ?? 0) + 1);
  }

  // 7. Create period
  const now = new Date().toISOString();
  const { data: period, error: periodError } = await supabase
    .from("monthly_audit_periods")
    .insert({
      year,
      month,
      status: "reviewing",
      closed_at: now,
      closed_by: closedByUserId,
    })
    .select("*")
    .single();

  if (periodError) {
    throw new MonthlyAuditError(`Failed to create audit period: ${periodError.message}`, 500);
  }

  // 8. Build entries
  const entries: MonthlyAuditEntry[] = [];
  const insertRows: any[] = [];

  for (const res of reservationRows) {
    const resId = String(res.id);
    const folio = folioMap.get(resId) ?? {
      room_revenue: 0,
      extra_revenue: 0,
      pos_revenue: 0,
      paid_cash: 0,
      paid_transfer: 0,
      paid_credit_card: 0,
      paid_other: 0,
      refund_total: 0,
    };
    const room = roomMap.get(resId) ?? { room_number: "", room_type_name: "" };
    const profile = guestProfileMap.get(String(res.guest_profile_id ?? ""));
    const nightCount = nightCountMap.get(resId) ?? 1;

    const totalRevenue = num(folio.room_revenue + folio.extra_revenue + folio.pos_revenue);
    const totalPaid = num(folio.paid_cash + folio.paid_transfer + folio.paid_credit_card + folio.paid_other);
    const outstanding = num(totalRevenue - totalPaid + folio.refund_total);

    const entry: MonthlyAuditEntry = {
      id: "", // will be set after insert
      period_id: String(period.id),
      reservation_id: resId,
      booking_code: str(res.booking_code) || null,
      guest_name: str(res.guest_name),
      source: str(res.source),
      checkin_date: str(res.checkin_date),
      checkout_date: str(res.checkout_date),
      room_number: room.room_number || null,
      room_type_name: room.room_type_name || null,
      total_nights: nightCount,
      room_revenue: num(folio.room_revenue),
      extra_revenue: num(folio.extra_revenue),
      pos_revenue: num(folio.pos_revenue),
      total_revenue: totalRevenue,
      paid_cash: num(folio.paid_cash),
      paid_transfer: num(folio.paid_transfer),
      paid_credit_card: num(folio.paid_credit_card),
      paid_other: num(folio.paid_other),
      total_paid: totalPaid,
      refund_total: num(folio.refund_total),
      outstanding,
      tax_invoice_requested: Boolean(res.tax_invoice_requested),
      tax_invoice_name: null,
      tax_id: null,
      nationality: str(profile?.nationality) || null,
      passport_number: str(profile?.passport_number) || null,
      id_card_number: str(profile?.id_card_number) || null,
      guest_count: 1,
    };
    entries.push(entry);

    insertRows.push({
      period_id: entry.period_id,
      reservation_id: entry.reservation_id,
      booking_code: entry.booking_code,
      guest_name: entry.guest_name,
      source: entry.source,
      checkin_date: entry.checkin_date,
      checkout_date: entry.checkout_date,
      room_number: entry.room_number,
      room_type_name: entry.room_type_name,
      total_nights: entry.total_nights,
      room_revenue: entry.room_revenue,
      extra_revenue: entry.extra_revenue,
      pos_revenue: entry.pos_revenue,
      total_revenue: entry.total_revenue,
      paid_cash: entry.paid_cash,
      paid_transfer: entry.paid_transfer,
      paid_credit_card: entry.paid_credit_card,
      paid_other: entry.paid_other,
      total_paid: entry.total_paid,
      refund_total: entry.refund_total,
      outstanding: entry.outstanding,
      tax_invoice_requested: entry.tax_invoice_requested,
      tax_invoice_name: entry.tax_invoice_name,
      tax_id: entry.tax_id,
      nationality: entry.nationality,
      passport_number: entry.passport_number,
      id_card_number: entry.id_card_number,
      guest_count: entry.guest_count,
      raw_snapshot_json: {
        reservation: res,
        folio,
        room,
        profile: profile ?? null,
      },
    });
  }

  // 9. Bulk insert entries
  if (insertRows.length > 0) {
    const { error: insertError } = await supabase
      .from("monthly_audit_entries")
      .insert(insertRows);

    if (insertError) {
      // Cleanup period on failure
      await supabase.from("monthly_audit_periods").delete().eq("id", period.id);
      throw new MonthlyAuditError(`Failed to insert audit entries: ${insertError.message}`, 500);
    }
  }

  // 10. Compute and save summary
  const summary = computeSummary(entries);

  const { error: summaryError } = await supabase
    .from("monthly_audit_periods")
    .update({ summary_json: summary })
    .eq("id", period.id);

  if (summaryError) {
    console.error("Failed to save monthly summary_json:", summaryError.message);
    // Non-fatal: period + entries already persisted; summary can be recomputed.
  }

  // 11. Audit log
  try {
    await supabase.from("audit_logs").insert({
      actor_user_id: closedByUserId,
      action: "monthly_audit_closed",
      entity_type: "monthly_audit",
      entity_id: String(period.id),
      after_json: {
        year,
        month,
        total_reservations: entries.length,
        total_revenue: summary.totals.total_revenue,
      },
      business_date: toBangkokDateString(),
      source: "manual",
    });
  } catch {
    // non-blocking
  }

  return {
    period: {
      id: String(period.id),
      year: Number(period.year),
      month: Number(period.month),
      status: "reviewing",
      closed_at: String(period.closed_at ?? ""),
      closed_by: closedByUserId,
      audited_at: null,
      audited_by: null,
      summary_json: summary,
      note: null,
      created_at: String(period.created_at),
    },
    entries,
    summary,
  };
}

// ============================================================
// Preview Month — Live read-only (no DB writes)
// ============================================================

export async function previewMonth(params: {
  supabase: SupabaseLike;
  year: number;
  month: number;
  filterDayuse?: "only" | "exclude";
}): Promise<MonthlyAuditPreviewResult> {
  const { supabase, year, month, filterDayuse } = params;
  const { from: dateFrom, to: dateTo } = monthDateRange(year, month);

  // 1) Load checked-out reservations in this month
  const { data: reservations, error: resError } = await supabase
    .from("reservations")
    .select(
      "id, booking_code, guest_name, source, checkin_date, checkout_date, total_price, tax_invoice_requested, guest_profile_id, is_dayuse"
    )
    .eq("status", "checked_out")
    .gte("checkout_date", dateFrom)
    .lte("checkout_date", dateTo)
    .order("checkout_date", { ascending: true });

  if (resError) {
    throw new MonthlyAuditError(`Failed to load reservations: ${resError.message}`, 500);
  }

  const reservationRows = ((reservations ?? []) as any[]).filter((row) => {
    if (filterDayuse === "only") return Boolean(row.is_dayuse);
    if (filterDayuse === "exclude") return !Boolean(row.is_dayuse);
    return true;
  });
  if (reservationRows.length === 0) {
    return {
      year,
      month,
      entries: [],
      summary: computeSummary([]),
      available_sources: [],
      generated_at: new Date().toISOString(),
    };
  }

  const reservationIds = reservationRows.map((r: any) => String(r.id));

  // 2) Load folio data
  const { data: folioRows, error: folioError } = await supabase
    .from("folio_payments")
    .select("reservation_id, tx_type, method, amount, revenue_category, is_record_only")
    .in("reservation_id", reservationIds)
    .eq("is_record_only", false);

  if (folioError) {
    throw new MonthlyAuditError(`Failed to load folio data: ${folioError.message}`, 500);
  }

  // 3) Load room assignments (latest night per reservation for room number)
  const { data: nightRows, error: nightError } = await supabase
    .from("reservation_nights")
    .select("reservation_id, room_id, rooms(room_number, room_type_id, room_types(name_en))")
    .in("reservation_id", reservationIds)
    .is("cancelled_at", null)
    .order("stay_date", { ascending: false });

  if (nightError) {
    throw new MonthlyAuditError(`Failed to load room assignments: ${nightError.message}`, 500);
  }

  // 4) Load guest profiles for identity data
  const guestProfileIds = reservationRows.map((r: any) => r.guest_profile_id).filter(Boolean);
  let guestProfileMap = new Map<string, any>();
  if (guestProfileIds.length > 0) {
    const { data: profiles } = await supabase
      .from("guest_profiles")
      .select("id, nationality, passport_number, id_card_number")
      .in("id", guestProfileIds);

    if (profiles) {
      guestProfileMap = new Map((profiles as any[]).map((p: any) => [String(p.id), p]));
    }
  }

  // 5) Build lookup maps
  type FolioAgg = {
    room_revenue: number;
    extra_revenue: number;
    pos_revenue: number;
    paid_cash: number;
    paid_transfer: number;
    paid_credit_card: number;
    paid_other: number;
    refund_total: number;
  };

  const folioMap = new Map<string, FolioAgg>();
  for (const row of (folioRows ?? []) as any[]) {
    const resId = String(row.reservation_id);
    if (!folioMap.has(resId)) {
      folioMap.set(resId, {
        room_revenue: 0,
        extra_revenue: 0,
        pos_revenue: 0,
        paid_cash: 0,
        paid_transfer: 0,
        paid_credit_card: 0,
        paid_other: 0,
        refund_total: 0,
      });
    }
    const agg = folioMap.get(resId)!;
    const amount = num(row.amount);
    const txType = str(row.tx_type).toLowerCase();
    const category = str(row.revenue_category).toLowerCase();
    const method = str(row.method).toLowerCase();

    if (txType === "refund") {
      if (category !== "deposit") {
        agg.refund_total += amount;
      }
    } else if (txType === "payment") {
      if (category === "room_revenue" || category === "dayuse_revenue") agg.room_revenue += amount;
      else if (category === "extra_charge" || category === "no_show_fee") agg.extra_revenue += amount;
      else if (category === "pos_revenue") agg.pos_revenue += amount;

      if (category !== "deposit") {
        if (method === "cash") agg.paid_cash += amount;
        else if (method === "transfer") agg.paid_transfer += amount;
        else if (method === "credit_card") agg.paid_credit_card += amount;
        else agg.paid_other += amount;
      }
    }
  }

  const roomMap = new Map<string, { room_number: string; room_type_name: string }>();
  for (const row of (nightRows ?? []) as any[]) {
    const resId = String(row.reservation_id);
    if (roomMap.has(resId)) continue;
    const roomObj = Array.isArray(row.rooms) ? row.rooms[0] : row.rooms;
    const typeObj = roomObj?.room_types
      ? (Array.isArray(roomObj.room_types) ? roomObj.room_types[0] : roomObj.room_types)
      : null;
    roomMap.set(resId, {
      room_number: str(roomObj?.room_number),
      room_type_name: str(typeObj?.name_en),
    });
  }

  const nightCountMap = new Map<string, number>();
  for (const row of (nightRows ?? []) as any[]) {
    const resId = String(row.reservation_id);
    nightCountMap.set(resId, (nightCountMap.get(resId) ?? 0) + 1);
  }

  // 6) Build in-memory entries only (no inserts)
  const entries: MonthlyAuditEntry[] = [];

  for (const res of reservationRows) {
    const resId = String(res.id);
    const folio = folioMap.get(resId) ?? {
      room_revenue: 0,
      extra_revenue: 0,
      pos_revenue: 0,
      paid_cash: 0,
      paid_transfer: 0,
      paid_credit_card: 0,
      paid_other: 0,
      refund_total: 0,
    };
    const room = roomMap.get(resId) ?? { room_number: "", room_type_name: "" };
    const profile = guestProfileMap.get(String(res.guest_profile_id ?? ""));
    const nightCount = nightCountMap.get(resId) ?? 1;

    const totalRevenue = num(folio.room_revenue + folio.extra_revenue + folio.pos_revenue);
    const totalPaid = num(folio.paid_cash + folio.paid_transfer + folio.paid_credit_card + folio.paid_other);
    const outstanding = num(totalRevenue - totalPaid + folio.refund_total);

    entries.push({
      id: `preview-${resId}`,
      period_id: "preview",
      reservation_id: resId,
      booking_code: str(res.booking_code) || null,
      guest_name: str(res.guest_name),
      source: str(res.source),
      checkin_date: str(res.checkin_date),
      checkout_date: str(res.checkout_date),
      room_number: room.room_number || null,
      room_type_name: room.room_type_name || null,
      total_nights: nightCount,
      room_revenue: num(folio.room_revenue),
      extra_revenue: num(folio.extra_revenue),
      pos_revenue: num(folio.pos_revenue),
      total_revenue: totalRevenue,
      paid_cash: num(folio.paid_cash),
      paid_transfer: num(folio.paid_transfer),
      paid_credit_card: num(folio.paid_credit_card),
      paid_other: num(folio.paid_other),
      total_paid: totalPaid,
      refund_total: num(folio.refund_total),
      outstanding,
      tax_invoice_requested: Boolean(res.tax_invoice_requested),
      tax_invoice_name: null,
      tax_id: null,
      nationality: str(profile?.nationality) || null,
      passport_number: str(profile?.passport_number) || null,
      id_card_number: str(profile?.id_card_number) || null,
      guest_count: 1,
      corrections: [],
    });
  }

  const summary = computeSummary(entries);
  const availableSources = Array.from(new Set(entries.map((e) => e.source).filter(Boolean))).sort();

  return {
    year,
    month,
    entries,
    summary,
    available_sources: availableSources,
    generated_at: new Date().toISOString(),
  };
}

// ============================================================
// Apply Correction
// ============================================================

export async function applyCorrection(params: {
  supabase: SupabaseLike;
  entryId: string;
  fieldName: string;
  newValue: string;
  reason?: string;
  correctedByUserId: string | null;
}): Promise<MonthlyAuditCorrection> {
  const { supabase, entryId, fieldName, newValue, reason, correctedByUserId } = params;

  // Validate field name
  if (!(CORRECTABLE_FIELDS as readonly string[]).includes(fieldName)) {
    throw new MonthlyAuditError(`Field "${fieldName}" is not correctable.`);
  }

  // Load entry + check period status
  const { data: entry, error: entryError } = await supabase
    .from("monthly_audit_entries")
    .select("*, monthly_audit_periods!inner(status)")
    .eq("id", entryId)
    .maybeSingle();

  if (entryError) throw new MonthlyAuditError(entryError.message, 500);
  if (!entry) throw new MonthlyAuditError("Audit entry not found.", 404);

  const periodStatus = (entry as any).monthly_audit_periods?.status;
  if (periodStatus !== "reviewing") {
    throw new MonthlyAuditError(
      `Cannot correct entries in "${periodStatus}" period. Only "reviewing" periods allow corrections.`,
      409
    );
  }

  // Get old value
  const oldValue = String((entry as any)[fieldName] ?? "");

  // Prepare updated value
  const updatePayload: Record<string, unknown> = {};
  let numericNewValue: number | null = null;
  if (NUMERIC_FIELDS.has(fieldName)) {
    const parsedNumeric = Number(newValue);
    if (!Number.isFinite(parsedNumeric)) {
      throw new MonthlyAuditError(
        `Invalid numeric value for "${fieldName}": "${newValue}"`,
        400
      );
    }
    numericNewValue = Math.round(parsedNumeric * 100) / 100;
    updatePayload[fieldName] = numericNewValue;
  } else if (fieldName === "tax_invoice_requested") {
    updatePayload[fieldName] = newValue === "true";
  } else {
    updatePayload[fieldName] = newValue;
  }

  // Recalculate totals if a revenue or payment field changed
  const recalcFields = new Set([
    "room_revenue", "extra_revenue", "pos_revenue",
    "paid_cash", "paid_transfer", "paid_credit_card", "paid_other",
    "refund_total",
  ]);

  if (recalcFields.has(fieldName)) {
    const current = entry as any;
    const get = (f: string) => {
      if (f === fieldName) return numericNewValue ?? num(newValue);
      return num(current[f]);
    };

    const totalRevenue = get("room_revenue") + get("extra_revenue") + get("pos_revenue");
    const totalPaid = get("paid_cash") + get("paid_transfer") + get("paid_credit_card") + get("paid_other");
    const outstanding = totalRevenue - totalPaid + get("refund_total");

    updatePayload.total_revenue = num(totalRevenue);
    updatePayload.total_paid = num(totalPaid);
    updatePayload.outstanding = num(outstanding);
  }

  // Insert correction first (source of truth), then update entry (derived state).
  const { data: correction, error: correctionError } = await supabase
    .from("monthly_audit_corrections")
    .insert({
      entry_id: entryId,
      field_name: fieldName,
      old_value: oldValue,
      new_value: newValue,
      reason: reason || null,
      corrected_by: correctedByUserId,
    })
    .select("*")
    .single();

  if (correctionError) {
    throw new MonthlyAuditError(`Failed to record correction: ${correctionError.message}`, 500);
  }

  const { error: updateError } = await supabase
    .from("monthly_audit_entries")
    .update(updatePayload)
    .eq("id", entryId);

  if (updateError) {
    throw new MonthlyAuditError(
      `Correction logged but entry update failed: ${updateError.message}. Correction ID: ${correction.id}`,
      500
    );
  }

  return {
    id: String(correction.id),
    entry_id: String(correction.entry_id),
    field_name: String(correction.field_name),
    old_value: correction.old_value ?? null,
    new_value: correction.new_value ?? null,
    reason: correction.reason ?? null,
    corrected_by: correction.corrected_by ?? null,
    corrected_at: String(correction.corrected_at),
  };
}

// ============================================================
// Approve Month
// ============================================================

export async function approveMonth(params: {
  supabase: SupabaseLike;
  year: number;
  month: number;
  auditedByUserId: string | null;
}): Promise<MonthlyAuditPeriod> {
  const { supabase, year, month, auditedByUserId } = params;

  const { data: period, error: periodError } = await supabase
    .from("monthly_audit_periods")
    .select("*")
    .eq("year", year)
    .eq("month", month)
    .maybeSingle();

  if (periodError) throw new MonthlyAuditError(periodError.message, 500);
  if (!period) throw new MonthlyAuditError("Audit period not found.", 404);

  if (period.status !== "reviewing") {
    throw new MonthlyAuditError(
      `Cannot approve period in "${period.status}" status. Must be "reviewing".`,
      409
    );
  }

  // Recompute summary with corrected values
  const { data: entries, error: entriesError } = await supabase
    .from("monthly_audit_entries")
    .select("*")
    .eq("period_id", period.id);

  if (entriesError) throw new MonthlyAuditError(entriesError.message, 500);

  const shapedEntries: MonthlyAuditEntry[] = ((entries ?? []) as any[]).map((e: any) => ({
    id: String(e.id),
    period_id: String(e.period_id),
    reservation_id: String(e.reservation_id),
    booking_code: e.booking_code ?? null,
    guest_name: str(e.guest_name),
    source: str(e.source),
    checkin_date: str(e.checkin_date),
    checkout_date: str(e.checkout_date),
    room_number: e.room_number ?? null,
    room_type_name: e.room_type_name ?? null,
    total_nights: Number(e.total_nights ?? 1),
    room_revenue: num(e.room_revenue),
    extra_revenue: num(e.extra_revenue),
    pos_revenue: num(e.pos_revenue),
    total_revenue: num(e.total_revenue),
    paid_cash: num(e.paid_cash),
    paid_transfer: num(e.paid_transfer),
    paid_credit_card: num(e.paid_credit_card),
    paid_other: num(e.paid_other),
    total_paid: num(e.total_paid),
    refund_total: num(e.refund_total),
    outstanding: num(e.outstanding),
    tax_invoice_requested: Boolean(e.tax_invoice_requested),
    tax_invoice_name: e.tax_invoice_name ?? null,
    tax_id: e.tax_id ?? null,
    nationality: e.nationality ?? null,
    passport_number: e.passport_number ?? null,
    id_card_number: e.id_card_number ?? null,
    guest_count: Number(e.guest_count ?? 1),
  }));

  const summary = computeSummary(shapedEntries);
  const now = new Date().toISOString();

  const { error: updateError } = await supabase
    .from("monthly_audit_periods")
    .update({
      status: "audited",
      audited_at: now,
      audited_by: auditedByUserId,
      summary_json: summary,
      updated_at: now,
    })
    .eq("id", period.id);

  if (updateError) {
    throw new MonthlyAuditError(`Failed to approve period: ${updateError.message}`, 500);
  }

  // Audit log
  try {
    await supabase.from("audit_logs").insert({
      actor_user_id: auditedByUserId,
      action: "monthly_audit_approved",
      entity_type: "monthly_audit",
      entity_id: String(period.id),
      after_json: { year, month, total_revenue: summary.totals.total_revenue },
      business_date: toBangkokDateString(),
      source: "manual",
    });
  } catch {
    // non-blocking
  }

  return {
    id: String(period.id),
    year,
    month,
    status: "audited",
    closed_at: period.closed_at ?? null,
    closed_by: period.closed_by ?? null,
    audited_at: now,
    audited_by: auditedByUserId,
    summary_json: summary,
    note: period.note ?? null,
    created_at: String(period.created_at),
  };
}

// ============================================================
// Reopen month — admin or supervisor only (same permission as approve)
// ============================================================

export async function reopenMonth(params: {
  supabase: SupabaseLike;
  year: number;
  month: number;
  userId: string | null;
}): Promise<void> {
  const { supabase, year, month, userId } = params;

  const { data: period, error } = await supabase
    .from("monthly_audit_periods")
    .select("id, status")
    .eq("year", year)
    .eq("month", month)
    .maybeSingle();

  if (error) throw new MonthlyAuditError(error.message, 500);
  if (!period) throw new MonthlyAuditError("Audit period not found.", 404);

  if (period.status === "locked") {
    throw new MonthlyAuditError("Locked periods cannot be reopened. Reports have been generated.", 409);
  }
  if (period.status === "open") {
    throw new MonthlyAuditError("Period is already open.", 409);
  }

  await supabase
    .from("monthly_audit_periods")
    .update({
      status: "reviewing",
      audited_at: null,
      audited_by: null,
      updated_at: new Date().toISOString(),
    })
    .eq("id", period.id);

  try {
    await supabase.from("audit_logs").insert({
      actor_user_id: userId,
      action: "monthly_audit_reopened",
      entity_type: "monthly_audit",
      entity_id: String(period.id),
      after_json: { year, month },
      business_date: toBangkokDateString(),
      source: "manual",
    });
  } catch {
    // non-blocking
  }
}
