import { computeExtraChargeNetSatang } from "@/lib/checkout-balance";
import { computeFeeSummary } from "@/lib/folio-fees";
import { fromSatang, toSatang } from "@/lib/money";
import { computeReservationDiscountAmount } from "@/lib/reservation-discount";
import { createServerSupabaseClient } from "@/lib/supabase/server";

export { computeReservationDiscountAmount } from "@/lib/reservation-discount";

type SupabaseClient = ReturnType<typeof createServerSupabaseClient>;

type PaymentRow = {
  reservation_id: string | null;
  amount: number | string | null;
  tx_type: string | null;
  revenue_category?: string | null;
  note?: string | null;
  is_record_only?: boolean | null;
};

export type ReservationOutstandingInput = {
  id: string;
  total_price: number | string | null | undefined;
  deposit_amount?: number | string | null | undefined;
  discount_type?: string | null;
  discount_value?: number | string | null;
  discount_percent?: number | string | null;
  checkin_date?: string | null;
  checkout_date?: string | null;
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
    .select("reservation_id, amount, tx_type, revenue_category, note, is_record_only")
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

export async function fetchReservationOutstandingBalances(
  supabase: SupabaseClient,
  reservations: ReservationOutstandingInput[]
): Promise<Map<string, number>> {
  const normalized = reservations
    .map((reservation) => ({
      ...reservation,
      id: String(reservation.id || "").trim(),
    }))
    .filter((reservation) => reservation.id.length > 0);
  const ids = Array.from(new Set(normalized.map((reservation) => reservation.id)));
  const totals = new Map<string, number>();

  if (ids.length === 0) return totals;

  const { data, error } = await supabase
    .from("folio_payments")
    .select("reservation_id, amount, tx_type, revenue_category, note, is_record_only")
    .in("reservation_id", ids);

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

  for (const reservation of normalized) {
    const rows = rowsByReservation.get(reservation.id) ?? [];
    const feeSummary = computeFeeSummary(
      fromSatang(toSatang(reservation.total_price ?? 0)),
      fromSatang(toSatang(reservation.deposit_amount ?? 0)),
      rows as any
    );
    const discountAmount = computeReservationDiscountAmount({
      totalPrice: reservation.total_price,
      discountType: reservation.discount_type,
      discountValue: reservation.discount_value,
      discountPercent: reservation.discount_percent,
      checkinDate: reservation.checkin_date,
      checkoutDate: reservation.checkout_date,
    });

    totals.set(
      reservation.id,
      fromSatang(toSatang(feeSummary.balance) - toSatang(discountAmount))
    );
  }

  return totals;
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
