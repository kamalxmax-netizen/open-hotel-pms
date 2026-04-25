import { computeCheckoutNetPaidSatang, resolveCheckoutRevenueCategory } from "@/lib/checkout-balance";
import { fromSatang, toSatang } from "@/lib/money";
import { listNights } from "@/lib/dates";

export type SettlementAction = "cancel" | "shorten";
export type SettlementRefundMethod = "cash" | "transfer";
export type SettlementFeeCollectMethod = "cash" | "transfer" | "credit_card";

export type SettlementPreviewPaymentRow = {
  amount: number | string | null;
  tx_type: string | null;
  revenue_category?: string | null;
  note?: string | null;
  is_record_only?: boolean | null;
  method?: string | null;
};

type SettlementRevenueScope = "all_non_deposit" | "room_revenue_only";

export type SettlementPreviewNightRow = {
  stay_date: string | null;
  nightly_price: number | string | null;
};

export type ShortenPreviewInput = {
  checkinDate: string;
  checkoutDate: string;
  newCheckoutDate: string;
  currentTotalPrice: number;
  nights: SettlementPreviewNightRow[];
};

function round2(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

function normalizeMethod(raw: unknown): SettlementFeeCollectMethod | null {
  const method = String(raw ?? "").trim().toLowerCase();
  if (method === "cash") return "cash";
  if (method === "transfer") return "transfer";
  if (method === "credit_card" || method === "card") return "credit_card";
  return null;
}

export function computePrepaidNetAmount(rows: SettlementPreviewPaymentRow[] | null | undefined): number {
  const { netPaidSatang } = computeCheckoutNetPaidSatang(rows ?? []);
  return fromSatang(Math.max(0, netPaidSatang));
}

function computeScopedNetPaidSatang(
  rows: SettlementPreviewPaymentRow[] | null | undefined,
  scope: SettlementRevenueScope
): number {
  let totalPaidSatang = 0;
  let totalRefundedSatang = 0;

  for (const row of rows ?? []) {
    const txType = String(row.tx_type ?? "").toLowerCase();
    if (txType !== "payment" && txType !== "refund") continue;
    if (row.is_record_only === true) continue;

    const category = resolveCheckoutRevenueCategory(row.revenue_category, txType, row.note);
    if (category === "deposit") continue;
    if (scope === "room_revenue_only" && category !== "room_revenue") continue;

    const amountSatang = toSatang(row.amount);
    if (txType === "refund") totalRefundedSatang += amountSatang;
    else totalPaidSatang += amountSatang;
  }

  return totalPaidSatang - totalRefundedSatang;
}

export function computeShortenPrepaidNetAmount(
  rows: SettlementPreviewPaymentRow[] | null | undefined
): number {
  return fromSatang(Math.max(0, computeScopedNetPaidSatang(rows, "room_revenue_only")));
}

export function suggestRefundMethod(rows: SettlementPreviewPaymentRow[] | null | undefined): SettlementRefundMethod {
  const methods = new Set<SettlementFeeCollectMethod>();

  for (const row of rows ?? []) {
    const txType = String(row.tx_type ?? "").toLowerCase();
    if (txType !== "payment") continue;
    if (row.is_record_only === true) continue;
    if (String(row.revenue_category ?? "").toLowerCase() === "deposit") continue;
    const method = normalizeMethod(row.method);
    if (method) methods.add(method);
  }

  if (methods.size !== 1) return "cash";

  const [single] = Array.from(methods.values());
  if (single === "transfer") return "transfer";
  return "cash";
}

// Keep separate from suggestRefundMethod: shorten refunds only consider rows
// resolved as room revenue, while cancellation refunds only exclude raw deposits.
export function suggestShortenRefundMethod(
  rows: SettlementPreviewPaymentRow[] | null | undefined
): SettlementRefundMethod {
  const methods = new Set<SettlementFeeCollectMethod>();

  for (const row of rows ?? []) {
    const txType = String(row.tx_type ?? "").toLowerCase();
    if (txType !== "payment") continue;
    if (row.is_record_only === true) continue;
    const category = resolveCheckoutRevenueCategory(row.revenue_category, txType, row.note);
    if (category !== "room_revenue") continue;
    const method = normalizeMethod(row.method);
    if (method) methods.add(method);
  }

  if (methods.size !== 1) return "cash";

  const [single] = Array.from(methods.values());
  if (single === "transfer") return "transfer";
  return "cash";
}

export function computeShortenProjectedTotal(input: ShortenPreviewInput): number {
  const currentTotalSatang = toSatang(input.currentTotalPrice);
  let oldNightsCount = 0;
  let newNightsCount = 0;

  try {
    oldNightsCount = listNights(input.checkinDate, input.checkoutDate).length;
    newNightsCount = listNights(input.checkinDate, input.newCheckoutDate).length;
  } catch {
    oldNightsCount = 0;
    newNightsCount = 0;
  }

  if (newNightsCount <= 0) return 0;

  const rows = (input.nights ?? [])
    .map((row) => ({
      stayDate: String(row.stay_date ?? ""),
      nightlySatang: toSatang(row.nightly_price ?? 0),
    }))
    .filter((row) => row.stayDate >= input.checkinDate && row.stayDate < input.newCheckoutDate);

  const hasUsableNightlyRows = rows.length > 0;
  if (hasUsableNightlyRows) {
    const totalSatang = rows.reduce((sum, row) => sum + row.nightlySatang, 0);
    return fromSatang(Math.max(0, totalSatang));
  }

  if (oldNightsCount > 0) {
    const projected = Math.round((currentTotalSatang * newNightsCount) / oldNightsCount);
    return fromSatang(Math.max(0, projected));
  }

  return fromSatang(Math.max(0, currentTotalSatang));
}

export function computeShortenOverpaidAmount(prepaidNet: number, newTotal: number): number {
  return round2(Math.max(0, prepaidNet - newTotal));
}
