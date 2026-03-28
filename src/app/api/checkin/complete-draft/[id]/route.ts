import {
  applyCheckinFinancials,
  fetchProfileCompleteness,
  getBusinessDate,
  insertCheckinAudit,
  mapCheckinPaymentMethod,
  MobileAccompanyingInput,
  MobileCheckinError,
  MobileGuestInfoInput,
  requireMobileCheckinAuth,
  resolvePrimaryGuestProfile,
  syncAccompanyingGuests,
  toBangkokTimeHHmm,
} from "@/lib/mobile-checkin";
import { linkPrimaryGuestToReservation, ReservationPartyError } from "@/lib/reservation-party";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

export const dynamic = "force-dynamic";
export const fetchCache = "force-no-store";

const guestInfoSchema = z.object({
  full_name: z.string().default(""),
  passport_no: z.string().optional().nullable(),
  nationality: z.string().optional().nullable(),
  date_of_birth: z.string().optional().nullable(),
  gender: z.string().optional().nullable(),
});

const accompanyingSchema = z.object({
  full_name: z.string().default(""),
  passport_no: z.string().optional().nullable(),
  nationality: z.string().optional().nullable(),
  date_of_birth: z.string().optional().nullable(),
  gender: z.string().optional().nullable(),
  source: z.enum(["ocr", "manual"]).optional().nullable(),
});

const bodySchema = z.object({
  guest_info: guestInfoSchema,
  accompanying_guests: z.array(accompanyingSchema).optional().default([]),
  payment_method: z.string().optional(),
  payment_amount: z.number().optional(),
  deposit_amount: z.number().optional(),
  cashier_name: z.string().optional(),
});

export async function POST(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const supabase = createServerSupabaseClient();
    const auth = await requireMobileCheckinAuth(supabase, request);

    const reservationId = String(params.id ?? "").trim();
    if (!reservationId) {
      throw new MobileCheckinError("Missing reservation id.", 400, "MISSING_RESERVATION_ID");
    }

    const parsed = bodySchema.safeParse(await request.json().catch(() => ({})));
    if (!parsed.success) {
      throw new MobileCheckinError("Invalid payload.", 400, "INVALID_PAYLOAD");
    }

    const payload = parsed.data;
    const businessDate = await getBusinessDate(supabase);

    const { data: reservation, error: reservationError } = await supabase
      .from("reservations")
      .select("id, guest_name, guest_profile_id, status, checked_in_at")
      .eq("id", reservationId)
      .maybeSingle();

    if (reservationError) {
      throw new MobileCheckinError(reservationError.message, 500, "RESERVATION_READ_FAILED");
    }
    if (!reservation) {
      throw new MobileCheckinError("Reservation not found.", 404, "RESERVATION_NOT_FOUND");
    }

    if (String(reservation.status ?? "") !== "active") {
      throw new MobileCheckinError("Reservation is not eligible.", 409, "RESERVATION_STATUS_BLOCKED");
    }
    if (reservation.checked_in_at) {
      throw new MobileCheckinError("Reservation is already checked in.", 409, "ALREADY_CHECKED_IN");
    }

    const reservationGuestName = String(reservation.guest_name ?? "").trim();
    const guestInfoInput = payload.guest_info as MobileGuestInfoInput;
    const effectiveName = guestInfoInput.full_name || reservationGuestName || "Unknown Guest";

    const resolvedPrimary = await resolvePrimaryGuestProfile({
      supabase,
      reservationId,
      existingGuestProfileId: reservation.guest_profile_id ? String(reservation.guest_profile_id) : null,
      guestInfo: {
        ...guestInfoInput,
        full_name: effectiveName,
      },
      passportRaw: null,
    });

    await linkPrimaryGuestToReservation(supabase as any, reservationId, resolvedPrimary.guestProfileId);

    const accompanying = (payload.accompanying_guests ?? []).slice(0, 3) as MobileAccompanyingInput[];
    await syncAccompanyingGuests({
      supabase,
      reservationId,
      primaryGuestProfileId: resolvedPrimary.guestProfileId,
      accompanyingGuests: accompanying,
    });

    const completeness = await fetchProfileCompleteness(supabase, resolvedPrimary.guestProfileId);
    const canComplete = completeness.is_complete;

    const checkinNow = new Date();
    const checkedInAt = canComplete ? checkinNow.toISOString() : null;
    const checkinTime = canComplete ? toBangkokTimeHHmm(checkinNow) : null;

    const { error: reservationUpdateError } = await supabase
      .from("reservations")
      .update({
        status: "active",
        checked_in_at: checkedInAt,
        checkin_time: checkinTime,
        guest_name: effectiveName,
        guest_profile_id: resolvedPrimary.guestProfileId,
      })
      .eq("id", reservationId);

    if (reservationUpdateError) {
      throw new MobileCheckinError(reservationUpdateError.message, 500, "RESERVATION_UPDATE_FAILED");
    }

    const paymentMethod = mapCheckinPaymentMethod(payload.payment_method);
    const paymentAmount = Number(payload.payment_amount ?? 0);
    const depositAmount = Number(payload.deposit_amount ?? 0);
    if ((Number.isFinite(paymentAmount) && paymentAmount > 0) || (Number.isFinite(depositAmount) && depositAmount > 0)) {
      await applyCheckinFinancials({
        supabase,
        reservationId,
        method: paymentMethod,
        paymentAmount,
        depositAmount,
        cashierName: payload.cashier_name,
        businessDate,
      });
    }

    await insertCheckinAudit({
      supabase,
      actorUserId: auth.userId,
      reservationId,
      action: canComplete ? "checked_in" : "draft_checkin",
      businessDate,
      beforeJson: {
        status: "active",
        checked_in_at: null,
      },
      afterJson: {
        status: "active",
        checked_in_at: checkedInAt,
        checkin_time: checkinTime,
        is_draft: !canComplete,
        missing_fields: completeness.missing_fields,
      },
      note: canComplete
        ? "Draft check-in completed from mobile flow."
        : "Draft check-in updated but still incomplete.",
    });

    return NextResponse.json({
      success: true,
      data: {
        reservation_id: reservationId,
        status: "active",
        is_draft: !canComplete,
        profile_complete: completeness.is_complete,
        missing_fields: completeness.missing_fields,
      },
    });
  } catch (error) {
    if (error instanceof MobileCheckinError) {
      return NextResponse.json(
        {
          success: false,
          error: error.message,
          code: error.code,
        },
        { status: error.status }
      );
    }

    if (error instanceof ReservationPartyError) {
      return NextResponse.json(
        {
          success: false,
          error: error.message,
          ...(error.details ?? {}),
        },
        { status: error.status }
      );
    }

    const message = error instanceof Error ? error.message : "Internal server error";
    return NextResponse.json({ success: false, error: message }, { status: 500 });
  }
}
