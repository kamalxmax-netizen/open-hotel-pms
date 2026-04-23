import { isValidDateString } from "@/lib/dates";
import {
  computePrepaidNetAmount,
  computeShortenPrepaidNetAmount,
  computeShortenOverpaidAmount,
  computeShortenProjectedTotal,
  suggestRefundMethod,
  suggestShortenRefundMethod,
} from "@/lib/settlement-preview";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { unstable_noStore as noStore } from "next/cache";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

export const dynamic = "force-dynamic";
export const fetchCache = "force-no-store";

const querySchema = z.object({
  action: z.enum(["cancel", "shorten"]).default("cancel"),
  new_checkout_date: z.string().optional(),
});

export async function GET(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  noStore();
  try {
    const reservationId = params.id;
    if (!reservationId) {
      return NextResponse.json({ error: "Missing reservation id." }, { status: 400 });
    }

    const parsed = querySchema.safeParse({
      action: request.nextUrl.searchParams.get("action") ?? "cancel",
      new_checkout_date: request.nextUrl.searchParams.get("new_checkout_date") ?? undefined,
    });
    if (!parsed.success) {
      return NextResponse.json({ error: "Invalid query.", details: parsed.error.flatten() }, { status: 400 });
    }

    const action = parsed.data.action;
    const newCheckoutDate = parsed.data.new_checkout_date;
    const supabase = createServerSupabaseClient();

    const { data: reservation, error: reservationError } = await supabase
      .from("reservations")
      .select("id, status, checkin_date, checkout_date, total_price")
      .eq("id", reservationId)
      .maybeSingle();

    if (reservationError) {
      return NextResponse.json({ error: reservationError.message }, { status: 500 });
    }
    if (!reservation) {
      return NextResponse.json({ error: "Reservation not found." }, { status: 404 });
    }

    const { data: payments, error: paymentsError } = await supabase
      .from("folio_payments")
      .select("amount, tx_type, revenue_category, note, is_record_only, method")
      .eq("reservation_id", reservationId);
    if (paymentsError) {
      return NextResponse.json({ error: paymentsError.message }, { status: 500 });
    }

    const prepaidNet = computePrepaidNetAmount(payments ?? []);
    const suggestedRefundMethod = suggestRefundMethod(payments ?? []);
    const allowedRefundMethods: Array<"cash" | "transfer"> = ["cash", "transfer"];
    const oldTotal = Number(reservation.total_price ?? 0);

    if (action === "cancel") {
      const feeCap = prepaidNet;
      return NextResponse.json({
        success: true,
        action,
        reservation_id: reservationId,
        prepaid_net: prepaidNet,
        old_total: oldTotal,
        new_total: null,
        overpaid: null,
        fee_cap: feeCap,
        default_no_fee: prepaidNet <= 0,
        warning:
          prepaidNet <= 0
            ? "No pre-paid amount found. Fee can still be collected as a new payment."
            : null,
        suggested_refund_method: suggestedRefundMethod,
        allowed_refund_methods: allowedRefundMethods,
      });
    }

    if (!newCheckoutDate || !isValidDateString(newCheckoutDate)) {
      return NextResponse.json(
        { error: "new_checkout_date is required for action=shorten (YYYY-MM-DD)." },
        { status: 400 }
      );
    }

    const checkinDate = String(reservation.checkin_date ?? "");
    const currentCheckoutDate = String(reservation.checkout_date ?? "");

    if (!isValidDateString(checkinDate) || !isValidDateString(currentCheckoutDate)) {
      return NextResponse.json({ error: "Reservation has invalid date range." }, { status: 409 });
    }
    if (newCheckoutDate >= currentCheckoutDate) {
      return NextResponse.json(
        { error: "new_checkout_date must be earlier than current checkout_date." },
        { status: 400 }
      );
    }
    if (newCheckoutDate <= checkinDate) {
      return NextResponse.json(
        { error: "new_checkout_date must be after checkin_date." },
        { status: 400 }
      );
    }

    const { data: nights, error: nightsError } = await supabase
      .from("reservation_nights")
      .select("stay_date, nightly_price")
      .eq("reservation_id", reservationId)
      .is("cancelled_at", null)
      .order("stay_date", { ascending: true });
    if (nightsError) {
      return NextResponse.json({ error: nightsError.message }, { status: 500 });
    }

    const shortenPrepaidNet = computeShortenPrepaidNetAmount(payments ?? []);
    const shortenRefundMethod = suggestShortenRefundMethod(payments ?? []);
    const newTotal = computeShortenProjectedTotal({
      checkinDate,
      checkoutDate: currentCheckoutDate,
      newCheckoutDate,
      currentTotalPrice: oldTotal,
      nights: nights ?? [],
    });
    const overpaid = computeShortenOverpaidAmount(shortenPrepaidNet, newTotal);

    return NextResponse.json({
      success: true,
      action,
      reservation_id: reservationId,
      prepaid_net: shortenPrepaidNet,
      old_total: oldTotal,
      new_total: newTotal,
      overpaid,
      fee_cap: overpaid,
      default_no_fee: shortenPrepaidNet <= 0 || overpaid <= 0,
      warning:
        shortenPrepaidNet <= 0
          ? "No pre-paid amount found. Fee can still be collected as a new payment."
          : overpaid <= 0
          ? "No overpaid amount after shorten. Refund is not required."
          : null,
      suggested_refund_method: shortenRefundMethod,
      allowed_refund_methods: allowedRefundMethods,
    });
  } catch (error) {
    return NextResponse.json({ error: String(error) }, { status: 500 });
  }
}
