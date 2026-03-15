import { fromSatang, toSatang } from "@/lib/money";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import type {
  ExtraFeeCategory,
  ExtraFeeTemplate,
  OperatorPaymentMethod,
  PaymentMethod,
} from "@/lib/types";

export const PAYMENT_METHODS = new Set<PaymentMethod>(["cash", "transfer", "credit_card", "other"]);
export const OPERATOR_PAYMENT_METHODS = new Set<OperatorPaymentMethod>([
  "cash",
  "transfer",
  "credit_card",
]);
export const FEE_CATEGORIES = new Set<ExtraFeeCategory>(["service", "penalty", "damage", "policy"]);

export type FeeInsertInput = {
  reservationId: string;
  feeTemplateCode: string;
  amount: number;
  method: OperatorPaymentMethod;
  note?: string | null;
  cashierName?: string | null;
  paidAt?: string;
  paidDate?: string;
};

export type FeePaymentRow = {
  id: string;
  tx_type: "payment" | "refund" | "deposit";
  method: PaymentMethod;
  amount: number | string;
  note: string | null;
  paid_at: string;
  paid_date: string;
  created_at: string;
  revenue_category?: string | null;
  fee_template_code?: string | null;
  is_record_only?: boolean | null;
  extra_fee_templates?: {
    code: string;
    name: string;
    icon: string | null;
    category: string;
  } | null;
};

export type FeeSummary = {
  room_charges_total: number;
  extra_charges_total: number;
  grand_total: number;
  total_paid: number;
  deposit_held: number;
  deposit_collected: number;
  balance: number;
};

function toNumber(value: unknown): number {
  const num = typeof value === "number" ? value : Number(value);
  return Number.isFinite(num) ? num : 0;
}

export function toLocalDate(d: Date, tz = "Asia/Bangkok"): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: tz }).format(d);
}

export async function assertBusinessDayOpen(
  supabase: ReturnType<typeof createServerSupabaseClient>,
  targetDate: string
) {
  const { data, error } = await supabase
    .from("daily_snapshots")
    .select("business_date")
    .gte("business_date", targetDate)
    .order("business_date", { ascending: true })
    .limit(1)
    .maybeSingle();

  if (error) throw new Error(error.message);
  if (data?.business_date) {
    throw new Error("Business day already closed. Use reversal.");
  }
}

export function normalizePaymentMethod(raw: unknown): PaymentMethod | null {
  if (raw === "cash" || raw === "transfer" || raw === "credit_card" || raw === "other") {
    return raw;
  }
  if (raw === "ota_collect" || raw === "ota") return "other";
  if (raw === "refund_cash") return "cash";
  if (raw === "refund_transfer") return "transfer";
  if (raw === "refund_card") return "credit_card";
  return null;
}

export function normalizeOperatorPaymentMethod(raw: unknown): OperatorPaymentMethod | null {
  if (raw === "cash" || raw === "transfer" || raw === "credit_card") {
    return raw;
  }
  if (raw === "card") return "credit_card";
  return null;
}

export function normalizeExtraFeeCategory(raw: unknown): ExtraFeeCategory | null {
  if (raw === "service" || raw === "penalty" || raw === "damage" || raw === "policy") {
    return raw;
  }
  return null;
}

export function computeFeeSummary(
  totalPrice: number,
  depositHeld: number,
  payments: FeePaymentRow[]
): FeeSummary {
  const roomChargesSatang = toSatang(totalPrice);
  const fallbackDepositSatang = toSatang(depositHeld);

  let allCreditsSatang = 0;
  let extraChargesSatang = 0;
  let heldDepositFromLedgerSatang = 0;
  let sawDepositLedgerRows = false;

  for (const payment of payments) {
    const amountSatang = toSatang(payment.amount);
    const revenueCategory = String(payment.revenue_category ?? "");
    const txType = payment.tx_type;
    const note = String(payment.note ?? "").toLowerCase();
    const isRecordOnly = payment.is_record_only === true;

    const isDepositLedgerRefund =
      txType === "refund" &&
      (
        revenueCategory === "deposit" ||
        (note.includes("deposit") && note.includes("refund")) ||
        note.includes("paid by deposit")
      );
    const isDepositLedgerInflow = txType === "deposit";

    if (!isRecordOnly) {
      if (isDepositLedgerInflow) {
        heldDepositFromLedgerSatang += amountSatang;
        sawDepositLedgerRows = true;
      } else if (isDepositLedgerRefund) {
        heldDepositFromLedgerSatang -= amountSatang;
        sawDepositLedgerRows = true;
      }
    }

    const isDepositCategory =
      revenueCategory === "deposit" || isDepositLedgerRefund;

    if (revenueCategory === "extra_charge") {
      if (txType === "payment") extraChargesSatang += amountSatang;
      if (txType === "refund") extraChargesSatang -= amountSatang;
    }

    if (isRecordOnly) continue;
    if (txType === "deposit" || isDepositCategory) continue;
    if (txType === "payment") allCreditsSatang += amountSatang;
    if (txType === "refund") allCreditsSatang -= amountSatang;
  }

  const depositSatang = sawDepositLedgerRows
    ? Math.max(0, heldDepositFromLedgerSatang)
    : fallbackDepositSatang;
  const grandTotalSatang = roomChargesSatang + extraChargesSatang;
  const balanceSatang = grandTotalSatang - allCreditsSatang;

  return {
    room_charges_total: fromSatang(roomChargesSatang),
    extra_charges_total: fromSatang(extraChargesSatang),
    grand_total: fromSatang(grandTotalSatang),
    total_paid: fromSatang(allCreditsSatang),
    deposit_held: fromSatang(depositSatang),
    deposit_collected: fromSatang(depositSatang),
    balance: fromSatang(balanceSatang),
  };
}

export async function fetchExtraFeeTemplate(
  supabase: ReturnType<typeof createServerSupabaseClient>,
  code: string
) {
  const { data, error } = await supabase
    .from("extra_fee_templates")
    .select("code, name, default_price, category, icon, is_active, sort_order, created_at")
    .eq("code", code)
    .maybeSingle();

  if (error) throw new Error(error.message);
  if (!data) return null;

  return {
    ...data,
    default_price: toNumber(data.default_price),
    category: normalizeExtraFeeCategory(data.category) ?? "service",
    sort_order: Math.trunc(toNumber(data.sort_order)),
  } as ExtraFeeTemplate;
}

export async function insertExtraFeePayment(
  supabase: ReturnType<typeof createServerSupabaseClient>,
  input: FeeInsertInput
) {
  const paidAt = input.paidAt ?? new Date().toISOString();
  const paidDate = input.paidDate ?? toLocalDate(new Date(paidAt));
  const amount = fromSatang(toSatang(input.amount));

  const { data, error } = await supabase
    .from("folio_payments")
    .insert({
      reservation_id: input.reservationId,
      tx_type: "payment",
      method: input.method,
      amount,
      note: input.note?.trim() ? input.note.trim() : null,
      revenue_category: "extra_charge",
      fee_template_code: input.feeTemplateCode,
      cashier_name: input.cashierName?.trim() ? input.cashierName.trim() : "FO",
      paid_date: paidDate,
      paid_at: paidAt,
    })
    .select(`
      id,
      tx_type,
      method,
      amount,
      note,
      paid_at,
      paid_date,
      created_at,
      revenue_category,
      fee_template_code,
      extra_fee_templates(code, name, icon, category)
    `)
    .maybeSingle();

  if (error) throw new Error(error.message);
  return data as FeePaymentRow | null;
}
