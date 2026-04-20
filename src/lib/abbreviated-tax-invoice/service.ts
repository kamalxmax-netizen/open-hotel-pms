import {
  ABBREVIATED_BOOK_NO_BASE_BE_YEAR,
  ABBREVIATED_MAX_ROWS_PER_HALF_PAGE,
  ABBREVIATED_VAT_RATE,
  type AbbreviatedInvoiceDraft,
  type AbbreviatedLineDraft,
  type AbbreviatedPreviewResponse,
  type CarriedFolioInfo,
  type ChannelGroup,
  type ExcludedFolioInfo,
  type GenerateResult,
  type NightOverrideDecision,
  type RowShiftBatchInput,
  type RecalculateResult,
  type RowShiftInput,
  type TaxGroup,
} from "@/lib/abbreviated-tax-invoice/types";
import { getSellerSnapshotFromSettings } from "@/lib/tax-invoice/service";
import { normalizeMoney, round2 } from "@/lib/tax-invoice/utils";
import type { BookingSource } from "@/lib/types";
import { normalizeBookingSource } from "@/lib/monthly-audit-channel-flag/service";

type SupabaseLike = {
  from: (table: string) => any;
  rpc: (fn: string, args?: Record<string, unknown>) => any;
};

type AuditPeriodRow = {
  id: string;
  year: number;
  month: number;
  status: string;
};

type AuditEntryRow = {
  id: string;
  period_id: string;
  reservation_id: string;
  source: BookingSource;
  guest_name: string;
  checkin_date: string;
  checkout_date: string;
  outstanding: number;
};

type ReservationRow = {
  id: string;
  booking_code: string | null;
  guest_name: string;
  source: BookingSource;
  status: string;
  checkin_date: string;
  checkout_date: string;
  is_dayuse: boolean;
};

type NightRow = {
  id: string;
  reservation_id: string;
  room_id: string | null;
  stay_date: string;
  nightly_price: number;
  room_type_code: string | null;
};

type FolioRow = {
  reservation_id: string;
  tx_type: string;
  amount: number;
  revenue_category: string;
  is_record_only: boolean;
  is_void_reversal: boolean;
  is_correction: boolean;
  void_of: string | null;
};

type RoomGroupMapRow = {
  room_type_code: string;
  tax_group: TaxGroup;
  label_th: string;
  sort_order: number;
};

type ChannelFlagRow = {
  entry_id: string;
  actual_channel: BookingSource;
  tax_invoice_channel: BookingSource;
};

type NightOverrideRow = {
  entry_id: string;
  night_date: string;
  decision: NightOverrideDecision;
};

type ShiftOverrideWorkRow = {
  entry_id: string;
  tax_group: TaxGroup;
  unit_price: number;
  original_date: string;
  target_date: string;
  remaining: number;
};

type SourceNight = {
  entry_id: string;
  reservation_id: string;
  guest_name: string;
  checkin_date: string;
  checkout_date: string;
  issue_date: string;
  stay_date: string;
  channel_group: ChannelGroup;
  tax_invoice_channel: BookingSource;
  tax_group: TaxGroup;
  label_th: string;
  unit_price: number;
  amount: number;
  shifted_from_date: string | null;
  shift_source: "auto" | "manual" | null;
};

export class AbbreviatedTaxInvoiceError extends Error {
  status: number;

  constructor(message: string, status = 400) {
    super(message);
    this.name = "AbbreviatedTaxInvoiceError";
    this.status = status;
  }
}

function monthDateRange(year: number, month: number): { from: string; to: string } {
  const from = `${year}-${String(month).padStart(2, "0")}-01`;
  const lastDay = new Date(year, month, 0).getDate();
  const to = `${year}-${String(month).padStart(2, "0")}-${String(lastDay).padStart(2, "0")}`;
  return { from, to };
}

function addDays(dateIso: string, days: number): string {
  const date = new Date(`${dateIso}T00:00:00+07:00`);
  date.setDate(date.getDate() + days);
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Bangkok",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(date);
}

function str(value: unknown): string {
  return String(value ?? "").trim();
}

function sourceIds(values: string[]): string[] {
  return Array.from(new Set(values.map((value) => str(value)).filter(Boolean)));
}

export function mapActualChannelToGroup(channel: BookingSource): ChannelGroup {
  return channel === "ota" || channel === "agent" ? "ota" : "walkin_direct";
}

export function computeBookNo(issueDate: string): number {
  const year = Number(issueDate.slice(0, 4));
  const beYear = year + 543;
  return beYear - ABBREVIATED_BOOK_NO_BASE_BE_YEAR;
}

export function computeAbbreviatedInvoiceNo(issueDate: string, channelGroup: ChannelGroup): string {
  const year = Number(issueDate.slice(0, 4));
  const beYear = year + 543;
  const yy = String(beYear % 100).padStart(2, "0");
  const mmdd = issueDate.slice(5, 7) + issueDate.slice(8, 10);
  return `${channelGroup === "walkin_direct" ? "W" : ""}${yy}${mmdd}`;
}

export function computeAbbreviatedStayRange(issueDate: string): { from: string; to: string } {
  return {
    from: addDays(issueDate, -1),
    to: issueDate,
  };
}

export function computeVatBreakdown(
  incVatAmount: number,
  vatRate = ABBREVIATED_VAT_RATE
): { ex: number; vat: number; inc: number } {
  const inc = round2(Math.max(0, normalizeMoney(incVatAmount)));
  const divisor = 1 + vatRate / 100;
  const ex = round2(inc / divisor);
  return { ex, vat: round2(inc - ex), inc };
}

function isValidTaxGroup(value: unknown): value is TaxGroup {
  return value === "A" || value === "B" || value === "C" || value === "D" || value === "E";
}

async function loadAuditPeriod(supabase: SupabaseLike, year: number, month: number): Promise<AuditPeriodRow> {
  const { data, error } = await supabase
    .from("monthly_audit_periods")
    .select("id, year, month, status")
    .eq("year", year)
    .eq("month", month)
    .maybeSingle();

  if (error) throw new AbbreviatedTaxInvoiceError(error.message, 500);
  if (!data) {
    throw new AbbreviatedTaxInvoiceError(
      `No monthly audit period found for ${year}-${String(month).padStart(2, "0")}.`,
      404
    );
  }

  return {
    id: String((data as any).id),
    year: Number((data as any).year),
    month: Number((data as any).month),
    status: str((data as any).status),
  };
}

async function loadAuditEntries(supabase: SupabaseLike, periodId: string): Promise<AuditEntryRow[]> {
  const { data, error } = await supabase
    .from("monthly_audit_entries")
    .select("id, period_id, reservation_id, source, guest_name, checkin_date, checkout_date, outstanding")
    .eq("period_id", periodId)
    .limit(5000);

  if (error) throw new AbbreviatedTaxInvoiceError(error.message, 500);

  return ((data ?? []) as any[]).map((row) => ({
    id: String(row.id),
    period_id: String(row.period_id),
    reservation_id: String(row.reservation_id),
    source: normalizeBookingSource(row.source),
    guest_name: str(row.guest_name),
    checkin_date: str(row.checkin_date),
    checkout_date: str(row.checkout_date),
    outstanding: normalizeMoney(row.outstanding),
  }));
}

async function loadReservations(
  supabase: SupabaseLike,
  dateFrom: string,
  dateTo: string,
  auditEntries: AuditEntryRow[]
): Promise<ReservationRow[]> {
  const auditReservationIds = sourceIds(auditEntries.map((entry) => entry.reservation_id));
  const byId = new Map<string, ReservationRow>();

  if (auditReservationIds.length > 0) {
    const { data, error } = await supabase
      .from("reservations")
      .select("id, booking_code, guest_name, source, status, checkin_date, checkout_date, is_dayuse")
      .in("id", auditReservationIds);

    if (error) throw new AbbreviatedTaxInvoiceError(error.message, 500);
    for (const row of (data ?? []) as any[]) byId.set(String(row.id), shapeReservation(row));
  }

  const { data: overlapping, error: overlapError } = await supabase
    .from("reservations")
    .select("id, booking_code, guest_name, source, status, checkin_date, checkout_date, is_dayuse")
    .lte("checkin_date", dateTo)
    .gt("checkout_date", dateFrom)
    .neq("status", "cancelled")
    .neq("status", "no_show")
    .limit(5000);

  if (overlapError) throw new AbbreviatedTaxInvoiceError(overlapError.message, 500);
  for (const row of (overlapping ?? []) as any[]) byId.set(String(row.id), shapeReservation(row));

  return Array.from(byId.values()).sort((a, b) => a.checkout_date.localeCompare(b.checkout_date));
}

function shapeReservation(row: any): ReservationRow {
  return {
    id: String(row.id),
    booking_code: row.booking_code ?? null,
    guest_name: str(row.guest_name),
    source: normalizeBookingSource(row.source),
    status: str(row.status),
    checkin_date: str(row.checkin_date),
    checkout_date: str(row.checkout_date),
    is_dayuse: Boolean(row.is_dayuse),
  };
}

async function loadNights(
  supabase: SupabaseLike,
  reservationIds: string[],
  dateFrom: string,
  dateTo: string
): Promise<NightRow[]> {
  if (reservationIds.length === 0) return [];

  const { data, error } = await supabase
    .from("reservation_nights")
    .select("id, reservation_id, room_id, stay_date, nightly_price, rooms(id, room_type_id, room_types(code, name_en))")
    .in("reservation_id", reservationIds)
    .gte("stay_date", dateFrom)
    .lte("stay_date", dateTo)
    .is("cancelled_at", null)
    .order("stay_date", { ascending: true });

  if (error) throw new AbbreviatedTaxInvoiceError(error.message, 500);

  return ((data ?? []) as any[]).map((row) => {
    const room = Array.isArray(row.rooms) ? row.rooms[0] : row.rooms;
    const roomType = room?.room_types
      ? (Array.isArray(room.room_types) ? room.room_types[0] : room.room_types)
      : null;
    return {
      id: String(row.id),
      reservation_id: String(row.reservation_id),
      room_id: row.room_id ? String(row.room_id) : null,
      stay_date: str(row.stay_date),
      nightly_price: normalizeMoney(row.nightly_price),
      room_type_code: str(roomType?.code) || null,
    };
  });
}

async function loadFolioRows(supabase: SupabaseLike, reservationIds: string[]): Promise<FolioRow[]> {
  if (reservationIds.length === 0) return [];

  const { data, error } = await supabase
    .from("folio_payments")
    .select("reservation_id, tx_type, amount, revenue_category, is_record_only, is_void_reversal, is_correction, void_of")
    .in("reservation_id", reservationIds);

  if (error) throw new AbbreviatedTaxInvoiceError(error.message, 500);

  return ((data ?? []) as any[]).map((row) => ({
    reservation_id: String(row.reservation_id),
    tx_type: str(row.tx_type).toLowerCase(),
    amount: normalizeMoney(row.amount),
    revenue_category: str(row.revenue_category).toLowerCase(),
    is_record_only: Boolean(row.is_record_only),
    is_void_reversal: Boolean(row.is_void_reversal),
    is_correction: Boolean(row.is_correction),
    void_of: row.void_of ? String(row.void_of) : null,
  }));
}

async function loadRoomGroupMap(supabase: SupabaseLike): Promise<Map<string, RoomGroupMapRow>> {
  const { data, error } = await supabase
    .from("tax_invoice_room_group_map")
    .select("room_type_code, tax_group, label_th, sort_order")
    .order("sort_order", { ascending: true });

  if (error) throw new AbbreviatedTaxInvoiceError(error.message, 500);

  const map = new Map<string, RoomGroupMapRow>();
  for (const row of (data ?? []) as any[]) {
    if (!isValidTaxGroup(row.tax_group)) continue;
    map.set(str(row.room_type_code).toUpperCase(), {
      room_type_code: str(row.room_type_code).toUpperCase(),
      tax_group: row.tax_group,
      label_th: str(row.label_th) || `ห้องพักแบบ ${row.tax_group}`,
      sort_order: Number(row.sort_order ?? 999),
    });
  }
  return map;
}

async function loadIssuedFullTaxReservationIds(
  supabase: SupabaseLike,
  reservationIds: string[]
): Promise<Map<string, string>> {
  const map = new Map<string, string>();
  if (reservationIds.length === 0) return map;

  const { data, error } = await supabase
    .from("invoices")
    .select("id, reservation_id, booking_snapshot")
    .eq("status", "issued")
    .is("cancelled_at", null)
    .limit(5000);

  if (error) throw new AbbreviatedTaxInvoiceError(error.message, 500);

  const wanted = new Set(reservationIds);
  for (const row of (data ?? []) as any[]) {
    const ids = new Set<string>([String(row.reservation_id)]);
    const snapshot = row.booking_snapshot && typeof row.booking_snapshot === "object"
      ? row.booking_snapshot as Record<string, unknown>
      : null;
    if (Array.isArray(snapshot?.reservation_ids)) {
      for (const value of snapshot.reservation_ids) ids.add(String(value));
    }
    for (const reservationId of ids) {
      if (wanted.has(reservationId)) map.set(reservationId, String(row.id));
    }
  }
  return map;
}

function positiveRevenueRows(rows: FolioRow[]): FolioRow[] {
  return rows.filter((row) => {
    if (row.is_record_only || row.is_void_reversal || row.is_correction || row.void_of) return false;
    if (row.tx_type !== "payment") return false;
    if (row.amount <= 0) return false;
    if (row.revenue_category === "pos_revenue" || row.revenue_category === "dayuse_revenue") return false;
    return row.revenue_category === "room_revenue" || row.revenue_category === "extra_charge" || row.revenue_category === "no_show_fee";
  });
}

function extraChargeTotal(rows: FolioRow[]): number {
  return round2(
    positiveRevenueRows(rows)
      .filter((row) => row.revenue_category === "extra_charge" || row.revenue_category === "no_show_fee")
      .reduce((sum, row) => sum + row.amount, 0)
  );
}

function outstandingFromRows(rows: FolioRow[]): number {
  let revenue = 0;
  let paid = 0;
  let refunds = 0;
  for (const row of rows) {
    if (row.is_record_only || row.is_void_reversal || row.is_correction || row.void_of) continue;
    const category = row.revenue_category;
    if (row.tx_type === "refund" && category !== "deposit") {
      refunds += row.amount;
      continue;
    }
    if (row.tx_type !== "payment") continue;
    if (category === "room_revenue" || category === "extra_charge" || category === "no_show_fee") {
      revenue += row.amount;
      paid += row.amount;
    }
  }
  return round2(revenue - paid + refunds);
}

function groupByReservation<T extends { reservation_id: string }>(rows: T[]): Map<string, T[]> {
  const map = new Map<string, T[]>();
  for (const row of rows) {
    const current = map.get(row.reservation_id) ?? [];
    current.push(row);
    map.set(row.reservation_id, current);
  }
  return map;
}

function shiftOverrideKey(
  entryId: string,
  originalDate: string,
  taxGroup: TaxGroup,
  unitPrice: number
): string {
  return `${entryId}::${originalDate}::${taxGroup}::${round2(unitPrice).toFixed(2)}`;
}

function distributeExtra(total: number, count: number, index: number): number {
  if (total <= 0 || count <= 0) return 0;
  const base = round2(total / count);
  if (index < count - 1) return base;
  return round2(total - base * (count - 1));
}

function sortDraftLines(lines: AbbreviatedLineDraft[]): AbbreviatedLineDraft[] {
  return [...lines].sort((a, b) => {
    if (a.tax_group !== b.tax_group) return a.tax_group.localeCompare(b.tax_group);
    return a.unit_price - b.unit_price;
  });
}

export function groupLinesForDay(entries: SourceNight[]): AbbreviatedLineDraft[] {
  const grouped = new Map<string, AbbreviatedLineDraft>();

  for (const entry of entries) {
    const key = `${entry.tax_group}::${entry.unit_price.toFixed(2)}`;
    const current = grouped.get(key) ?? {
      tax_group: entry.tax_group,
      label_th: entry.label_th,
      quantity: 0,
      unit_price: entry.unit_price,
      amount: 0,
      source_entry_ids: [],
      source_entries: [],
      shifted_from_date: entry.shifted_from_date,
      shift_source: entry.shift_source,
    };
    current.quantity += 1;
    current.amount = round2(current.amount + entry.amount);
    current.source_entry_ids = sourceIds([...current.source_entry_ids, entry.entry_id]);
    const sourceEntry = current.source_entries.find((source) => source.entry_id === entry.entry_id);
    if (sourceEntry) {
      sourceEntry.quantity += 1;
    } else {
      current.source_entries.push({
        entry_id: entry.entry_id,
        guest_name: entry.guest_name,
        checkin_date: entry.checkin_date,
        checkout_date: entry.checkout_date,
        quantity: 1,
      });
    }
    if (current.shifted_from_date !== entry.shifted_from_date) current.shifted_from_date = null;
    if (!current.shift_source && entry.shift_source) current.shift_source = entry.shift_source;
    grouped.set(key, current);
  }

  return sortDraftLines(
    Array.from(grouped.values()).map((line) => ({
      ...line,
      amount: round2(line.amount),
      source_entries: [...line.source_entries].sort(
        (a, b) =>
          a.checkin_date.localeCompare(b.checkin_date) ||
          a.checkout_date.localeCompare(b.checkout_date) ||
          a.guest_name.localeCompare(b.guest_name) ||
          a.entry_id.localeCompare(b.entry_id)
      ),
    }))
  );
}

function buildDraftsFromNights(
  sourceNights: SourceNight[],
  period: AuditPeriodRow
): AbbreviatedInvoiceDraft[] {
  const grouped = new Map<string, SourceNight[]>();
  for (const night of sourceNights) {
    const key = `${night.issue_date}::${night.channel_group}`;
    const rows = grouped.get(key) ?? [];
    rows.push(night);
    grouped.set(key, rows);
  }

  return Array.from(grouped.entries())
    .map(([key, rows]) => {
      const [issueDate, channelGroupRaw] = key.split("::");
      const channelGroup = channelGroupRaw as ChannelGroup;
      const lines = groupLinesForDay(rows);
      const subtotal = lines.reduce((sum, line) => sum + line.amount, 0);
      const vat = computeVatBreakdown(subtotal);
      return {
        issue_date: issueDate,
        channel_group: channelGroup,
        tax_invoice_channel: channelGroup === "ota" ? ("ota" as const) : ("walkin" as const),
        predicted_invoice_no: computeAbbreviatedInvoiceNo(issueDate, channelGroup),
        book_no: computeBookNo(issueDate),
        lines,
        subtotal_inc_vat: vat.inc,
        subtotal_ex_vat: vat.ex,
        vat_rate: ABBREVIATED_VAT_RATE,
        vat_amount: vat.vat,
        warning: period.status !== "audited" ? `Audit period is ${period.status}; generation requires audited status.` : undefined,
      };
    })
    .sort((a, b) => a.issue_date.localeCompare(b.issue_date) || a.channel_group.localeCompare(b.channel_group));
}

export function computeAutoShift(drafts: AbbreviatedInvoiceDraft[]): AbbreviatedInvoiceDraft[] {
  const byKey = new Map<string, AbbreviatedInvoiceDraft>();
  for (const draft of drafts) byKey.set(`${draft.issue_date}::${draft.channel_group}`, { ...draft, lines: [...draft.lines] });

  const sortedKeys = Array.from(byKey.keys()).sort();
  const warnings = new Map<string, string>();

  for (const key of sortedKeys) {
    const draft = byKey.get(key);
    if (!draft) continue;
    draft.lines = sortDraftLines(draft.lines);
    while (draft.lines.length > ABBREVIATED_MAX_ROWS_PER_HALF_PAGE) {
      const overflow = draft.lines.pop();
      if (!overflow) break;
      const nextDate = addDays(draft.issue_date, 1);
      const targetKey = `${nextDate}::${draft.channel_group}`;
      const target = byKey.get(targetKey) ?? {
        ...draft,
        issue_date: nextDate,
        predicted_invoice_no: computeAbbreviatedInvoiceNo(nextDate, draft.channel_group),
        book_no: computeBookNo(nextDate),
        lines: [],
        subtotal_inc_vat: 0,
        subtotal_ex_vat: 0,
        vat_amount: 0,
      };
      target.lines.push({
        ...overflow,
        shifted_from_date: overflow.shifted_from_date ?? draft.issue_date,
        shift_source: overflow.shift_source ?? "auto",
      });
      warnings.set(targetKey, `Auto-shifted overflow row from ${draft.issue_date}.`);
      byKey.set(targetKey, target);
    }
  }

  return Array.from(byKey.values())
    .map((draft) => {
      const subtotal = draft.lines.reduce((sum, line) => sum + line.amount, 0);
      const vat = computeVatBreakdown(subtotal);
      return {
        ...draft,
        lines: sortDraftLines(draft.lines),
        subtotal_inc_vat: vat.inc,
        subtotal_ex_vat: vat.ex,
        vat_amount: vat.vat,
        warning: warnings.get(`${draft.issue_date}::${draft.channel_group}`) ?? draft.warning,
      };
    })
    .filter((draft) => draft.lines.length > 0)
    .sort((a, b) => a.issue_date.localeCompare(b.issue_date) || a.channel_group.localeCompare(b.channel_group));
}

export async function getNextInvoiceNumber(
  supabase: SupabaseLike,
  issueDate: string,
  channelGroup: ChannelGroup
): Promise<string> {
  const { data, error } = await supabase.rpc("next_abbreviated_invoice_no", {
    p_date: issueDate,
    p_channel_group: channelGroup,
  });
  if (error) throw new AbbreviatedTaxInvoiceError(error.message, 409);
  return String(data ?? "").trim();
}

export async function buildAbbreviatedPreview(
  supabase: SupabaseLike,
  year: number,
  month: number
): Promise<AbbreviatedPreviewResponse> {
  const period = await loadAuditPeriod(supabase, year, month);
  const { from: dateFrom, to: dateTo } = monthDateRange(year, month);
  const auditEntries = await loadAuditEntries(supabase, period.id);
  const entryByReservationId = new Map(auditEntries.map((entry) => [entry.reservation_id, entry]));
  const reservations = await loadReservations(supabase, dateFrom, dateTo, auditEntries);
  const reservationIds = reservations.map((reservation) => reservation.id);
  const nightsByReservationId = groupByReservation(await loadNights(supabase, reservationIds, dateFrom, dateTo));
  const folioByReservationId = groupByReservation(await loadFolioRows(supabase, reservationIds));
  const roomGroupMap = await loadRoomGroupMap(supabase);
  const fullTaxInvoiceByReservationId = await loadIssuedFullTaxReservationIds(supabase, reservationIds);

  const { data: flagRows, error: flagError } = await supabase
    .from("monthly_audit_channel_flag")
    .select("*")
    .eq("audit_period_id", period.id);
  if (flagError) throw new AbbreviatedTaxInvoiceError(flagError.message, 500);
  const flagByEntryId = new Map<string, ChannelFlagRow>(
    ((flagRows ?? []) as any[]).map((row: any) => [
      String(row.entry_id),
      {
        entry_id: String(row.entry_id),
        actual_channel: normalizeBookingSource(row.actual_channel),
        tax_invoice_channel: normalizeBookingSource(row.tax_invoice_channel),
      },
    ])
  );

  const { data: overrideRows, error: overrideError } = await supabase
    .from("abbreviated_invoice_override")
    .select("*")
    .eq("audit_period_id", period.id);
  if (overrideError) throw new AbbreviatedTaxInvoiceError(overrideError.message, 500);
  const overrideByEntryDate = new Map<string, NightOverrideRow>(
    ((overrideRows ?? []) as any[]).map((row: any) => [
      `${row.entry_id}::${row.night_date}`,
      {
        entry_id: String(row.entry_id),
        night_date: String(row.night_date),
        decision: row.decision as NightOverrideDecision,
      },
    ])
  );

  const { data: shiftRows, error: shiftError } = await supabase
    .from("abbreviated_row_shift_override")
    .select("*")
    .eq("audit_period_id", period.id)
    .order("set_at", { ascending: true });
  if (shiftError) throw new AbbreviatedTaxInvoiceError(shiftError.message, 500);
  const shiftByKey = new Map<string, ShiftOverrideWorkRow[]>();
  for (const row of (shiftRows ?? []) as any[]) {
    if (!isValidTaxGroup(row.tax_group)) continue;
    const item: ShiftOverrideWorkRow = {
      entry_id: String(row.entry_id),
      tax_group: row.tax_group,
      unit_price: round2(Number(row.unit_price ?? 0)),
      original_date: str(row.original_date),
      target_date: str(row.target_date),
      remaining: Math.max(0, Number(row.quantity ?? 0)),
    };
    if (item.remaining <= 0) continue;
    const key = shiftOverrideKey(item.entry_id, item.original_date, item.tax_group, item.unit_price);
    const rows = shiftByKey.get(key) ?? [];
    rows.push(item);
    shiftByKey.set(key, rows);
  }

  const sourceNights: SourceNight[] = [];
  const carried: CarriedFolioInfo[] = [];
  const excluded: ExcludedFolioInfo[] = [];

  for (const reservation of reservations) {
    const entry = entryByReservationId.get(reservation.id);
    const entryId = entry?.id ?? reservation.id;
    const guestName = entry?.guest_name || reservation.guest_name;
    const nights = (nightsByReservationId.get(reservation.id) ?? []).sort((a, b) => a.stay_date.localeCompare(b.stay_date));
    if (nights.length === 0) continue;

    if (reservation.is_dayuse) {
      excluded.push({
        entry_id: entryId,
        reservation_id: reservation.id,
        guest_name: guestName,
        reason: "dayuse",
      });
      continue;
    }

    const fullTaxInvoiceId = fullTaxInvoiceByReservationId.get(reservation.id);
    if (fullTaxInvoiceId) {
      excluded.push({
        entry_id: entryId,
        reservation_id: reservation.id,
        guest_name: guestName,
        reason: "full_tax_invoice_issued",
        full_tax_invoice_id: fullTaxInvoiceId,
      });
      continue;
    }

    const folioRows = folioByReservationId.get(reservation.id) ?? [];
    const outstanding = entry ? entry.outstanding : outstandingFromRows(folioRows);
    const flag = entry ? flagByEntryId.get(entry.id) : null;
    const actualChannel = normalizeBookingSource(flag?.actual_channel ?? entry?.source ?? reservation.source);
    const taxInvoiceChannel = normalizeBookingSource(flag?.tax_invoice_channel ?? actualChannel);
    const channelGroup = mapActualChannelToGroup(taxInvoiceChannel);

    const includedNights = nights.filter((night) => {
      const override = overrideByEntryDate.get(`${entryId}::${night.stay_date}`);
      if (override?.decision === "include_this_month") return true;
      if (override?.decision === "carry_to_next" || override?.decision === "excluded_full_tax") return false;
      if (outstanding > 0) return false;
      return night.stay_date >= dateFrom && night.stay_date <= dateTo;
    });
    const carriedNightDates = nights
      .filter((night) => !includedNights.some((includedNight) => includedNight.id === night.id))
      .map((night) => night.stay_date);

    const carriedCount = nights.length - includedNights.length;
    if (carriedCount > 0) {
      const reason = outstanding > 0 ? "outstanding" : reservation.checkout_date > dateTo ? "cross_month" : "manual";
      carried.push({
        entry_id: entryId,
        reservation_id: reservation.id,
        guest_name: guestName,
        checkin_date: reservation.checkin_date,
        checkout_date: reservation.checkout_date,
        nights_carried: carriedCount,
        night_dates: carriedNightDates,
        reason,
      });
    }

    const extrasTotal = extraChargeTotal(folioRows);
    let includedIndex = 0;
    for (const night of includedNights) {
      const roomGroup = night.room_type_code ? roomGroupMap.get(night.room_type_code.toUpperCase()) : null;
      if (!roomGroup) {
        throw new AbbreviatedTaxInvoiceError(
          `Missing tax invoice room group mapping for room type ${night.room_type_code ?? "(unknown)"}.`,
          409
        );
      }

      const extraPortion = distributeExtra(extrasTotal, includedNights.length, includedIndex);
      includedIndex += 1;
      let issueDate = night.stay_date;
      let shiftedFromDate: string | null = null;
      let shiftSource: "auto" | "manual" | null = null;
      const unitPrice = round2(night.nightly_price + extraPortion);

      const shiftKey = shiftOverrideKey(entryId, night.stay_date, roomGroup.tax_group, unitPrice);
      const shift = (shiftByKey.get(shiftKey) ?? []).find((row) => row.remaining > 0);
      if (shift) {
        shift.remaining -= 1;
        issueDate = shift.target_date;
        shiftedFromDate = night.stay_date;
        shiftSource = "manual";
      }

      sourceNights.push({
        entry_id: entryId,
        reservation_id: reservation.id,
        guest_name: guestName,
        checkin_date: reservation.checkin_date,
        checkout_date: reservation.checkout_date,
        issue_date: issueDate,
        stay_date: night.stay_date,
        channel_group: channelGroup,
        tax_invoice_channel: taxInvoiceChannel,
        tax_group: roomGroup.tax_group,
        label_th: roomGroup.label_th,
        unit_price: unitPrice,
        amount: unitPrice,
        shifted_from_date: shiftedFromDate,
        shift_source: shiftSource,
      });
    }
  }

  const drafts = computeAutoShift(buildDraftsFromNights(sourceNights, period));
  const summary = drafts.reduce(
    (acc, draft) => {
      acc.total_invoices += 1;
      if (draft.channel_group === "ota") acc.ota_count += 1;
      else acc.walkin_direct_count += 1;
      acc.grand_total_inc_vat = round2(acc.grand_total_inc_vat + draft.subtotal_inc_vat);
      acc.grand_total_ex_vat = round2(acc.grand_total_ex_vat + draft.subtotal_ex_vat);
      acc.vat_total = round2(acc.vat_total + draft.vat_amount);
      return acc;
    },
    {
      total_invoices: 0,
      ota_count: 0,
      walkin_direct_count: 0,
      grand_total_inc_vat: 0,
      grand_total_ex_vat: 0,
      vat_total: 0,
    }
  );

  return {
    period: { year, month, audit_period_id: period.id },
    drafts,
    carried,
    excluded,
    summary,
  };
}

export async function generateAbbreviatedInvoices(
  supabase: SupabaseLike,
  year: number,
  month: number,
  userId: string | null
): Promise<GenerateResult> {
  const period = await loadAuditPeriod(supabase, year, month);
  if (period.status !== "audited") {
    throw new AbbreviatedTaxInvoiceError("Abbreviated invoices can be generated only after monthly audit is audited.", 409);
  }

  const preview = await buildAbbreviatedPreview(supabase, year, month);
  const seller = await getSellerSnapshotFromSettings(supabase as any);
  const invoiceIds: string[] = [];
  const warnings: string[] = [];
  let createdCount = 0;

  for (const draft of preview.drafts) {
    const { data: existing, error: existingError } = await supabase
      .from("abbreviated_tax_invoice")
      .select("id, invoice_no")
      .eq("audit_period_id", period.id)
      .eq("issue_date", draft.issue_date)
      .eq("channel_group", draft.channel_group)
      .neq("status", "cancelled")
      .maybeSingle();

    if (existingError) throw new AbbreviatedTaxInvoiceError(existingError.message, 500);
    if (existing) {
      invoiceIds.push(String((existing as any).id));
      warnings.push(`Skipped existing invoice ${(existing as any).invoice_no}.`);
      continue;
    }

    const invoiceNo = await getNextInvoiceNumber(supabase, draft.issue_date, draft.channel_group);
    const stayRange = computeAbbreviatedStayRange(draft.issue_date);
    const { data: invoice, error: invoiceError } = await supabase
      .from("abbreviated_tax_invoice")
      .insert({
        invoice_no: invoiceNo,
        book_no: draft.book_no,
        issue_date: draft.issue_date,
        channel_group: draft.channel_group,
        tax_invoice_channel: draft.tax_invoice_channel,
        audit_period_id: period.id,
        stay_date_from: stayRange.from,
        stay_date_to: stayRange.to,
        subtotal_inc_vat: draft.subtotal_inc_vat,
        subtotal_ex_vat: draft.subtotal_ex_vat,
        vat_rate: draft.vat_rate,
        vat_amount: draft.vat_amount,
        seller_snapshot: seller,
        status: "issued",
        generated_by_user_id: userId,
      })
      .select("id")
      .single();

    if (invoiceError) throw new AbbreviatedTaxInvoiceError(invoiceError.message, 500);
    const invoiceId = String((invoice as any).id);

    const lineRows = draft.lines.map((line, index) => ({
      invoice_id: invoiceId,
      line_order: index + 1,
      tax_group: line.tax_group,
      label_th: line.label_th,
      quantity: line.quantity,
      unit_price: line.unit_price,
      amount: line.amount,
      source_entry_ids: line.source_entry_ids,
      shifted_from_date: line.shifted_from_date,
      shifted_reason: line.shift_source ? `${line.shift_source}_shift` : null,
    }));

    if (lineRows.length > 0) {
      const { error: lineError } = await supabase.from("abbreviated_tax_invoice_line").insert(lineRows);
      if (lineError) throw new AbbreviatedTaxInvoiceError(lineError.message, 500);
    }

    createdCount += 1;
    invoiceIds.push(invoiceId);
  }

  return { invoices_created: createdCount, invoice_ids: invoiceIds, warnings };
}

export async function recalculateAbbreviated(
  supabase: SupabaseLike,
  auditPeriodId: string,
  _userId: string | null
): Promise<RecalculateResult> {
  const { data: period, error } = await supabase
    .from("monthly_audit_periods")
    .select("id, year, month, status")
    .eq("id", auditPeriodId)
    .maybeSingle();
  if (error) throw new AbbreviatedTaxInvoiceError(error.message, 500);
  if (!period) throw new AbbreviatedTaxInvoiceError("Audit period not found.", 404);

  const preview = await buildAbbreviatedPreview(supabase, Number((period as any).year), Number((period as any).month));
  const seller = await getSellerSnapshotFromSettings(supabase as any);
  const changedInvoiceIds: string[] = [];

  for (const draft of preview.drafts) {
    const { data: existing, error: existingError } = await supabase
      .from("abbreviated_tax_invoice")
      .select("id")
      .eq("audit_period_id", auditPeriodId)
      .eq("issue_date", draft.issue_date)
      .eq("channel_group", draft.channel_group)
      .neq("status", "cancelled")
      .maybeSingle();

    if (existingError) throw new AbbreviatedTaxInvoiceError(existingError.message, 500);
    if (!existing) continue;

    const invoiceId = String((existing as any).id);
    const stayRange = computeAbbreviatedStayRange(draft.issue_date);
    const { error: updateError } = await supabase
      .from("abbreviated_tax_invoice")
      .update({
        tax_invoice_channel: draft.tax_invoice_channel,
        book_no: draft.book_no,
        stay_date_from: stayRange.from,
        stay_date_to: stayRange.to,
        subtotal_inc_vat: draft.subtotal_inc_vat,
        subtotal_ex_vat: draft.subtotal_ex_vat,
        vat_rate: draft.vat_rate,
        vat_amount: draft.vat_amount,
        seller_snapshot: seller,
      })
      .eq("id", invoiceId);

    if (updateError) throw new AbbreviatedTaxInvoiceError(updateError.message, 500);

    const { error: deleteLineError } = await supabase
      .from("abbreviated_tax_invoice_line")
      .delete()
      .eq("invoice_id", invoiceId);
    if (deleteLineError) throw new AbbreviatedTaxInvoiceError(deleteLineError.message, 500);

    const lineRows = draft.lines.map((line, index) => ({
      invoice_id: invoiceId,
      line_order: index + 1,
      tax_group: line.tax_group,
      label_th: line.label_th,
      quantity: line.quantity,
      unit_price: line.unit_price,
      amount: line.amount,
      source_entry_ids: line.source_entry_ids,
      shifted_from_date: line.shifted_from_date,
      shifted_reason: line.shift_source ? `${line.shift_source}_shift` : null,
    }));

    if (lineRows.length > 0) {
      const { error: insertLineError } = await supabase
        .from("abbreviated_tax_invoice_line")
        .insert(lineRows);
      if (insertLineError) throw new AbbreviatedTaxInvoiceError(insertLineError.message, 500);
    }

    changedInvoiceIds.push(invoiceId);
  }

  const { data: existingRows, error: existingError } = await supabase
    .from("abbreviated_tax_invoice")
    .select("id")
    .eq("audit_period_id", auditPeriodId)
    .neq("status", "cancelled");
  if (existingError) throw new AbbreviatedTaxInvoiceError(existingError.message, 500);

  const existingIds = new Set(((existingRows ?? []) as any[]).map((row) => String(row.id)));

  return {
    drafts_changed: preview.drafts.length,
    new_total_inc_vat: preview.summary.grand_total_inc_vat,
    changed_invoice_ids: changedInvoiceIds.filter((id) => existingIds.has(id)),
  };
}

export async function shiftRow(
  supabase: SupabaseLike,
  input: RowShiftInput,
  userId: string | null
) {
  const [row] = await shiftRows(supabase, { shifts: [input] }, userId);
  return row;
}

export async function shiftRows(
  supabase: SupabaseLike,
  input: RowShiftBatchInput,
  userId: string | null
) {
  if (input.shifts.length === 0) {
    throw new AbbreviatedTaxInvoiceError("At least one row shift is required.", 400);
  }

  const entryIds = sourceIds(input.shifts.map((shift) => shift.entry_id));
  const { data: entries, error: entryError } = await supabase
    .from("monthly_audit_entries")
    .select("id, period_id")
    .in("id", entryIds);
  if (entryError) throw new AbbreviatedTaxInvoiceError(entryError.message, 500);
  const periodByEntryId = new Map<string, string>(
    ((entries ?? []) as any[]).map((entry) => [String(entry.id), String(entry.period_id)])
  );
  if (periodByEntryId.size !== entryIds.length) {
    throw new AbbreviatedTaxInvoiceError("Monthly audit entry not found.", 404);
  }

  const periodIds = sourceIds(Array.from(periodByEntryId.values()));
  if (periodIds.length !== 1) {
    throw new AbbreviatedTaxInvoiceError("All row shifts must belong to the same audit period.", 400);
  }

  const rows = input.shifts.map((shift) => ({
    audit_period_id: periodByEntryId.get(shift.entry_id),
    entry_id: shift.entry_id,
    tax_group: shift.tax_group,
    unit_price: shift.unit_price,
    quantity: shift.quantity,
    original_date: shift.original_date,
    target_date: shift.target_date,
    reason: shift.reason ?? null,
    set_by_user_id: userId,
  }));

  const { data, error } = await supabase
    .from("abbreviated_row_shift_override")
    .insert(rows)
    .select("*")
    .order("set_at", { ascending: true });
  if (error) throw new AbbreviatedTaxInvoiceError(error.message, 500);
  return data ?? [];
}

export async function shiftGeneratedLine(
  supabase: SupabaseLike,
  lineId: string,
  targetDate: string,
  userId: string | null
) {
  const { data: line, error: lineError } = await supabase
    .from("abbreviated_tax_invoice_line")
    .select("*, abbreviated_tax_invoice!inner(id, audit_period_id, issue_date, channel_group, status)")
    .eq("id", lineId)
    .maybeSingle();
  if (lineError) throw new AbbreviatedTaxInvoiceError(lineError.message, 500);
  if (!line) throw new AbbreviatedTaxInvoiceError("Invoice line not found.", 404);

  const invoice = Array.isArray((line as any).abbreviated_tax_invoice)
    ? (line as any).abbreviated_tax_invoice[0]
    : (line as any).abbreviated_tax_invoice;
  if (String(invoice?.status) === "cancelled") {
    throw new AbbreviatedTaxInvoiceError("Cannot shift a cancelled invoice line.", 409);
  }

  const { data: target, error: targetError } = await supabase
    .from("abbreviated_tax_invoice")
    .select("id")
    .eq("audit_period_id", String(invoice.audit_period_id))
    .eq("issue_date", targetDate)
    .eq("channel_group", String(invoice.channel_group))
    .neq("status", "cancelled")
    .maybeSingle();
  if (targetError) throw new AbbreviatedTaxInvoiceError(targetError.message, 500);
  if (!target) throw new AbbreviatedTaxInvoiceError("Target invoice for this date/channel does not exist.", 404);

  const { data, error } = await supabase
    .from("abbreviated_tax_invoice_line")
    .update({
      invoice_id: String((target as any).id),
      shifted_from_date: String(invoice.issue_date),
      shifted_reason: `manual_post_generate:${userId ?? "unknown"}`,
    })
    .eq("id", lineId)
    .select("*")
    .single();
  if (error) throw new AbbreviatedTaxInvoiceError(error.message, 500);
  return data;
}

export async function setNightOverride(
  supabase: SupabaseLike,
  params: {
    entryId: string;
    nightDate: string;
    decision: NightOverrideDecision;
    reason?: string | null;
    userId: string | null;
  }
) {
  const { data: entry, error: entryError } = await supabase
    .from("monthly_audit_entries")
    .select("id, period_id")
    .eq("id", params.entryId)
    .maybeSingle();
  if (entryError) throw new AbbreviatedTaxInvoiceError(entryError.message, 500);
  if (!entry) throw new AbbreviatedTaxInvoiceError("Monthly audit entry not found.", 404);

  const { data, error } = await supabase
    .from("abbreviated_invoice_override")
    .upsert(
      {
        audit_period_id: String((entry as any).period_id),
        entry_id: params.entryId,
        night_date: params.nightDate,
        decision: params.decision,
        reason: params.reason ?? null,
        set_by_user_id: params.userId,
        set_at: new Date().toISOString(),
      },
      { onConflict: "entry_id,night_date" }
    )
    .select("*")
    .single();
  if (error) throw new AbbreviatedTaxInvoiceError(error.message, 500);
  return data;
}

export async function setNightOverridesBatch(
  supabase: SupabaseLike,
  params: {
    entryId: string;
    nights: {
      date: string;
      decision: NightOverrideDecision;
      reason?: string | null;
    }[];
    userId: string | null;
  }
) {
  if (params.nights.length === 0) {
    throw new AbbreviatedTaxInvoiceError("At least one night override is required.", 400);
  }

  const { data: entry, error: entryError } = await supabase
    .from("monthly_audit_entries")
    .select("id, period_id")
    .eq("id", params.entryId)
    .maybeSingle();
  if (entryError) throw new AbbreviatedTaxInvoiceError(entryError.message, 500);
  if (!entry) throw new AbbreviatedTaxInvoiceError("Monthly audit entry not found.", 404);

  const rows = params.nights.map((night) => ({
    audit_period_id: String((entry as any).period_id),
    entry_id: params.entryId,
    night_date: night.date,
    decision: night.decision,
    reason: night.reason ?? null,
    set_by_user_id: params.userId,
    set_at: new Date().toISOString(),
  }));

  const { data, error } = await supabase
    .from("abbreviated_invoice_override")
    .upsert(rows, { onConflict: "entry_id,night_date" })
    .select("*")
    .order("night_date", { ascending: true });
  if (error) throw new AbbreviatedTaxInvoiceError(error.message, 500);
  return data ?? [];
}
