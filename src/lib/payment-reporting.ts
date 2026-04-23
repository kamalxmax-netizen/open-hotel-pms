import { createServerSupabaseClient } from "@/lib/supabase/server";

export const PAYMENT_REPORT_METHOD_KEYS = ["cash", "transfer", "credit_card", "other"] as const;
export const PAYMENT_REPORT_CATEGORIES = [
  "room_revenue",
  "pos_revenue",
  "extra_charge",
  "deposit",
  "no_show_fee",
  "dayuse_revenue",
] as const;

export type PaymentReportMethodKey = (typeof PAYMENT_REPORT_METHOD_KEYS)[number];
export type PaymentReportCategory = (typeof PAYMENT_REPORT_CATEGORIES)[number];
export type PaymentReportTxType = "payment" | "deposit" | "refund";

export type PaymentReportBreakdown = {
  payment: number;
  deposit: number;
  refund: number;
  net: number;
};

export type PaymentReportMethodsMap = Record<PaymentReportMethodKey, PaymentReportBreakdown>;

export type PaymentReportRow = {
  id: string | null;
  reservation_id?: string | null;
  pos_order_id?: string | null;
  paid_date?: string | null;
  paid_at?: string | null;
  method?: string | null;
  tx_type?: string | null;
  amount?: number | null;
  note?: string | null;
  revenue_category?: string | null;
  cashier_name?: string | null;
  is_record_only?: boolean | null;
  is_correction?: boolean | null;
  is_void_reversal?: boolean | null;
  void_of?: string | null;
};

export type PaymentReportExcludedReason =
  | "void_pair"
  | "record_only"
  | "deposit_refund_separate"
  | "paid_by_deposit_trace"
  | "policy_fee_duplicate";

export function round2(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

export function normalizePaymentReportMethod(raw: unknown): PaymentReportMethodKey {
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

export function normalizePaymentReportTxType(raw: unknown): PaymentReportTxType {
  const value = String(raw ?? "").trim().toLowerCase();
  if (value === "deposit") return "deposit";
  if (value === "refund") return "refund";
  return "payment";
}

export function normalizePaymentReportCategory(
  rawCategory: unknown,
  txType: PaymentReportTxType,
  rawNote: unknown
): PaymentReportCategory {
  const category = PAYMENT_REPORT_CATEGORIES.includes(rawCategory as PaymentReportCategory)
    ? (rawCategory as PaymentReportCategory)
    : "room_revenue";
  if (txType === "refund" && category !== "deposit") {
    const note = String(rawNote ?? "").toLowerCase();
    if (note.includes("deposit") && note.includes("refund")) {
      return "deposit";
    }
  }
  return category;
}

export function isPaymentReportPosDepositRecord(
  txType: PaymentReportTxType,
  category: string,
  note: string
): boolean {
  if (txType !== "payment") return false;
  if (category !== "pos_revenue") return false;
  return note.toLowerCase().includes("paid by deposit");
}

export function isPaymentReportDepositRefundEntry(
  txType: PaymentReportTxType,
  category: string,
  note: string
): boolean {
  if (txType !== "refund") return false;
  const lowered = note.toLowerCase();
  if (lowered.includes("paid by deposit")) return false;
  if (lowered.includes("void return to deposit")) return false;
  if (category === "deposit") return true;
  return lowered.includes("deposit") && lowered.includes("refund");
}

export function buildPaymentReportVoidedIdSet(
  rows: PaymentReportRow[],
  laterVoidedOriginalIds: Set<string> = new Set()
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
    const originalId = String(row.void_of ?? "").trim();
    const reversalId = String(row.id ?? "").trim();
    if (!originalId) continue;
    if (!scopedIds.has(originalId)) continue;
    excluded.add(originalId);
    if (reversalId) excluded.add(reversalId);
  }
  return excluded;
}

export function buildPaymentReportPolicyFeeDedupKey(row: PaymentReportRow): string {
  const reservationId = String(row.reservation_id ?? "");
  const paidAt = String(row.paid_at ?? "");
  const method = normalizePaymentReportMethod(row.method);
  const amount = round2(Number(row.amount ?? 0)).toFixed(2);
  const note = String(row.note ?? "").trim().toLowerCase();
  return `${reservationId}|${paidAt}|${method}|${amount}|${note}`;
}

export function createPaymentReportMethodsMap(): PaymentReportMethodsMap {
  return {
    cash: { payment: 0, deposit: 0, refund: 0, net: 0 },
    transfer: { payment: 0, deposit: 0, refund: 0, net: 0 },
    credit_card: { payment: 0, deposit: 0, refund: 0, net: 0 },
    other: { payment: 0, deposit: 0, refund: 0, net: 0 },
  };
}

export function finalizePaymentReportMethods(map: PaymentReportMethodsMap): PaymentReportMethodsMap {
  const out = createPaymentReportMethodsMap();
  for (const key of PAYMENT_REPORT_METHOD_KEYS) {
    const row = map[key];
    out[key] = {
      payment: round2(row.payment),
      deposit: round2(row.deposit),
      refund: round2(row.refund),
      net: round2(row.payment + row.deposit - row.refund),
    };
  }
  return out;
}

export function applyPaymentReportMovement(
  methods: PaymentReportMethodsMap,
  method: PaymentReportMethodKey,
  txType: PaymentReportTxType,
  amount: number
): void {
  if (txType === "deposit") methods[method].deposit += amount;
  else if (txType === "refund") methods[method].refund += amount;
  else methods[method].payment += amount;
}

export function methodsNetTotal(methods: PaymentReportMethodsMap): number {
  return round2(
    PAYMENT_REPORT_METHOD_KEYS.reduce(
      (sum, key) => sum + methods[key].payment + methods[key].deposit - methods[key].refund,
      0
    )
  );
}

export function toBangkokDateString(date = new Date()): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Bangkok",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);
  const year = parts.find((part) => part.type === "year")?.value;
  const month = parts.find((part) => part.type === "month")?.value;
  const day = parts.find((part) => part.type === "day")?.value;
  if (!year || !month || !day) return new Date().toISOString().slice(0, 10);
  return `${year}-${month}-${day}`;
}

export function listDateRange(startDate: string, endDate: string): string[] {
  const dates: string[] = [];
  const cursor = new Date(`${startDate}T00:00:00+07:00`);
  const end = new Date(`${endDate}T00:00:00+07:00`);
  while (!Number.isNaN(cursor.getTime()) && !Number.isNaN(end.getTime()) && cursor <= end) {
    dates.push(toBangkokDateString(cursor));
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }
  return dates;
}

export async function resolvePaymentReportBusinessDates(
  supabase: ReturnType<typeof createServerSupabaseClient>,
  startDate: string,
  endDate: string
) {
  const calendarDate = toBangkokDateString();
  const { resolveBusinessDate } = await import("@/lib/folio-fees");
  const currentBusinessDate = await resolveBusinessDate(supabase, calendarDate);
  const dates = listDateRange(startDate, endDate);
  const scopedDateSet = new Set(dates);
  const countedDateAlias = new Map<string, string>();

  if (
    currentBusinessDate >= startDate &&
    currentBusinessDate <= endDate &&
    calendarDate > currentBusinessDate
  ) {
    scopedDateSet.add(calendarDate);
    countedDateAlias.set(calendarDate, currentBusinessDate);
  }

  return {
    calendarDate,
    currentBusinessDate,
    scopedDates: Array.from(scopedDateSet).sort(),
    countedDateAlias,
  };
}
