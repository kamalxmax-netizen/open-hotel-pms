export const MOBILE_CHECKIN_PAYMENT_NOTE = "Mobile check-in payment";
export const MOBILE_CHECKIN_DEPOSIT_NOTE = "Mobile check-in deposit";

export type MobileCheckinFinancialRow = {
  id?: string | null;
  tx_type?: string | null;
  method?: string | null;
  amount?: number | string | null;
  note?: string | null;
  revenue_category?: string | null;
  paid_date?: string | null;
  is_void_reversal?: boolean | null;
  void_of?: string | null;
};

export type MobileCheckinFinancialMatch = {
  txType: "payment" | "deposit";
  method: "cash" | "transfer" | "credit_card";
  amount: number;
  note: string;
  revenueCategory: string;
  paidDate: string;
  allowAnyNote?: boolean;
};

function normalizeToken(value: unknown): string {
  return String(value ?? "").trim().toLowerCase();
}

function toSatang(value: unknown): number {
  const amount = Number(value ?? 0);
  if (!Number.isFinite(amount)) return 0;
  return Math.round(amount * 100);
}

export function hasMatchingMobileCheckinFinancial(
  rows: MobileCheckinFinancialRow[],
  expected: MobileCheckinFinancialMatch
): boolean {
  const expectedAmountSatang = toSatang(expected.amount);
  const voidedOriginalIds = new Set(
    rows.map((row) => String(row.void_of ?? "").trim()).filter(Boolean)
  );

  return rows.some((row) => {
    const rowId = String(row.id ?? "").trim();
    if (row.is_void_reversal || row.void_of || (rowId && voidedOriginalIds.has(rowId))) return false;
    const noteMatches = expected.allowAnyNote || String(row.note ?? "").trim() === expected.note;

    return (
      normalizeToken(row.tx_type) === expected.txType &&
      normalizeToken(row.method) === expected.method &&
      toSatang(row.amount) === expectedAmountSatang &&
      noteMatches &&
      normalizeToken(row.revenue_category) === normalizeToken(expected.revenueCategory) &&
      String(row.paid_date ?? "").trim() === expected.paidDate
    );
  });
}
