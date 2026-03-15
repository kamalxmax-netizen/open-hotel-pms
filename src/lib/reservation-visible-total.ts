import { computeExtraChargeNetSatang } from "@/lib/checkout-balance";
import { listNights } from "@/lib/dates";
import { fromSatang, toSatang } from "@/lib/money";
import { createServerSupabaseClient } from "@/lib/supabase/server";

type SupabaseClient = ReturnType<typeof createServerSupabaseClient>;

type PaymentRow = {
  reservation_id: string | null;
  amount: number | string | null;
  tx_type: string | null;
  revenue_category?: string | null;
  note?: string | null;
};

export async function fetchReservationVisibleTotals(
  supabase: SupabaseClient,
  reservationIds: string[]
): Promise<Map<string, number>> {
  const normalizedIds = Array.from(new Set(reservationIds.map((id) => String(id || "").trim()).filter(Boolean)));
  const totals = new Map<string, number>();

  if (normalizedIds.length === 0) return totals;

  const { data, error } = await supabase
    .from("folio_payments")
    .select("reservation_id, amount, tx_type, revenue_category, note")
    .in("reservation_id", normalizedIds);

  if (error) {
    throw new Error(error.message);
  }

  const rowsByReservation = new Map<string, PaymentRow[]>();
  for (const row of (data ?? []) as PaymentRow[]) {
    const reservationId = String(row.reservation_id ?? "").trim();
    if (!reservationId) continue;
    const existing = rowsByReservation.get(reservationId) ?? [];
    existing.push(row);
    rowsByReservation.set(reservationId, existing);
  }

  for (const reservationId of normalizedIds) {
    const rows = rowsByReservation.get(reservationId) ?? [];
    const extraNetSatang = computeExtraChargeNetSatang(rows);
    totals.set(reservationId, fromSatang(extraNetSatang));
  }

  return totals;
}

export function computeReservationDiscountAmount(input: {
  totalPrice: number | string | null | undefined;
  discountType?: string | null;
  discountValue?: number | string | null;
  discountPercent?: number | string | null;
  checkinDate?: string | null;
  checkoutDate?: string | null;
}): number {
  const totalPrice = fromSatang(toSatang(input.totalPrice ?? 0));
  const rawValue = input.discountValue ?? input.discountPercent ?? 0;
  const discountValue = fromSatang(toSatang(rawValue));
  if (totalPrice <= 0 || discountValue <= 0) return 0;

  if (input.discountType === "fixed_total") {
    return Math.min(totalPrice, discountValue);
  }

  if (input.discountType === "fixed_per_night") {
    let nights = 0;
    try {
      nights = listNights(String(input.checkinDate ?? ""), String(input.checkoutDate ?? "")).length;
    } catch {
      nights = 0;
    }
    return Math.min(totalPrice, discountValue * Math.max(0, nights));
  }

  const percent = Math.max(0, Math.min(100, discountValue));
  if (percent <= 0) return 0;
  if (percent >= 100) return totalPrice;

  const grossPrice = totalPrice / (1 - percent / 100);
  return Math.min(totalPrice, fromSatang(toSatang(grossPrice - totalPrice)));
}

export function applyVisibleTotal(
  baseTotal: number | string | null | undefined,
  extraNet: number | undefined,
  discount?: {
    discountType?: string | null;
    discountValue?: number | string | null;
    discountPercent?: number | string | null;
    checkinDate?: string | null;
    checkoutDate?: string | null;
  }
): number {
  const discountAmount = discount
    ? computeReservationDiscountAmount({
        totalPrice: baseTotal,
        discountType: discount.discountType,
        discountValue: discount.discountValue,
        discountPercent: discount.discountPercent,
        checkinDate: discount.checkinDate,
        checkoutDate: discount.checkoutDate,
      })
    : 0;
  return fromSatang(toSatang(baseTotal ?? 0) - toSatang(discountAmount) + toSatang(extraNet ?? 0));
}
