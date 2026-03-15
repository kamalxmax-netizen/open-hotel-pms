import { getNightAuditSettings } from "@/lib/night-audit";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

export const dynamic = "force-dynamic";
export const fetchCache = "force-no-store";

const paramsSchema = z.object({
  id: z.string().uuid(),
});

const markSchema = z.object({
  fee_amount: z.coerce.number().min(0).default(0),
  payment_method: z.enum(["cash", "transfer", "credit_card"]).default("cash"),
});

export async function POST(request: NextRequest, context: { params: { id: string } }) {
  try {
    const params = paramsSchema.safeParse(context.params);
    if (!params.success) {
      return NextResponse.json(
        { success: false, error: "Invalid reservation id.", details: params.error.flatten() },
        { status: 400 }
      );
    }

    const json = await request.json().catch(() => null);
    const parsed = markSchema.safeParse(json ?? {});
    if (!parsed.success) {
      return NextResponse.json(
        { success: false, error: "Invalid payload.", details: parsed.error.flatten() },
        { status: 400 }
      );
    }

    const supabase = createServerSupabaseClient();
    const { businessDate } = await getNightAuditSettings(supabase);
    const reservationId = params.data.id;

    const { data: reservation, error: reservationError } = await supabase
      .from("reservations")
      .select("id, status, guest_name, checkin_date, checked_in_at")
      .eq("id", reservationId)
      .maybeSingle();

    if (reservationError) {
      return NextResponse.json({ success: false, error: reservationError.message }, { status: 500 });
    }
    if (!reservation) {
      return NextResponse.json({ success: false, error: "Reservation not found." }, { status: 404 });
    }
    if (reservation.status !== "active") {
      return NextResponse.json({ success: false, error: "Reservation is not active." }, { status: 400 });
    }
    if (reservation.checked_in_at) {
      return NextResponse.json(
        { success: false, error: "Reservation was already checked in." },
        { status: 400 }
      );
    }
    if (String(reservation.checkin_date) > businessDate) {
      return NextResponse.json(
        { success: false, error: "Check-in date has not passed yet." },
        { status: 400 }
      );
    }

    const feeAmount = Math.round((Number(parsed.data.fee_amount) || 0) * 100) / 100;

    const now = new Date().toISOString();

    const { error: updateReservationError } = await supabase
      .from("reservations")
      .update({ status: "no_show" })
      .eq("id", reservationId);

    if (updateReservationError) {
      return NextResponse.json({ success: false, error: updateReservationError.message }, { status: 500 });
    }

    const { error: cancelNightsError } = await supabase
      .from("reservation_nights")
      .update({ cancelled_at: now })
      .eq("reservation_id", reservationId)
      .is("cancelled_at", null);

    if (cancelNightsError) {
      return NextResponse.json({ success: false, error: cancelNightsError.message }, { status: 500 });
    }

    if (feeAmount > 0) {
      const { error: paymentError } = await supabase.from("folio_payments").insert({
        reservation_id: reservationId,
        tx_type: "payment",
        method: parsed.data.payment_method,
        amount: feeAmount,
        revenue_category: "room_revenue",
        cashier_name: "System",
        note: "No-show charge",
        paid_date: businessDate,
        paid_at: now,
      });

      if (paymentError) {
        return NextResponse.json({ success: false, error: paymentError.message }, { status: 500 });
      }
    }

    const { error: auditError } = await supabase.from("audit_logs").insert({
      action: "no_show",
      entity_type: "reservation",
      entity_id: reservationId,
      after_json: {
        guest_name: reservation.guest_name,
        checkin_date: reservation.checkin_date,
        fee_charged: feeAmount > 0,
        fee_amount: feeAmount,
        payment_method: feeAmount > 0 ? parsed.data.payment_method : null,
        marked_at: now,
      },
    });

    if (auditError) {
      return NextResponse.json({ success: false, error: auditError.message }, { status: 500 });
    }

    return NextResponse.json({
      success: true,
      message: "Marked as no-show.",
      fee_charged: feeAmount > 0,
      fee_amount: feeAmount,
    });
  } catch (err) {
    console.error("night-audit/no-shows/[id]/mark POST failed", err);
    const message = err instanceof Error ? err.message : "Internal server error";
    return NextResponse.json({ success: false, error: message }, { status: 500 });
  }
}
