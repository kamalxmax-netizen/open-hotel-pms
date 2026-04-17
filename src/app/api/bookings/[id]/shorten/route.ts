import { isValidDateString } from "@/lib/dates";
import { fromSatang, toSatang } from "@/lib/money";
import {
  assertBusinessDayOpen,
  normalizeOperatorPaymentMethod,
  resolveBusinessDate,
} from "@/lib/folio-fees";
import { appendReservationNoteLine } from "@/lib/planned-room-moves";
import {
  computePrepaidNetAmount,
  computeShortenOverpaidAmount,
  computeShortenProjectedTotal,
  suggestRefundMethod,
} from "@/lib/settlement-preview";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

export const dynamic = "force-dynamic";
export const fetchCache = "force-no-store";

const shortenSchema = z.object({
  new_checkout_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  update_payload: z.record(z.string(), z.unknown()),
  fee_amount: z.number().min(0).optional(),
  fee_collect_method: z.enum(["cash", "transfer", "credit_card"]).optional(),
  refund_method: z.enum(["cash", "transfer"]).optional(),
  fee_note: z.string().optional(),
  refund_note: z.string().optional(),
});

function normalizeAmount(value: number): number {
  return fromSatang(toSatang(value));
}

export async function POST(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const reservationId = params.id;
    if (!reservationId) {
      return NextResponse.json({ error: "Missing reservation id." }, { status: 400 });
    }

    const body = await request.json().catch(() => ({}));
    const parsed = shortenSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: "Invalid payload.", details: parsed.error.flatten() },
        { status: 400 }
      );
    }

    const newCheckoutDate = parsed.data.new_checkout_date;
    const updatePayload: Record<string, unknown> = { ...parsed.data.update_payload, checkout_date: newCheckoutDate };
    const feeAmount = normalizeAmount(Number(parsed.data.fee_amount ?? 0));
    const feeCollectMethod = parsed.data.fee_collect_method
      ? normalizeOperatorPaymentMethod(parsed.data.fee_collect_method)
      : null;
    const feeNote = parsed.data.fee_note?.trim() || "Shorten stay fee";
    const refundNote = parsed.data.refund_note?.trim() || null;

    const supabase = createServerSupabaseClient();

    const { data: reservation, error: reservationError } = await supabase
      .from("reservations")
      .select("id, checkin_date, checkout_date, total_price")
      .eq("id", reservationId)
      .maybeSingle();
    if (reservationError) {
      return NextResponse.json({ error: reservationError.message }, { status: 500 });
    }
    if (!reservation) {
      return NextResponse.json({ error: "Reservation not found." }, { status: 404 });
    }

    const checkinDate = String(reservation.checkin_date ?? "");
    const oldCheckoutDate = String(reservation.checkout_date ?? "");
    if (!isValidDateString(checkinDate) || !isValidDateString(oldCheckoutDate)) {
      return NextResponse.json({ error: "Reservation has invalid date range." }, { status: 409 });
    }
    if (newCheckoutDate >= oldCheckoutDate) {
      return NextResponse.json({ error: "new_checkout_date must be earlier than current checkout_date." }, { status: 400 });
    }
    if (newCheckoutDate <= checkinDate) {
      return NextResponse.json({ error: "new_checkout_date must be after checkin_date." }, { status: 400 });
    }

    const [{ data: paymentRows, error: paymentRowsError }, { data: nights, error: nightsError }] = await Promise.all([
      supabase
        .from("folio_payments")
        .select("amount, tx_type, revenue_category, note, is_record_only, method")
        .eq("reservation_id", reservationId),
      supabase
        .from("reservation_nights")
        .select("stay_date, nightly_price")
        .eq("reservation_id", reservationId)
        .is("cancelled_at", null)
        .order("stay_date", { ascending: true }),
    ]);

    if (paymentRowsError) {
      return NextResponse.json({ error: paymentRowsError.message }, { status: 500 });
    }
    if (nightsError) {
      return NextResponse.json({ error: nightsError.message }, { status: 500 });
    }

    const prepaidNet = normalizeAmount(computePrepaidNetAmount(paymentRows ?? []));
    const suggestedRefundMethod = suggestRefundMethod(paymentRows ?? []);
    const projectedNewTotal = normalizeAmount(
      computeShortenProjectedTotal({
        checkinDate,
        checkoutDate: oldCheckoutDate,
        newCheckoutDate,
        currentTotalPrice: Number(reservation.total_price ?? 0),
        nights: nights ?? [],
      })
    );
    const overpaid = normalizeAmount(computeShortenOverpaidAmount(prepaidNet, projectedNewTotal));

    let feeFromPrepaid = 0;
    let feeCollectedNow = 0;
    let refundDue = 0;
    if (overpaid > 0) {
      if (feeAmount > overpaid) {
        return NextResponse.json(
          { error: `Shorten fee cannot exceed overpaid amount (฿${overpaid.toFixed(2)}).` },
          { status: 400 }
        );
      }
      feeFromPrepaid = feeAmount;
      refundDue = normalizeAmount(overpaid - feeFromPrepaid);
    } else if (feeAmount > 0) {
      if (!feeCollectMethod) {
        return NextResponse.json(
          { error: "fee_collect_method is required when collecting a new shorten fee." },
          { status: 400 }
        );
      }
      feeCollectedNow = feeAmount;
    }

    const refundMethod = parsed.data.refund_method ?? suggestedRefundMethod;
    if (refundDue > 0 && !refundMethod) {
      return NextResponse.json({ error: "refund_method is required when refund due > 0." }, { status: 400 });
    }

    const nowIso = new Date().toISOString();
    const businessDate = await resolveBusinessDate(supabase);
    try {
      await assertBusinessDayOpen(supabase, businessDate);
    } catch (guardError) {
      return NextResponse.json(
        { error: guardError instanceof Error ? guardError.message : "Business day already closed." },
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
        note: feeNote || "Shorten stay fee (settled from pre-paid)",
        revenue_category: "extra_charge",
        fee_template_code: "SHORTEN_FEE",
        is_record_only: true,
        cashier_name: "FO",
        paid_date: businessDate,
        paid_at: nowIso,
      });
    }
    if (feeCollectedNow > 0) {
      settlementRows.push({
        reservation_id: reservationId,
        tx_type: "payment",
        method: feeCollectMethod,
        amount: feeCollectedNow,
        note: feeNote || "Shorten stay fee",
        revenue_category: "extra_charge",
        fee_template_code: "SHORTEN_FEE",
        is_record_only: false,
        cashier_name: "FO",
        paid_date: businessDate,
        paid_at: nowIso,
      });
    }
    if (refundDue > 0) {
      settlementRows.push({
        reservation_id: reservationId,
        tx_type: "refund",
        method: refundMethod,
        amount: refundDue,
        note: refundNote || `Refund (Shorten) — ${refundMethod}`,
        revenue_category: "room_revenue",
        is_record_only: false,
        cashier_name: "FO",
        paid_date: businessDate,
        paid_at: nowIso,
      });
    }

    if (settlementRows.length > 0) {
      const { error: settlementError } = await supabase.from("folio_payments").insert(settlementRows);
      if (settlementError) {
        return NextResponse.json({ error: settlementError.message }, { status: 500 });
      }
    }

    const cancelTimestamp = new Date().toISOString();
    const { error: cancelNightsError } = await supabase
      .from("reservation_nights")
      .update({ cancelled_at: cancelTimestamp })
      .eq("reservation_id", reservationId)
      .is("cancelled_at", null)
      .gte("stay_date", newCheckoutDate)
      .lt("stay_date", oldCheckoutDate);
    if (cancelNightsError) {
      return NextResponse.json(
        {
          error: cancelNightsError.message,
          settlement_recorded: settlementRows.length > 0,
          warning: settlementRows.length > 0
            ? "Settlement rows were recorded, but shorten action failed while cancelling nights. Retry shorten without charging again."
            : null,
        },
        { status: 500 }
      );
    }

    const optionalPatch: Record<string, unknown> = {};
    if (typeof updatePayload.guest_name === "string" && updatePayload.guest_name.trim()) {
      optionalPatch.guest_name = updatePayload.guest_name.trim();
    }
    if (Object.prototype.hasOwnProperty.call(updatePayload, "phone")) {
      optionalPatch.phone = typeof updatePayload.phone === "string" && updatePayload.phone.trim()
        ? updatePayload.phone.trim()
        : null;
    }
    if (Object.prototype.hasOwnProperty.call(updatePayload, "note")) {
      optionalPatch.note = typeof updatePayload.note === "string" && updatePayload.note.trim()
        ? updatePayload.note.trim()
        : null;
    }
    if (Object.prototype.hasOwnProperty.call(updatePayload, "specials")) {
      optionalPatch.specials = typeof updatePayload.specials === "string" && updatePayload.specials.trim()
        ? updatePayload.specials.trim()
        : null;
    }
    if (Object.prototype.hasOwnProperty.call(updatePayload, "expected_arrival_time")) {
      optionalPatch.expected_arrival_time = typeof updatePayload.expected_arrival_time === "string" && updatePayload.expected_arrival_time.trim()
        ? updatePayload.expected_arrival_time.trim()
        : null;
    }

    const { data: updatedReservation, error: updateReservationError } = await supabase
      .from("reservations")
      .update({
        ...optionalPatch,
        checkout_date: newCheckoutDate,
        total_price: projectedNewTotal,
      })
      .eq("id", reservationId)
      .select("id, booking_code, guest_name, source, checkin_date, checkout_date, total_price")
      .maybeSingle();
    if (updateReservationError || !updatedReservation) {
      const { error: rollbackCancelError } = await supabase
        .from("reservation_nights")
        .update({ cancelled_at: null })
        .eq("reservation_id", reservationId)
        .eq("cancelled_at", cancelTimestamp);
      if (rollbackCancelError) {
        console.error("[shorten] Failed to rollback cancelled nights after reservation update failure:", rollbackCancelError);
      }
      return NextResponse.json(
        {
          error: updateReservationError?.message || "Failed to update reservation dates after settlement.",
          settlement_recorded: settlementRows.length > 0,
          warning: settlementRows.length > 0
            ? "Settlement rows were recorded, but shorten action failed after cancelling nights. Retry shorten without charging again."
            : null,
        },
        { status: 500 }
      );
    }

    const removedDates = (nights ?? [])
      .map((night: any) => String(night?.stay_date ?? ""))
      .filter((stayDate) => stayDate >= newCheckoutDate && stayDate < oldCheckoutDate);
    const removedTotal = normalizeAmount(
      (nights ?? [])
        .filter((night: any) => String(night?.stay_date ?? "") >= newCheckoutDate && String(night?.stay_date ?? "") < oldCheckoutDate)
        .reduce((sum: number, night: any) => sum + Number(night?.nightly_price ?? 0), 0)
    );
    try {
      await appendReservationNoteLine(
        supabase as any,
        reservationId,
        `[SHORTEN ${businessDate}] ${checkinDate}→${oldCheckoutDate} => ${checkinDate}→${newCheckoutDate} | -${removedDates.length} nights | -฿${removedTotal.toLocaleString("th-TH", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
      );
      await supabase.from("audit_logs").insert({
        action: "reservation_shortened",
        entity_type: "reservation",
        entity_id: reservationId,
        before_json: {
          reservation_id: reservationId,
          checkin_date: checkinDate,
          checkout_date: oldCheckoutDate,
          total_price: normalizeAmount(Number(reservation.total_price ?? 0)),
        },
        after_json: {
          reservation_id: reservationId,
          checkin_date: checkinDate,
          checkout_date: newCheckoutDate,
          total_price: projectedNewTotal,
          cancelled_stay_dates: removedDates,
          settlement_rows: settlementRows.length,
        },
        change_reason: "shorten_stay",
      });
    } catch (auditError) {
      console.error("[shorten] Core shorten succeeded but audit/note write failed:", auditError);
    }

    return NextResponse.json({
      success: true,
      reservation: updatedReservation,
      settlement: {
        old_total: normalizeAmount(Number(reservation.total_price ?? 0)),
        new_total: projectedNewTotal,
        prepaid_net: prepaidNet,
        overpaid,
        fee_from_prepaid: feeFromPrepaid,
        fee_collected_now: feeCollectedNow,
        refund_due: refundDue,
        refund_method: refundDue > 0 ? refundMethod : null,
        suggested_refund_method: suggestedRefundMethod,
      },
    });
  } catch (error) {
    return NextResponse.json({ error: String(error) }, { status: 500 });
  }
}
