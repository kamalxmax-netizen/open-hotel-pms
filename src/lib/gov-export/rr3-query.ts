/**
 * รร.3 Query — Load checked-out guests for monthly hotel registration report
 *
 * Scope: reservations checked out in the target month
 * Filter logic: OR between source filter and tax invoice filter
 * Accompanying guest toggle: separate include/exclude
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import type {
  RR3GuestRecord,
  RR3FilterParams,
  RR3PriceSummary,
  RR3PriceSummaryGroup,
  RR3Validation,
} from "./types";
import { loadIssuedFullTaxCoverageMap } from "@/lib/monthly-audit";
import { applyRR3RowOverrides, loadRR3RowOverrides } from "./rr3-row-overrides";

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
  price_summary: RR3PriceSummary;
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

function emptyPriceSummaryGroup(label: string): RR3PriceSummaryGroup {
  return {
    label,
    rows: [],
    total_quantity: 0,
    total_amount: 0,
    copy_text: `${label}\nยอดรวม = 0`,
  };
}

function emptyPriceSummary(): RR3PriceSummary {
  return {
    ota_tax: emptyPriceSummaryGroup("รร.3 OTA + Tax invoice"),
    walkin_direct: emptyPriceSummaryGroup("รร.3 Walk-in + Direct"),
  };
}

function roundMoney(value: unknown): number {
  return Math.round(Number(value ?? 0) * 100) / 100;
}

function formatSummaryNumber(value: number): string {
  return value.toLocaleString("en-US", {
    minimumFractionDigits: Number.isInteger(value) ? 0 : 2,
    maximumFractionDigits: 2,
  });
}

function addPriceSummaryItem(bucket: Map<number, number>, unitPrice: unknown, quantity: unknown) {
  const price = roundMoney(unitPrice);
  const qty = Math.round(Number(quantity ?? 0));
  if (price <= 0 || qty <= 0) return;
  bucket.set(price, (bucket.get(price) ?? 0) + qty);
}

function buildPriceSummaryGroup(label: string, bucket: Map<number, number>): RR3PriceSummaryGroup {
  const rows = Array.from(bucket.entries())
    .sort(([a], [b]) => a - b)
    .map(([unitPrice, quantity]) => ({
      unit_price: unitPrice,
      quantity,
      total: roundMoney(unitPrice * quantity),
    }));
  const totalQuantity = rows.reduce((sum, row) => sum + row.quantity, 0);
  const totalAmount = roundMoney(rows.reduce((sum, row) => sum + row.total, 0));
  const maxPriceLength = rows.reduce((max, row) => Math.max(max, formatSummaryNumber(row.unit_price).length), 0);
  const maxQtyLength = rows.reduce((max, row) => Math.max(max, String(row.quantity).length), 0);
  const lines = [
    label,
    ...rows.map((row) => {
      const price = formatSummaryNumber(row.unit_price).padStart(maxPriceLength, " ");
      const qty = String(row.quantity).padStart(maxQtyLength, " ");
      return `${price} × ${qty} = ${formatSummaryNumber(row.total)}`;
    }),
    "",
    `ยอดรวม = ${formatSummaryNumber(totalAmount)}`,
  ];

  return {
    label,
    rows,
    total_quantity: totalQuantity,
    total_amount: totalAmount,
    copy_text: lines.join("\n"),
  };
}

function extractInvoiceLineItems(value: unknown): any[] {
  if (!Array.isArray(value)) return [];
  return value.filter((item) => item && typeof item === "object");
}

function isRoomChargeLine(item: any): boolean {
  const kind = String(item?.kind ?? "").trim().toLowerCase();
  if (!kind) return true;
  return kind === "room_charge";
}

async function buildRR3PriceSummaryFromDocuments(
  supabase: SupabaseClient,
  periodId: string,
  auditEntries: any[]
): Promise<RR3PriceSummary> {
  const otaTaxBucket = new Map<number, number>();
  const walkinDirectBucket = new Map<number, number>();

  const { data: abbreviatedInvoices, error: abbreviatedError } = await supabase
    .from("abbreviated_tax_invoice")
    .select("id, source_type, channel_group")
    .eq("audit_period_id", periodId)
    .eq("source_type", "room")
    .neq("status", "cancelled");

  if (abbreviatedError) {
    throw new Error(`Failed to load abbreviated tax invoices for รร.3 summary: ${abbreviatedError.message}`);
  }

  const invoiceRows = (abbreviatedInvoices ?? []) as any[];
  const invoiceById = new Map(invoiceRows.map((row) => [String(row.id), row]));
  if (invoiceRows.length > 0) {
    const { data: lineRows, error: lineError } = await supabase
      .from("abbreviated_tax_invoice_line")
      .select("invoice_id, tax_group, quantity, unit_price, amount")
      .in("invoice_id", invoiceRows.map((row) => String(row.id)));

    if (lineError) {
      throw new Error(`Failed to load abbreviated tax invoice lines for รร.3 summary: ${lineError.message}`);
    }

    for (const line of (lineRows ?? []) as any[]) {
      const invoice = invoiceById.get(String(line.invoice_id));
      if (!invoice || !line.tax_group) continue;
      const bucket = String(invoice.channel_group) === "ota" ? otaTaxBucket : walkinDirectBucket;
      addPriceSummaryItem(bucket, line.unit_price, line.quantity);
    }
  }

  const reservationIds = Array.from(
    new Set(auditEntries.map((entry) => String(entry.reservation_id ?? "")).filter(Boolean))
  );
  if (reservationIds.length > 0) {
    const { data: fullTaxInvoices, error: fullTaxError } = await supabase
      .from("invoices")
      .select("id, reservation_id, grand_total, line_items")
      .eq("status", "issued")
      .is("cancelled_at", null)
      .in("reservation_id", reservationIds);

    if (fullTaxError) {
      throw new Error(`Failed to load full tax invoices for รร.3 summary: ${fullTaxError.message}`);
    }

    for (const invoice of (fullTaxInvoices ?? []) as any[]) {
      const roomLines = extractInvoiceLineItems(invoice.line_items).filter(isRoomChargeLine);
      if (roomLines.length === 0) {
        addPriceSummaryItem(otaTaxBucket, invoice.grand_total, 1);
        continue;
      }
      for (const line of roomLines) {
        addPriceSummaryItem(otaTaxBucket, line.unit_price ?? line.amount, line.quantity ?? 1);
      }
    }
  }

  return {
    ota_tax: buildPriceSummaryGroup("รร.3 OTA + Tax invoice", otaTaxBucket),
    walkin_direct: buildPriceSummaryGroup("รร.3 Walk-in + Direct", walkinDirectBucket),
  };
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
    .select("id, period_id, reservation_id, booking_code, guest_name, source, checkin_date, checkout_date, room_number, room_type_name, total_nights, room_revenue, extra_revenue, pos_revenue, total_revenue, paid_cash, paid_transfer, paid_credit_card, paid_other, total_paid, refund_total, outstanding, tax_invoice_requested, tax_invoice_name, tax_id, nationality, passport_number, id_card_number, guest_count")
    .eq("period_id", periodId);

  if (auditError) {
    throw new Error(`Failed to load Monthly Audit entries for รร.3: ${auditError.message}`);
  }

  const auditEntries = (auditRows ?? []) as any[];
  if (auditEntries.length === 0) {
    return { entries: [], validations: [], summary: { total_entries: 0, total_price: 0 }, price_summary: emptyPriceSummary() };
  }

  const priceSummary = await buildRR3PriceSummaryFromDocuments(supabase, periodId, auditEntries);

  const auditEntryIds = auditEntries.map((row) => String(row.id));
  const reservationIds = auditEntries.map((row) => String(row.reservation_id)).filter(Boolean);

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
  const issuedFullTaxInvoiceMap = await loadIssuedFullTaxCoverageMap(supabase as any, auditEntries);

  const { data: reservationRows, error: reservationError } = await supabase
    .from("reservations")
    .select("id, booking_code, checkin_date, checkout_date, checked_in_at, status")
    .in("id", reservationIds);

  if (reservationError) {
    throw new Error(`Failed to load Monthly Audit reservations for รร.3: ${reservationError.message}`);
  }

  const reservationById = new Map(((reservationRows ?? []) as any[]).map((row) => [String(row.id), row]));
  const includedAuditEntries: Array<{
    auditEntry: any;
    reservation: any;
    reportSource: string;
    hasIssuedFullTaxInvoice: boolean;
  }> = [];

  for (const auditEntry of auditEntries) {
    const reservationId = String(auditEntry.reservation_id ?? "");
    const reservation = reservationById.get(reservationId);
    const checkoutDate = String(auditEntry.checkout_date ?? reservation?.checkout_date ?? "");
    if (!reservationId || !checkoutDate || checkoutDate < dateFrom || checkoutDate > dateTo) continue;
    if (reservation && isSuppressedLinkedStatus(reservation.status)) continue;

    const hasIssuedFullTaxInvoice = issuedFullTaxInvoiceMap.has(reservationId);
    const reportSource = hasIssuedFullTaxInvoice
      ? "ota"
      : (channelByEntryId.get(String(auditEntry.id)) ?? normalizeAuditChannel(auditEntry.source));

    if (!matchesRR3Source(reportSource, hasIssuedFullTaxInvoice, filters)) continue;

    includedAuditEntries.push({
      auditEntry,
      reservation,
      reportSource,
      hasIssuedFullTaxInvoice,
    });
  }

  if (includedAuditEntries.length === 0) {
    return { entries: [], validations: [], summary: { total_entries: 0, total_price: 0 }, price_summary: priceSummary };
  }

  const { data: guestRows, error: guestError } = await supabase
    .from("reservation_guests")
    .select("reservation_id, guest_profile_id, role, guest_profiles(id, first_name, last_name, gender, nationality_code, country, province, id_type, id_number, passport_no)")
    .in("reservation_id", includedAuditEntries.map((item) => String(item.auditEntry.reservation_id)));

  if (guestError) throw new Error(`Failed to load reservation guests: ${guestError.message}`);

  const guestsByReservationId = new Map<string, any[]>();
  for (const row of (guestRows ?? []) as any[]) {
    const resId = String(row.reservation_id);
    const bucket = guestsByReservationId.get(resId) ?? [];
    bucket.push(row);
    guestsByReservationId.set(resId, bucket);
  }

  const entries: RR3GuestRecord[] = [];
  for (const item of includedAuditEntries) {
    const auditEntry = item.auditEntry;
    const reservationId = String(auditEntry.reservation_id);
    const guests = guestsByReservationId.get(reservationId) ?? [];
    for (const guestRow of guests) {
      const gp = Array.isArray(guestRow.guest_profiles) ? guestRow.guest_profiles[0] : guestRow.guest_profiles;
      if (!gp?.id) continue;
      const role = String(guestRow.role) as "primary" | "accompanying";
      if (!filters.include_accompanying && role === "accompanying") continue;

      entries.push({
        reservation_id: reservationId,
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
        checkin_date: String(auditEntry.checkin_date ?? item.reservation?.checkin_date ?? ""),
        checkout_date: String(auditEntry.checkout_date ?? item.reservation?.checkout_date ?? ""),
        checked_in_at: item.reservation?.checked_in_at ?? null,
        checked_out_at: null,
        room_number: auditEntry.room_number ?? null,
        source: item.reportSource,
        tax_invoice_requested: item.hasIssuedFullTaxInvoice,
        total_price: role === "primary"
          ? Math.round(Number(item.hasIssuedFullTaxInvoice ? issuedFullTaxInvoiceMap.get(reservationId)?.covered_amount : auditEntry.total_revenue ?? 0) * 100) / 100
          : 0,
        booking_code: auditEntry.booking_code ?? item.reservation?.booking_code ?? null,
      });
    }
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

  const entriesWithOverrides = applyRR3RowOverrides(entries, await loadRR3RowOverrides(supabase, periodId));
  const validations = buildRR3Validations(entriesWithOverrides);
  const totalPrice = entries
    .filter((entry) => entry.role === "primary")
    .reduce((sum, entry) => sum + entry.total_price, 0);

  return {
    entries: entriesWithOverrides,
    validations,
    summary: {
      total_entries: entries.length,
      total_price: Math.round(totalPrice * 100) / 100,
    },
    price_summary: priceSummary,
  };
}

function buildRR3Validations(entries: RR3GuestRecord[]): RR3Validation[] {
  const validations: RR3Validation[] = [];
  for (const e of entries) {
    const override = e.rr3_override ?? null;
    if (!override?.full_name && !e.first_name && !e.last_name) {
      validations.push({ reservation_id: e.reservation_id, guest_profile_id: e.guest_profile_id, field: "name", message: "ขาด: ชื่อ-สกุล" });
    }
    if (!override?.nationality && !e.nationality_code) {
      validations.push({ reservation_id: e.reservation_id, guest_profile_id: e.guest_profile_id, field: "nationality", message: "ขาด: สัญชาติ" });
    }
    if (!override?.id_or_passport && !e.id_number && !e.passport_no) {
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
    return { entries: [], validations: [], summary: { total_entries: 0, total_price: 0 }, price_summary: emptyPriceSummary() };
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
    return { entries: [], validations: [], summary: { total_entries: 0, total_price: 0 }, price_summary: emptyPriceSummary() };
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
    price_summary: emptyPriceSummary(),
  };
}
