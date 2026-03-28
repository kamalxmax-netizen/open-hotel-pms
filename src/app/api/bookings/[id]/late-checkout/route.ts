import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import {
  assertBusinessDayOpen,
  fetchExtraFeeTemplate,
  insertExtraFeePayment,
  normalizeOperatorPaymentMethod,
  toLocalDate,
} from "@/lib/folio-fees";
import { appendReservationNoteLine } from "@/lib/planned-room-moves";
import { formatMoney, toSatang, fromSatang } from "@/lib/money";

const payloadSchema = z.object({
  amount: z.coerce.number().positive(),
  payment_method: z.string().min(1),
  note: z.string().optional().nullable(),
});

function getBangkokTimeHHmm(date = new Date()): string {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Asia/Bangkok",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).formatToParts(date);
  const hour = parts.find((p) => p.type === "hour")?.value ?? "00";
  const minute = parts.find((p) => p.type === "minute")?.value ?? "00";
  return `${hour}:${minute}`;
}

export async function POST(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const reservationId = params.id;
    if (!reservationId) {
      return NextResponse.json({ success: false, error: "Missing reservation id." }, { status: 400 });
    }

    const json = await request.json().catch(() => null);
    const parsed = payloadSchema.safeParse(json);
    if (!parsed.success) {
      return NextResponse.json({ success: false, error: "Invalid payload." }, { status: 400 });
    }

    const supabase = createServerSupabaseClient();
    const method = normalizeOperatorPaymentMethod(parsed.data.payment_method);
    if (!method) {
      return NextResponse.json({ success: false, error: "Invalid payment_method." }, { status: 400 });
    }
    const amount = fromSatang(toSatang(parsed.data.amount));
    const rawNote = (parsed.data.note ?? "").trim();

    const { data: reservation, error: reservationError } = await supabase
      .from("reservations")
      .select("id, status, checkout_date")
      .eq("id", reservationId)
      .maybeSingle();
    if (reservationError) {
      return NextResponse.json({ success: false, error: reservationError.message }, { status: 500 });
    }
    if (!reservation) {
      return NextResponse.json({ success: false, error: "Reservation not found." }, { status: 404 });
    }
    if (reservation.status !== "active") {
      return NextResponse.json({ success: false, error: "Late C/O can be applied to active reservations only." }, { status: 409 });
    }

    const { data: settings } = await supabase
      .from("hotel_settings")
      .select("business_date")
      .eq("id", 1)
      .maybeSingle();
    const businessDate = String(settings?.business_date ?? toLocalDate(new Date()));
    if (businessDate !== String(reservation.checkout_date)) {
      return NextResponse.json(
        { success: false, error: "Late C/O pre-approve is allowed on Due Out day only." },
        { status: 409 }
      );
    }

    try {
      await assertBusinessDayOpen(supabase, businessDate);
    } catch (guardError) {
      const message = guardError instanceof Error ? guardError.message : "Business day already closed.";
      return NextResponse.json({ success: false, error: message }, { status: 409 });
    }

    const template = await fetchExtraFeeTemplate(supabase as any, "LATE_CHECKOUT_FEE");
    if (!template || !template.is_active) {
      return NextResponse.json({ success: false, error: "LATE_CHECKOUT_FEE template is not available." }, { status: 409 });
    }

    const { data: existingLateRows, error: existingError } = await supabase
      .from("folio_payments")
      .select("tx_type, amount, revenue_category, fee_template_code, is_record_only")
      .eq("reservation_id", reservationId)
      .eq("fee_template_code", "LATE_CHECKOUT_FEE")
      .eq("revenue_category", "extra_charge");
    if (existingError) {
      return NextResponse.json({ success: false, error: existingError.message }, { status: 500 });
    }
    const lateFeeNetSatang = (existingLateRows ?? []).reduce((sum, row: any) => {
      if (row?.is_record_only === true) return sum;
      const rowSatang = toSatang(row?.amount ?? 0);
      return String(row?.tx_type ?? "") === "refund" ? sum - rowSatang : sum + rowSatang;
    }, 0);
    if (lateFeeNetSatang > 0) {
      return NextResponse.json(
        { success: false, error: "Late C/O fee already posted for this reservation." },
        { status: 409 }
      );
    }

    const now = new Date();
    const hhmm = getBangkokTimeHHmm(now);
    const noteParts = [
      "Late C/O pre-approved",
      `฿${formatMoney(amount)}`,
      `via ${method}`,
      `at ${businessDate} ${hhmm}`,
      rawNote ? rawNote : null,
    ].filter(Boolean);
    const paymentNote = noteParts.join(" | ");

    const payment = await insertExtraFeePayment(supabase as any, {
      reservationId,
      feeTemplateCode: "LATE_CHECKOUT_FEE",
      amount,
      method,
      note: paymentNote,
      paidDate: businessDate,
      paidAt: now.toISOString(),
      cashierName: "FO",
    });

    let noteAppended = false;
    try {
      await appendReservationNoteLine(supabase as any, reservationId, paymentNote);
      noteAppended = true;
    } catch {
      noteAppended = false;
    }

    return NextResponse.json({
      success: true,
      payment,
      note_appended: noteAppended,
      late_checkout_fee_total: amount,
    });
  } catch (error) {
    return NextResponse.json({ success: false, error: String(error) }, { status: 500 });
  }
}

