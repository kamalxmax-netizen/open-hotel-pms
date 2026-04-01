import type { SupabaseClient } from "@supabase/supabase-js";
import { computeCheckoutNetPaidSatang, computeExtraChargeNetSatang } from "@/lib/checkout-balance";
import { fromSatang, toSatang } from "@/lib/money";
import { computeReservationDiscountAmount } from "@/lib/reservation-visible-total";
import type { ScbTargetLookupRow } from "@/lib/scb/types";

export async function resolveReservationOutstanding(
  supabase: SupabaseClient,
  reservationId: string
): Promise<number> {
  const { data: reservation, error: resError } = await supabase
    .from("reservations")
    .select("id, total_price, discount_type, discount_value, discount_percent, checkin_date, checkout_date")
    .eq("id", reservationId)
    .maybeSingle();
  if (resError) throw new Error(resError.message);
  if (!reservation) throw new Error("Reservation not found.");

  const { data: payments, error: paymentError } = await supabase
    .from("folio_payments")
    .select("amount, tx_type, revenue_category, note, is_record_only, fee_template_code")
    .eq("reservation_id", reservationId);
  if (paymentError) throw new Error(paymentError.message);

  const totalPriceSatang = toSatang(reservation.total_price ?? 0);
  const discountSatang = toSatang(
    computeReservationDiscountAmount({
      totalPrice: reservation.total_price ?? 0,
      discountType: reservation.discount_type,
      discountValue: reservation.discount_value,
      discountPercent: reservation.discount_percent,
      checkinDate: reservation.checkin_date,
      checkoutDate: reservation.checkout_date,
    })
  );
  const discountedRoomTotalSatang = Math.max(0, totalPriceSatang - discountSatang);
  const { netPaidSatang } = computeCheckoutNetPaidSatang(payments ?? []);
  const extraChargeNetSatang = computeExtraChargeNetSatang(payments ?? []);
  return Math.max(0, fromSatang(discountedRoomTotalSatang + extraChargeNetSatang - netPaidSatang));
}

async function lookupPendingRequestTargetIds(
  supabase: SupabaseClient,
  targetType: "reservation" | "pos_order",
  targetIds: string[]
): Promise<Set<string>> {
  if (targetIds.length === 0) return new Set();
  const { data, error } = await supabase
    .from("scb_payment_requests")
    .select("target_id")
    .eq("target_type", targetType)
    .eq("status", "pending")
    .in("target_id", targetIds);
  if (error) throw new Error(error.message);
  return new Set((data ?? []).map((row) => String(row.target_id)));
}

export async function searchReservationTargets(
  supabase: SupabaseClient,
  q: string,
  limit = 5
): Promise<ScbTargetLookupRow[]> {
  const query = String(q ?? "").trim();
  if (!query) return [];
  const { data, error } = await supabase
    .from("reservations")
    .select("id, booking_code, guest_name, status, created_at")
    .or(`booking_code.ilike.%${query}%,guest_name.ilike.%${query}%`)
    .order("created_at", { ascending: false })
    .limit(limit * 3);
  if (error) throw new Error(error.message);

  const rows = (data ?? []).filter((row) => {
    const status = String(row.status ?? "").toLowerCase();
    return status !== "checked_out" && status !== "cancelled" && status !== "no_show";
  }).slice(0, limit);
  const pendingIds = await lookupPendingRequestTargetIds(
    supabase,
    "reservation",
    rows.map((row) => String(row.id))
  );

  return Promise.all(
    rows.map(async (row) => ({
      target_id: String(row.id),
      target_code: String(row.booking_code ?? row.id),
      guest_name: row.guest_name ? String(row.guest_name) : null,
      outstanding_amount: await resolveReservationOutstanding(supabase, String(row.id)),
      has_pending_request: pendingIds.has(String(row.id)),
    }))
  );
}

export async function searchPosTargets(
  supabase: SupabaseClient,
  q: string,
  limit = 5
): Promise<ScbTargetLookupRow[]> {
  const query = String(q ?? "").trim();
  if (!query) return [];
  const { data, error } = await supabase
    .from("pos_orders")
    .select("id, order_number, guest_name, total, status, created_at")
    .or(`order_number.ilike.%${query}%,guest_name.ilike.%${query}%`)
    .neq("status", "voided")
    .order("created_at", { ascending: false })
    .limit(limit);
  if (error) throw new Error(error.message);

  const rows = data ?? [];
  const pendingIds = await lookupPendingRequestTargetIds(
    supabase,
    "pos_order",
    rows.map((row) => String(row.id))
  );

  const orderIds = rows.map((row) => String(row.id));
  const { data: paymentRows, error: paymentError } = orderIds.length
    ? await supabase
        .from("folio_payments")
        .select("pos_order_id, amount, tx_type, is_record_only")
        .in("pos_order_id", orderIds)
    : { data: [], error: null as any };
  if (paymentError) throw new Error(paymentError.message);

  const paidByOrderId = new Map<string, number>();
  for (const row of paymentRows ?? []) {
    const orderId = String(row.pos_order_id ?? "");
    if (!orderId || row.is_record_only) continue;
    const signed = row.tx_type === "refund" ? -Math.abs(Number(row.amount ?? 0)) : Math.abs(Number(row.amount ?? 0));
    paidByOrderId.set(orderId, Number((paidByOrderId.get(orderId) ?? 0) + signed));
  }

  return rows.map((row) => {
    const total = Number(row.total ?? 0);
    const paid = Number(paidByOrderId.get(String(row.id)) ?? 0);
    const status = String(row.status ?? "").toLowerCase();
    const outstandingAmount = status === "completed" ? Math.max(0, total - paid) : Math.max(0, total - paid);
    return {
      target_id: String(row.id),
      target_code: String(row.order_number ?? row.id),
      guest_name: row.guest_name ? String(row.guest_name) : null,
      outstanding_amount: outstandingAmount,
      total_amount: total,
      has_pending_request: pendingIds.has(String(row.id)),
    };
  });
}

export async function loadReservationMetaMap(
  supabase: SupabaseClient,
  reservationIds: string[]
): Promise<Map<string, { code: string | null; guestName: string | null }>> {
  if (reservationIds.length === 0) return new Map();
  const { data, error } = await supabase
    .from("reservations")
    .select("id, booking_code, guest_name")
    .in("id", reservationIds);
  if (error) throw new Error(error.message);
  return new Map(
    (data ?? []).map((row) => [
      String(row.id),
      {
        code: row.booking_code ? String(row.booking_code) : null,
        guestName: row.guest_name ? String(row.guest_name) : null,
      },
    ])
  );
}

export async function loadPosMetaMap(
  supabase: SupabaseClient,
  orderIds: string[]
): Promise<Map<string, { code: string | null; guestName: string | null }>> {
  if (orderIds.length === 0) return new Map();
  const { data, error } = await supabase
    .from("pos_orders")
    .select("id, order_number, guest_name")
    .in("id", orderIds);
  if (error) throw new Error(error.message);
  return new Map(
    (data ?? []).map((row) => [
      String(row.id),
      {
        code: row.order_number ? String(row.order_number) : null,
        guestName: row.guest_name ? String(row.guest_name) : null,
      },
    ])
  );
}
