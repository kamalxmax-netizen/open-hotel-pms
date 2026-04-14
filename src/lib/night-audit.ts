import type { BookingSource, NoShowPending } from "@/lib/types";
import { normalizeAuditSource } from "@/lib/audit-utils";

type SupabaseLike = {
  from: (table: string) => any;
};

export type NightAuditSettings = {
  businessDate: string;
  hotelTimezone: string;
  sellableRooms: number;
};

export type NightAuditPaymentTotals = {
  cash: number;
  transfer: number;
  credit_card: number;
  other: number;
  total: number;
};

type NightAuditMethodKey = keyof Omit<NightAuditPaymentTotals, "total">;
type NightAuditTxType = "payment" | "deposit" | "refund";

type NightAuditMethodBreakdown = {
  payment: number;
  deposit: number;
  refund: number;
};

type NightAuditMethodsMap = Record<NightAuditMethodKey, NightAuditMethodBreakdown>;

export type PendingWizardDraftSummary = {
  pendingCount: number;
  healedCount: number;
};

export type NightAuditSpilloverScope = {
  includeOpenBusinessSpillover: boolean;
  calendarDate: string;
};

function isMissingRelationError(error: { code?: string | null; message?: string | null } | null | undefined): boolean {
  if (!error) return false;
  if (error.code === "42P01") return true;
  const message = String(error.message ?? "").toLowerCase();
  return message.includes("relation") && message.includes("does not exist");
}

export function shiftDate(dateString: string, days: number): string {
  const date = new Date(`${dateString}T00:00:00Z`);
  if (Number.isNaN(date.getTime())) {
    throw new Error(`Invalid date: ${dateString}`);
  }
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

export function toLocalDate(date: Date, tz = "Asia/Bangkok"): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: tz }).format(date);
}

export function toBangkokWindow(dateString: string): { from: string; to: string } {
  return {
    from: `${dateString}T00:00:00+07:00`,
    to: `${dateString}T24:00:00+07:00`,
  };
}

export async function getNightAuditSettings(supabase: SupabaseLike): Promise<NightAuditSettings> {
  const { data, error } = await supabase
    .from("hotel_settings")
    .select("business_date, hotel_timezone, sellable_rooms")
    .eq("id", 1)
    .maybeSingle();

  if (error || !data?.business_date) {
    throw new Error("Hotel settings not found. Run Supabase migrations first.");
  }

  return {
    businessDate: String(data.business_date),
    hotelTimezone: String(data.hotel_timezone ?? "Asia/Bangkok"),
    sellableRooms: Number(data.sellable_rooms ?? 1) || 1,
  };
}

export async function getNightAuditSpilloverScope(
  supabase: SupabaseLike,
  businessDate: string,
  fallbackTimezone = "Asia/Bangkok"
): Promise<NightAuditSpilloverScope> {
  const { data } = await supabase
    .from("hotel_settings")
    .select("business_date, hotel_timezone")
    .eq("id", 1)
    .maybeSingle();

  const currentBusinessDate = String(data?.business_date ?? businessDate).trim() || businessDate;
  const timezone = String(data?.hotel_timezone ?? fallbackTimezone).trim() || fallbackTimezone;
  const calendarDate = toLocalDate(new Date(), timezone);

  return {
    includeOpenBusinessSpillover:
      businessDate === currentBusinessDate && calendarDate > currentBusinessDate,
    calendarDate,
  };
}

function round2(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

function normalizePaymentMethod(raw: unknown): NightAuditMethodKey {
  const value = String(raw ?? "").trim().toLowerCase();
  if (!value) return "other";
  if (value === "cash") return "cash";
  if (value === "transfer") return "transfer";
  if (value === "credit_card") return "credit_card";
  if (value === "other") return "other";
  if (value.includes("promptpay")) return "transfer";
  if (value.includes("bank transfer")) return "transfer";
  if (value.includes("transfer")) return "transfer";
  if (value.includes("credit")) return "credit_card";
  if (value.includes("card")) return "credit_card";
  if (value.includes("cash")) return "cash";
  return "other";
}

function normalizePaymentTxType(raw: unknown): NightAuditTxType {
  const value = String(raw ?? "").trim().toLowerCase();
  if (value === "deposit") return "deposit";
  if (value === "refund") return "refund";
  return "payment";
}

function isPosDepositRecord(txType: NightAuditTxType, category: string, note: string): boolean {
  if (txType !== "payment") return false;
  if (category !== "pos_revenue") return false;
  return note.toLowerCase().includes("paid by deposit");
}

function isDepositRefundEntry(txType: NightAuditTxType, category: string, note: string): boolean {
  if (txType !== "refund") return false;
  const lowered = note.toLowerCase();
  if (lowered.includes("paid by deposit")) return false;
  if (lowered.includes("void return to deposit")) return false;
  if (category === "deposit") return true;
  return lowered.includes("deposit") && lowered.includes("refund");
}

function createMethodsMap(): NightAuditMethodsMap {
  return {
    cash: { payment: 0, deposit: 0, refund: 0 },
    transfer: { payment: 0, deposit: 0, refund: 0 },
    credit_card: { payment: 0, deposit: 0, refund: 0 },
    other: { payment: 0, deposit: 0, refund: 0 },
  };
}

function applyMethodMovement(
  methods: NightAuditMethodsMap,
  method: NightAuditMethodKey,
  txType: NightAuditTxType,
  amount: number
): void {
  if (txType === "deposit") methods[method].deposit += amount;
  else if (txType === "refund") methods[method].refund += amount;
  else methods[method].payment += amount;
}

function applyCorrectionMovement(
  methods: NightAuditMethodsMap,
  method: NightAuditMethodKey,
  txType: NightAuditTxType,
  amount: number
): void {
  if (txType === "deposit") {
    methods[method].deposit += amount;
    return;
  }
  const signed = txType === "refund" ? -amount : amount;
  methods[method].payment += signed;
}

function buildVoidedPaymentIdSet(
  rows: Array<{ id?: string | null; void_of?: string | null }>,
  laterVoidedOriginalIds: Set<string> = new Set<string>()
): Set<string> {
  const excluded = new Set<string>();
  const scopedIds = new Set(
    rows
      .map((row) => String(row.id ?? "").trim())
      .filter(Boolean)
  );

  for (const originalId of laterVoidedOriginalIds) {
    if (originalId) excluded.add(originalId);
  }

  for (const row of rows) {
    const reversalId = String(row.id ?? "").trim();
    const originalId = String(row.void_of ?? "").trim();
    if (!originalId) continue;
    if (!scopedIds.has(originalId)) continue;
    excluded.add(originalId);
    if (reversalId) excluded.add(reversalId);
  }
  return excluded;
}

export function sumNightAuditPaymentTotals(
  ...totalsList: NightAuditPaymentTotals[]
): NightAuditPaymentTotals {
  const merged = totalsList.reduce(
    (acc, item) => {
      acc.cash += Number(item.cash ?? 0) || 0;
      acc.transfer += Number(item.transfer ?? 0) || 0;
      acc.credit_card += Number(item.credit_card ?? 0) || 0;
      acc.other += Number(item.other ?? 0) || 0;
      return acc;
    },
    { cash: 0, transfer: 0, credit_card: 0, other: 0 }
  );

  return {
    cash: round2(merged.cash),
    transfer: round2(merged.transfer),
    credit_card: round2(merged.credit_card),
    other: round2(merged.other),
    total: round2(merged.cash + merged.transfer + merged.credit_card + merged.other),
  };
}

export function buildNightAuditPosPaymentTotals(
  rows: Array<{ total?: number | null; payment_method?: string | null }>
): NightAuditPaymentTotals {
  const methods = createMethodsMap();
  for (const row of rows) {
    const method = normalizePaymentMethod(row.payment_method);
    const amount = Number(row.total ?? 0) || 0;
    if (amount <= 0) continue;
    applyMethodMovement(methods, method, "payment", amount);
  }

  return {
    cash: round2(methods.cash.payment),
    transfer: round2(methods.transfer.payment),
    credit_card: round2(methods.credit_card.payment),
    other: round2(methods.other.payment),
    total: round2(
      methods.cash.payment
      + methods.transfer.payment
      + methods.credit_card.payment
      + methods.other.payment
    ),
  };
}

/**
 * Payment totals used by Night Audit cards/snapshot.
 * Aligns with Payment Daily by excluding void pairs (original + reversal)
 * and record-only rows from cash received totals.
 */
export async function getNightAuditPaymentTotals(
  supabase: SupabaseLike,
  businessDate: string,
  spillover?: NightAuditSpilloverScope
): Promise<NightAuditPaymentTotals> {
  const paymentsQuery = supabase
    .from("folio_payments")
    .select("id, tx_type, method, amount, revenue_category, note, void_of, is_void_reversal, is_record_only, is_correction, pos_order_id")
    .in("tx_type", ["payment", "refund", "deposit"]);

  const { data, error } = spillover?.includeOpenBusinessSpillover
    ? await paymentsQuery.in("paid_date", [businessDate, spillover.calendarDate])
    : await paymentsQuery.eq("paid_date", businessDate);

  if (error) {
    throw new Error(error.message);
  }

  const rows = (data ?? []) as Array<{
    id?: string | null;
    tx_type?: string | null;
    method?: string | null;
    amount?: number | null;
    revenue_category?: string | null;
    note?: string | null;
    void_of?: string | null;
    is_void_reversal?: boolean | null;
    is_record_only?: boolean | null;
    is_correction?: boolean | null;
    pos_order_id?: string | null;
  }>;

  const scopedPaymentIds = rows
    .map((row) => String(row.id ?? "").trim())
    .filter(Boolean);
  const laterVoidedOriginalIds = new Set<string>();
  if (scopedPaymentIds.length > 0) {
    const { data: laterVoidRows, error: laterVoidError } = await supabase
      .from("folio_payments")
      .select("id, void_of")
      .eq("is_void_reversal", true)
      .in("void_of", scopedPaymentIds);
    if (laterVoidError) {
      throw new Error(laterVoidError.message);
    }
    for (const row of laterVoidRows ?? []) {
      const originalId = String((row as { void_of?: string | null }).void_of ?? "").trim();
      if (originalId) laterVoidedOriginalIds.add(originalId);
    }
  }

  const voidedPaymentIds = buildVoidedPaymentIdSet(rows, laterVoidedOriginalIds);
  const methods = createMethodsMap();

  for (const row of rows) {
    const rowId = String(row.id ?? "").trim();
    if (voidedPaymentIds.has(rowId)) continue;
    if (row.is_void_reversal === true) continue;
    const rawMethod = normalizePaymentMethod(row.method);
    const rawTxType = normalizePaymentTxType(row.tx_type);
    const amount = Number(row.amount ?? 0) || 0;
    const note = String(row.note ?? "").trim();
    const category = String(row.revenue_category ?? "").trim().toLowerCase();
    const isPosDeposit = isPosDepositRecord(rawTxType, category, note);
    const isPosRemainder =
      rawTxType === "payment" && category === "pos_revenue" && note.toLowerCase().includes("pos remainder");
    const isRecordOnly = row.is_record_only === true && !isPosDeposit && !isPosRemainder;
    const isCorrection = row.is_correction === true;
    const method: NightAuditMethodKey = isPosDeposit ? "cash" : rawMethod;
    const txType: NightAuditTxType = isPosDeposit ? "payment" : rawTxType;

    if (
      category === "deposit"
      && (note.toLowerCase().includes("paid by deposit") || note.toLowerCase().includes("void return to deposit"))
    ) {
      continue;
    }

    if (isDepositRefundEntry(txType, category, note)) continue;
    if (isRecordOnly) continue;

    if (isCorrection) applyCorrectionMovement(methods, method, txType, amount);
    else applyMethodMovement(methods, method, txType, amount);
  }

  return {
    cash: round2(methods.cash.payment),
    transfer: round2(methods.transfer.payment),
    credit_card: round2(methods.credit_card.payment),
    other: round2(methods.other.payment),
    total: round2(
      methods.cash.payment
      + methods.transfer.payment
      + methods.credit_card.payment
      + methods.other.payment
    ),
  };
}

export async function normalizePendingGroupCheckinWizardDrafts(
  supabase: SupabaseLike,
  businessDate: string
): Promise<PendingWizardDraftSummary> {
  const { data: openDrafts, error: openDraftsError } = await supabase
    .from("group_checkin_wizard_drafts")
    .select("id, booking_group_id, business_date, current_step")
    .eq("business_date", businessDate)
    .eq("status", "draft");

  if (openDraftsError) {
    if (isMissingRelationError(openDraftsError)) {
      return { pendingCount: 0, healedCount: 0 };
    }
    throw new Error(openDraftsError.message);
  }

  const drafts = (openDrafts ?? []).filter((row: any) => row?.id && row?.booking_group_id);
  if (drafts.length === 0) {
    return { pendingCount: 0, healedCount: 0 };
  }

  const groupIds = Array.from(new Set(drafts.map((row: any) => String(row.booking_group_id))));
  const { data: pendingReservations, error: pendingReservationsError } = await supabase
    .from("reservations")
    .select("id, booking_group_id")
    .in("booking_group_id", groupIds)
    .eq("status", "active")
    .eq("checkin_date", businessDate)
    .is("checked_in_at", null);

  if (pendingReservationsError) {
    throw new Error(pendingReservationsError.message);
  }

  const pendingGroupIds = new Set(
    (pendingReservations ?? [])
      .map((row: any) => String(row.booking_group_id ?? ""))
      .filter(Boolean)
  );

  const staleDrafts = drafts.filter((row: any) => !pendingGroupIds.has(String(row.booking_group_id)));

  if (staleDrafts.length > 0) {
    const staleIds = staleDrafts.map((row: any) => String(row.id));
    const { error: healError } = await supabase
      .from("group_checkin_wizard_drafts")
      .update({
        status: "completed",
        current_step: 4,
        last_committed_at: new Date().toISOString(),
      })
      .in("id", staleIds)
      .eq("status", "draft");

    if (healError) {
      throw new Error(healError.message);
    }

    const auditRows = staleDrafts
      .map((row: any) => ({
        action: "night_audit_auto_completed_wizard_draft",
        entity_type: "booking_group",
        entity_id: String(row.booking_group_id ?? ""),
        after_json: {
          draft_id: String(row.id ?? ""),
          business_date: row.business_date ?? businessDate,
          current_step: Number(row.current_step ?? 0),
          reason: "all_due_in_rooms_already_checked_in",
        },
        business_date: row.business_date ?? businessDate,
        source: normalizeAuditSource("night_audit"),
      }))
      .filter((row: { entity_id: string }) => row.entity_id);

    if (auditRows.length > 0) {
      await supabase.from("audit_logs").insert(auditRows);
    }
  }

  return {
    pendingCount: drafts.length - staleDrafts.length,
    healedCount: staleDrafts.length,
  };
}

function normalizeRoomNumber(row: any): string | null {
  const roomRef = Array.isArray(row?.rooms) ? row.rooms[0] : row?.rooms;
  return roomRef?.room_number ? String(roomRef.room_number) : null;
}

function normalizeNightRows(value: any): Array<any> {
  if (!Array.isArray(value)) return [];
  return value.filter((row) => !row?.cancelled_at);
}

export async function listPendingNoShows(
  supabase: SupabaseLike,
  businessDate: string
): Promise<NoShowPending[]> {
  const { data, error } = await supabase
    .from("reservations")
    .select(`
      id,
      booking_code,
      guest_name,
      phone,
      source,
      checkin_date,
      checkout_date,
      total_price,
      no_show_fee,
      checked_in_at,
      reservation_nights(
        id,
        stay_date,
        cancelled_at,
        rooms(room_number)
      )
    `)
    .eq("status", "active")
    .lte("checkin_date", businessDate)
    .is("checked_in_at", null)
    .order("checkin_date", { ascending: true });

  if (error) {
    throw new Error(error.message);
  }

  return (data ?? []).map((row: any) => {
    const activeNights = normalizeNightRows(row.reservation_nights).sort((left: any, right: any) =>
      String(left?.stay_date ?? "").localeCompare(String(right?.stay_date ?? ""))
    );

    return {
      id: String(row.id),
      booking_code: String(row.booking_code ?? ""),
      guest_name: String(row.guest_name ?? ""),
      phone: row.phone ? String(row.phone) : null,
      source: String(row.source ?? "walkin") as BookingSource,
      checkin_date: String(row.checkin_date ?? ""),
      checkout_date: String(row.checkout_date ?? ""),
      total_price: Math.round((Number(row.total_price) || 0) * 100) / 100,
      no_show_fee: row.no_show_fee === null || row.no_show_fee === undefined
        ? null
        : Math.round((Number(row.no_show_fee) || 0) * 100) / 100,
      nights_count: activeNights.length,
      room_number: activeNights.length > 0 ? normalizeRoomNumber(activeNights[0]) : null,
    };
  });
}

export async function getNoShowCandidateById(
  supabase: SupabaseLike,
  reservationId: string,
  businessDate: string
): Promise<NoShowPending | null> {
  const { data, error } = await supabase
    .from("reservations")
    .select(`
      id,
      booking_code,
      guest_name,
      phone,
      source,
      checkin_date,
      checkout_date,
      total_price,
      no_show_fee,
      checked_in_at,
      reservation_nights(
        id,
        stay_date,
        cancelled_at,
        room_id,
        rooms(room_number)
      )
    `)
    .eq("id", reservationId)
    .eq("status", "active")
    .lte("checkin_date", businessDate)
    .is("checked_in_at", null)
    .maybeSingle();

  if (error) {
    throw new Error(error.message);
  }
  if (!data) return null;

  const activeNights = normalizeNightRows(data.reservation_nights).sort((left: any, right: any) =>
    String(left?.stay_date ?? "").localeCompare(String(right?.stay_date ?? ""))
  );

  return {
    id: String(data.id),
    booking_code: String(data.booking_code ?? ""),
    guest_name: String(data.guest_name ?? ""),
    phone: data.phone ? String(data.phone) : null,
    source: String(data.source ?? "walkin") as BookingSource,
    checkin_date: String(data.checkin_date ?? ""),
    checkout_date: String(data.checkout_date ?? ""),
    total_price: Math.round((Number(data.total_price) || 0) * 100) / 100,
    no_show_fee: data.no_show_fee === null || data.no_show_fee === undefined
      ? null
      : Math.round((Number(data.no_show_fee) || 0) * 100) / 100,
    nights_count: activeNights.length,
    room_number: activeNights.length > 0 ? normalizeRoomNumber(activeNights[0]) : null,
  };
}
