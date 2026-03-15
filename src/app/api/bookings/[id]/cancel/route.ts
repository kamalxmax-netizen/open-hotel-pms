import { NextResponse } from "next/server";
import { z } from "zod";
import { mapBookingErrorToStatus } from "@/lib/bookings";
import { syncBookingGroupStatusById } from "@/lib/booking-group-status";
import { assertBusinessDayOpen, normalizeOperatorPaymentMethod, toLocalDate } from "@/lib/folio-fees";
import { computePrepaidNetAmount, suggestRefundMethod } from "@/lib/settlement-preview";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { fromSatang, toSatang } from "@/lib/money";

const cancelSchema = z.object({
  cancel_reason: z.string().min(1).optional(),
  fee_amount: z.number().min(0).optional(),
  fee_method: z.enum(["cash", "transfer", "credit_card"]).optional(), // legacy key
  fee_collect_method: z.enum(["cash", "transfer", "credit_card"]).optional(),
  refund_method: z.enum(["cash", "transfer"]).optional(),
  fee_note: z.string().optional(),
  refund_note: z.string().optional(),
});

function normalizeAmount(value: number): number {
  return fromSatang(toSatang(value));
}

export async function POST(
  request: Request,
  { params }: { params: { id: string } }
) {
  const body = await request.json().catch(() => ({}));
  const parsed = cancelSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid payload.", details: parsed.error.flatten() },
      { status: 400 }
    );
  }

  const reservationId = params.id;
  if (!reservationId) {
    return NextResponse.json({ error: "Missing reservation id." }, { status: 400 });
  }

  const supabase = createServerSupabaseClient();
  const cancelReason = parsed.data.cancel_reason?.trim() || null;
  const feeAmount = normalizeAmount(Number(parsed.data.fee_amount ?? 0));
  const feeCollectMethodRaw = parsed.data.fee_collect_method ?? parsed.data.fee_method ?? null;
  const feeCollectMethod = feeCollectMethodRaw ? normalizeOperatorPaymentMethod(feeCollectMethodRaw) : null;
  const feeNote = parsed.data.fee_note?.trim() || null;
  const refundNote = parsed.data.refund_note?.trim() || null;

  const { data: reservationRef, error: reservationRefError } = await supabase
    .from("reservations")
    .select("id, booking_group_id")
    .eq("id", reservationId)
    .maybeSingle();

  if (reservationRefError) {
    return NextResponse.json({ error: reservationRefError.message }, { status: 500 });
  }
  if (!reservationRef) {
    return NextResponse.json({ error: "Reservation not found." }, { status: 404 });
  }

  const { data: paymentRows, error: paymentRowsError } = await supabase
    .from("folio_payments")
    .select("amount, tx_type, revenue_category, note, is_record_only, method")
    .eq("reservation_id", reservationId);

  if (paymentRowsError) {
    return NextResponse.json({ error: paymentRowsError.message }, { status: 500 });
  }

  const prepaidNet = normalizeAmount(computePrepaidNetAmount(paymentRows ?? []));
  const suggestedRefundMethod = suggestRefundMethod(paymentRows ?? []);

  let feeFromPrepaid = 0;
  let feeCollectedNow = 0;
  let refundDue = 0;

  if (prepaidNet > 0) {
    if (feeAmount > prepaidNet) {
      return NextResponse.json(
        { error: `Cancellation fee cannot exceed pre-paid amount (฿${prepaidNet.toFixed(2)}).` },
        { status: 400 }
      );
    }
    feeFromPrepaid = feeAmount;
    refundDue = normalizeAmount(prepaidNet - feeFromPrepaid);
  } else {
    if (feeAmount > 0) {
      if (!feeCollectMethod) {
        return NextResponse.json(
          { error: "fee_collect_method is required when collecting a new cancellation fee." },
          { status: 400 }
        );
      }
      feeCollectedNow = feeAmount;
    }
  }

  const refundMethod = parsed.data.refund_method ?? suggestedRefundMethod;
  if (refundDue > 0 && !refundMethod) {
    return NextResponse.json({ error: "refund_method is required when refund due > 0." }, { status: 400 });
  }

  const nowIso = new Date().toISOString();
  const localDate = toLocalDate(new Date(nowIso));
  try {
    await assertBusinessDayOpen(supabase, localDate);
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Business day already closed." },
      { status: 400 }
    );
  }

  const settlementRows: Record<string, unknown>[] = [];
  if (feeFromPrepaid > 0) {
    settlementRows.push({
      reservation_id: reservationId,
      tx_type: "payment",
      method: null,
      amount: feeFromPrepaid,
      note: feeNote || cancelReason || "Cancellation fee (settled from pre-paid)",
      revenue_category: "extra_charge",
      fee_template_code: "CANCEL_FEE",
      is_record_only: true,
      cashier_name: "FO",
      paid_date: localDate,
      paid_at: nowIso,
    });
  }
  if (feeCollectedNow > 0) {
    settlementRows.push({
      reservation_id: reservationId,
      tx_type: "payment",
      method: feeCollectMethod,
      amount: feeCollectedNow,
      note: feeNote || cancelReason || "Cancellation fee",
      revenue_category: "extra_charge",
      fee_template_code: "CANCEL_FEE",
      is_record_only: false,
      cashier_name: "FO",
      paid_date: localDate,
      paid_at: nowIso,
    });
  }
  if (refundDue > 0) {
    settlementRows.push({
      reservation_id: reservationId,
      tx_type: "refund",
      method: refundMethod,
      amount: refundDue,
      note: refundNote || `Refund (Cancel) — ${refundMethod}`,
      revenue_category: "room_revenue",
      is_record_only: false,
      cashier_name: "FO",
      paid_date: localDate,
      paid_at: nowIso,
    });
  }

  if (settlementRows.length > 0) {
    const { error: settlementError } = await supabase
      .from("folio_payments")
      .insert(settlementRows);
    if (settlementError) {
      return NextResponse.json({ error: settlementError.message }, { status: 500 });
    }
  }

  const { data, error } = await supabase.rpc("booking_cancel_reservation", {
    p_reservation_id: reservationId,
    p_cancel_reason: cancelReason
  });

  if (error) {
    const status = mapBookingErrorToStatus(error.message);
    return NextResponse.json(
      {
        error: error.message,
        settlement_recorded: settlementRows.length > 0,
        warning: settlementRows.length > 0
          ? "Settlement rows were recorded, but cancel action failed. Please retry cancel only."
          : null,
      },
      { status }
    );
  }
  if (!data) {
    return NextResponse.json({ error: "Cancel reservation failed." }, { status: 500 });
  }

  if (reservationRef.booking_group_id) {
    try {
      await syncBookingGroupStatusById(supabase, String(reservationRef.booking_group_id));
    } catch (syncError) {
      console.error("group status sync after cancel failed:", reservationRef.booking_group_id, syncError);
    }
  }

  return NextResponse.json(
    {
      success: true,
      reservation: data,
      settlement: {
        prepaid_net: prepaidNet,
        fee_from_prepaid: feeFromPrepaid,
        fee_collected_now: feeCollectedNow,
        refund_due: refundDue,
        refund_method: refundDue > 0 ? refundMethod : null,
        suggested_refund_method: suggestedRefundMethod,
      }
    },
    { status: 200 }
  );
}
