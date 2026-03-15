import { toSatang } from "@/lib/money";

type CheckoutBalancePaymentRow = {
  amount: number | string | null;
  tx_type: string | null;
  revenue_category?: string | null;
  note?: string | null;
  is_record_only?: boolean | null;
};

export function resolveCheckoutRevenueCategory(
  rawCategory: unknown,
  txType: string | null | undefined,
  rawNote: unknown
): string {
  const category = typeof rawCategory === "string" && rawCategory.trim().length > 0
    ? rawCategory.trim()
    : "room_revenue";

  if (txType === "refund" && category === "room_revenue") {
    const note = String(rawNote ?? "").toLowerCase();
    if (note.includes("deposit") && note.includes("refund")) {
      return "deposit";
    }
  }

  return category;
}

export function computeCheckoutNetPaidSatang(rows: CheckoutBalancePaymentRow[] | null | undefined): {
  totalPaidSatang: number;
  totalRefundedSatang: number;
  netPaidSatang: number;
} {
  let totalPaidSatang = 0;
  let totalRefundedSatang = 0;

  for (const row of rows ?? []) {
    const txType = row.tx_type ?? "";
    if (txType !== "payment" && txType !== "refund") continue;
    if (row.is_record_only === true) continue;

    const category = resolveCheckoutRevenueCategory(row.revenue_category, txType, row.note);
    // Deposits stay separate from checkout settlement. Extra-charge rows are special:
    // they increase outstanding via computeExtraChargeNetSatang, but each paid row also
    // represents real money already collected and must count toward settlement credits.
    if (category === "deposit") continue;

    const amountSatang = toSatang(row.amount);
    if (txType === "refund") {
      totalRefundedSatang += amountSatang;
    } else {
      totalPaidSatang += amountSatang;
    }
  }

  return {
    totalPaidSatang,
    totalRefundedSatang,
    netPaidSatang: totalPaidSatang - totalRefundedSatang,
  };
}

export function computeExtraChargeNetSatang(rows: CheckoutBalancePaymentRow[] | null | undefined): number {
  let extraChargesSatang = 0;

  for (const row of rows ?? []) {
    const txType = row.tx_type ?? "";
    if (txType !== "payment" && txType !== "refund") continue;

    const category = resolveCheckoutRevenueCategory(row.revenue_category, txType, row.note);
    if (category !== "extra_charge") continue;

    const amountSatang = toSatang(row.amount);
    if (txType === "payment") extraChargesSatang += amountSatang;
    if (txType === "refund") extraChargesSatang -= amountSatang;
  }

  return extraChargesSatang;
}
