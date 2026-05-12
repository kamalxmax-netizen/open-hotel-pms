import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { getAuthenticatedUser } from "@/lib/server-auth";
import { computeCheckoutNetPaidSatang, computeExtraChargeNetSatang } from "@/lib/checkout-balance";
import { computeReservationDiscountAmount } from "@/lib/reservation-visible-total";
import { fromSatang, toSatang } from "@/lib/money";
import { createScbPaymentRequest } from "@/lib/scb/requests";
import { serializeScbRequest } from "@/lib/scb/presenters";
import { getActivePendingRequestForTarget } from "@/lib/scb/matching";

export const dynamic = "force-dynamic";

const bodySchema = z.object({
  mode: z.enum(["outstanding", "custom"]),
  channel: z.enum(["booking_folio", "mobile_checkin"]).default("booking_folio"),
  room_amount: z.coerce.number().min(0).optional(),
  deposit_amount: z.coerce.number().min(0).optional(),
  expires_minutes: z.coerce.number().int().min(1).max(240).optional(),
});

async function resolveReservationOutstanding(supabase: ReturnType<typeof createServerSupabaseClient>, reservationId: string): Promise<number> {
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

export async function POST(request: NextRequest, { params }: { params: { id: string } }) {
  try {
    const supabase = createServerSupabaseClient();
    const user = await getAuthenticatedUser(supabase, request);
    if (!user) {
      return NextResponse.json({ success: false, error: "Unauthorized" }, { status: 401 });
    }

    const parsed = bodySchema.safeParse(await request.json().catch(() => null));
    if (!parsed.success) {
      return NextResponse.json({ success: false, error: "Invalid payload.", details: parsed.error.flatten() }, { status: 400 });
    }

    if (parsed.data.channel === "mobile_checkin") {
      return NextResponse.json(
        { success: false, error: "SCB QR is disabled for Mobile Check-in." },
        { status: 410 }
      );
    }

    const reservationId = params.id;
    const { data: reservation, error: reservationError } = await supabase
      .from("reservations")
      .select("id, booking_code, guest_name, status")
      .eq("id", reservationId)
      .maybeSingle();

    if (reservationError) return NextResponse.json({ success: false, error: reservationError.message }, { status: 500 });
    if (!reservation) return NextResponse.json({ success: false, error: "Reservation not found." }, { status: 404 });

    const outstandingAmount = await resolveReservationOutstanding(supabase, reservationId);
    const roomAmount = parsed.data.mode === "outstanding"
      ? outstandingAmount
      : Number(parsed.data.room_amount ?? 0);
    const depositAmount = parsed.data.mode === "outstanding"
      ? 0
      : Number(parsed.data.deposit_amount ?? 0);

    if (roomAmount + depositAmount <= 0) {
      return NextResponse.json({ success: false, error: "SCB QR amount must be greater than 0." }, { status: 400 });
    }

    const existingPending = await getActivePendingRequestForTarget(supabase as any, "reservation", reservationId);
    if (existingPending?.id) {
      const serializedExisting = serializeScbRequest(existingPending as any);
      return NextResponse.json({
        success: false,
        error: "Pending SCB QR already exists for this target.",
        existing_request_id: existingPending.id,
        existing_request: serializedExisting,
      }, { status: 409 });
    }

    const created = await createScbPaymentRequest(supabase as any, {
      targetType: "reservation",
      targetId: reservationId,
      channel: parsed.data.channel,
      mode: parsed.data.mode,
      roomAmount,
      depositAmount,
      expiresMinutes: parsed.data.expires_minutes,
      createdBy: user.id,
      partnerMetaData: {
        bookingCode: reservation.booking_code,
        guestName: reservation.guest_name,
        reservationStatus: reservation.status,
      },
    });

    const serialized = serializeScbRequest(created as any);
    return NextResponse.json({
      success: true,
      request: serialized,
      data: serialized,
      computed: {
        outstanding_amount: outstandingAmount,
        room_amount: roomAmount,
        deposit_amount: depositAmount,
      },
    }, { status: 201 });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Internal server error";
    return NextResponse.json({ success: false, error: message }, { status: 500 });
  }
}
