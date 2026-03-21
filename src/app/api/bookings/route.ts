import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { mapBookingErrorToStatus, normalizeMoney, sumMoney } from "@/lib/bookings";
import { syncBookingGroupStatusById } from "@/lib/booking-group-status";
import { normalizeAuditSource, toBangkokDateString } from "@/lib/audit-utils";
import { isValidDateString, listNights } from "@/lib/dates";
import {
  applyNightlyRatesToReservation,
  calculateAppliedRateNights,
  RatePlanPricingError
} from "@/lib/rate-plan-pricing";
import { assertRatePlanEligibleForGuest } from "@/lib/rate-plan-eligibility";
import {
  assertGuestProfileLinkable,
  linkPrimaryGuestToReservation,
  ReservationPartyError,
} from "@/lib/reservation-party";
import {
  assertRoomAvailableForDateRange,
  PlannedRoomMoveError,
  syncReservationNightDependencyMetadata,
} from "@/lib/planned-room-moves";
import { assertRoomTypeCapacityForDateRange } from "@/lib/room-type-capacity";
import { getAuthenticatedUser } from "@/lib/server-auth";
import { createServerSupabaseClient } from "@/lib/supabase/server";

function isLegacyCreateRpcMismatch(message?: string | null): boolean {
  if (!message) return false;
  return message.includes("Could not find the function public.booking_create_reservation");
}

async function resolveRoomNumberById(supabase: any, roomId?: string | null): Promise<string | null> {
  if (!roomId) return null;

  const { data, error } = await supabase
    .from("rooms")
    .select("room_number")
    .eq("id", roomId)
    .maybeSingle();

  if (error) {
    throw new Error(`Unable to resolve room number from room_id: ${error.message}`);
  }
  if (!data?.room_number) {
    throw new Error("Selected room could not be resolved.");
  }

  return String(data.room_number);
}

async function resolveRoomTypeIdForPricing(
  supabase: any,
  roomTypeId?: string | number | null,
  roomId?: string | null
): Promise<number | null> {
  if (roomTypeId !== null && roomTypeId !== undefined) {
    const parsed = Number(roomTypeId);
    if (Number.isFinite(parsed) && parsed > 0) return parsed;
  }

  if (!roomId) return null;

  const { data, error } = await supabase
    .from("rooms")
    .select("room_type_id")
    .eq("id", roomId)
    .maybeSingle();
  if (error) {
    throw new Error(`Unable to resolve room type from room_id: ${error.message}`);
  }

  const resolved = Number(data?.room_type_id);
  if (Number.isFinite(resolved) && resolved > 0) return resolved;
  return null;
}

async function resolveAuditBusinessDate(supabase: any): Promise<string> {
  const { data, error } = await supabase
    .from("hotel_settings")
    .select("business_date")
    .eq("id", 1)
    .maybeSingle();

  if (!error && typeof data?.business_date === "string" && /^\d{4}-\d{2}-\d{2}$/.test(data.business_date)) {
    return data.business_date;
  }

  return toBangkokDateString();
}

const createBookingSchema = z.object({
  guest_name: z.string().min(1),
  room_id: z.string().uuid().optional().nullable(),
  room_type_id: z.string().optional().nullable(),
  checkin_date: z.string(),
  checkout_date: z.string(),
  source: z.enum(["walkin", "ota", "direct", "agent"]).default("walkin"),
  phone: z.string().optional(),
  checkin_time: z.string().optional(),
  note: z.string().optional(),
  ota_ref: z.string().optional(),
  ota_prices: z.array(z.number()).optional(),
  deposit_amount: z.number().min(0).optional(),
  deposit_note: z.string().optional(),
  discount_percent: z.number().min(0).max(100).optional(),
  discount_type: z.enum(["percent", "fixed_total", "fixed_per_night"]).optional(),
  discount_value: z.number().min(0).optional(),
  discount_reason: z.string().optional(),
  guest_profile_id: z.string().uuid().optional().nullable(),
  adults: z.number().min(1).optional(),
  children: z.number().min(0).optional(),
  specials: z.string().optional(),
  preferences: z.array(z.string()).optional(),
  rate_plan_id: z.string().uuid().optional().nullable(),
  booking_group_id: z.string().uuid().optional().nullable()
}).refine(data => data.room_id || data.room_type_id, {
  message: "Either room_id or room_type_id must be provided"
});

export async function GET(request: NextRequest) {
  const date = request.nextUrl.searchParams.get("date");
  const roomNumber = request.nextUrl.searchParams.get("room_number");

  if (!date || !roomNumber) {
    return NextResponse.json(
      { error: "Missing query params. Required: date, room_number" },
      { status: 400 }
    );
  }

  if (!isValidDateString(date)) {
    return NextResponse.json({ error: "Invalid date format. Use YYYY-MM-DD." }, { status: 400 });
  }

  const supabase = createServerSupabaseClient();

  const { data: room, error: roomError } = await supabase
    .from("rooms")
    .select("id, room_number, is_sellable, is_visible_on_board, closure_reason")
    .eq("room_number", roomNumber)
    .maybeSingle();

  if (roomError) {
    return NextResponse.json({ error: roomError.message }, { status: 500 });
  }
  if (!room) {
    return NextResponse.json({ error: "Room not found." }, { status: 404 });
  }

  const { data: bookingNight, error: bookingNightError } = await supabase
    .from("reservation_nights")
    .select("reservation_id, stay_date, nightly_price")
    .eq("room_id", room.id)
    .eq("stay_date", date)
    .is("cancelled_at", null)
    .maybeSingle();

  if (bookingNightError) {
    return NextResponse.json({ error: bookingNightError.message }, { status: 500 });
  }
  if (!bookingNight) {
    return NextResponse.json({ error: "No active booking found for this room/date." }, { status: 404 });
  }

  const { data: reservation, error: reservationError } = await supabase
    .from("reservations")
    .select(
      "id, booking_code, guest_name, phone, source, status, checkin_date, checkout_date, checkin_time, note, total_price"
    )
    .eq("id", bookingNight.reservation_id)
    .maybeSingle();

  if (reservationError) {
    return NextResponse.json({ error: reservationError.message }, { status: 500 });
  }
  if (!reservation) {
    return NextResponse.json({ error: "Reservation not found." }, { status: 404 });
  }

  const { data: nights, error: nightsError } = await supabase
    .from("reservation_nights")
    .select("stay_date, nightly_price")
    .eq("reservation_id", reservation.id)
    .is("cancelled_at", null)
    .order("stay_date", { ascending: true });

  if (nightsError) {
    return NextResponse.json({ error: nightsError.message }, { status: 500 });
  }

  const totalPrice =
    nights && nights.length > 0
      ? sumMoney(nights.map((item) => normalizeMoney(item.nightly_price)))
      : normalizeMoney(reservation.total_price);

  return NextResponse.json(
    {
      success: true,
      reservation: {
        ...reservation,
        room_number: room.room_number,
        nights: nights ?? [],
        total_nights: nights?.length ?? 0,
        total_price: totalPrice
      }
    },
    { status: 200 }
  );
}

export async function POST(request: NextRequest) {
  const json = await request.json().catch(() => null);
  const parsed = createBookingSchema.safeParse(json);

  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid payload", details: parsed.error.flatten() },
      { status: 400 }
    );
  }

  const payload = parsed.data;
  const normalizedRoomTypeText = typeof payload.room_type_id === "string" ? payload.room_type_id.trim() : "";
  if (normalizedRoomTypeText && !/^\d+$/u.test(normalizedRoomTypeText)) {
    return NextResponse.json({ error: "Invalid room_type_id format." }, { status: 400 });
  }
  const normalizedRoomTypeId = normalizedRoomTypeText ? parseInt(normalizedRoomTypeText, 10) : null;
  if (!payload.room_id && normalizedRoomTypeId === null) {
    return NextResponse.json({ error: "Either room_id or room_type_id must be provided." }, { status: 400 });
  }

  if (!isValidDateString(payload.checkin_date) || !isValidDateString(payload.checkout_date)) {
    return NextResponse.json({ error: "Invalid date format. Use YYYY-MM-DD." }, { status: 400 });
  }

  let nights: string[];
  try {
    nights = listNights(payload.checkin_date, payload.checkout_date);
  } catch (error) {
    return NextResponse.json({ error: (error as Error).message }, { status: 400 });
  }

  if (payload.source === "ota" && (!payload.ota_prices || payload.ota_prices.length !== nights.length)) {
    return NextResponse.json(
      { error: "OTA bookings require ota_prices with exact nights length." },
      { status: 400 }
    );
  }

  const supabase = createServerSupabaseClient();

  if (payload.room_id) {
    try {
      await assertRoomAvailableForDateRange(supabase as any, {
        roomId: payload.room_id,
        checkinDate: payload.checkin_date,
        checkoutDate: payload.checkout_date,
      });
    } catch (error) {
      if (error instanceof PlannedRoomMoveError) {
        return NextResponse.json({ error: error.message }, { status: error.status });
      }
      return NextResponse.json({ error: (error as Error).message }, { status: 500 });
    }
  }

  let capacityRoomTypeId: number | null = normalizedRoomTypeId;
  if (payload.room_id) {
    try {
      capacityRoomTypeId = await resolveRoomTypeIdForPricing(
        supabase,
        null,
        payload.room_id
      );
    } catch (error) {
      return NextResponse.json({ error: (error as Error).message }, { status: 400 });
    }
  }

  if (capacityRoomTypeId !== null) {
    try {
      await assertRoomTypeCapacityForDateRange(supabase as any, {
        roomTypeId: capacityRoomTypeId,
        nights,
      });
    } catch (error) {
      if (error instanceof PlannedRoomMoveError) {
        return NextResponse.json({ error: error.message }, { status: error.status });
      }
      return NextResponse.json({ error: (error as Error).message }, { status: 500 });
    }
  }

  if (payload.guest_profile_id) {
    try {
      await assertGuestProfileLinkable(supabase, payload.guest_profile_id);
    } catch (error) {
      if (error instanceof ReservationPartyError) {
        return NextResponse.json({ error: error.message, ...(error.details ?? {}) }, { status: error.status });
      }
      return NextResponse.json({ error: (error as Error).message }, { status: 500 });
    }
  }

  const normalizedOtaPrices = payload.source === "ota"
    ? payload.ota_prices?.map((item) => normalizeMoney(item))
    : null;

  let pricedNights: Awaited<ReturnType<typeof calculateAppliedRateNights>> | null = null;
  if (payload.source !== "ota" && payload.rate_plan_id) {
    let pricingRoomTypeId: number | null = null;
    try {
      pricingRoomTypeId = await resolveRoomTypeIdForPricing(
        supabase,
        normalizedRoomTypeId,
        payload.room_id
      );
    } catch (error) {
      return NextResponse.json({ error: (error as Error).message }, { status: 400 });
    }

    if (!pricingRoomTypeId) {
      return NextResponse.json({ error: "Unable to resolve room type for rate plan pricing." }, { status: 400 });
    }

    try {
      await assertRatePlanEligibleForGuest({
        supabase,
        ratePlanId: payload.rate_plan_id,
        guestProfileId: payload.guest_profile_id ?? null,
        roomTypeId: pricingRoomTypeId,
        nights: nights.length,
        checkinDate: payload.checkin_date,
        checkoutDate: payload.checkout_date,
      });

      pricedNights = await calculateAppliedRateNights({
        supabase,
        roomTypeId: pricingRoomTypeId,
        checkinDate: payload.checkin_date,
        checkoutDate: payload.checkout_date,
        ratePlanId: payload.rate_plan_id
      });
    } catch (error) {
      if (error instanceof RatePlanPricingError) {
        return NextResponse.json({ error: error.message }, { status: error.status });
      }
      return NextResponse.json({ error: (error as Error).message }, { status: 500 });
    }
  }

  let { data: reservation, error } = await supabase.rpc("booking_create_reservation", {
    p_guest_name: payload.guest_name.trim(),
    p_room_id: payload.room_id || null,
    p_room_type_id: normalizedRoomTypeId,
    p_checkin_date: payload.checkin_date,
    p_checkout_date: payload.checkout_date,
    p_source: payload.source,
    p_phone: payload.phone?.trim() || null,
    p_checkin_time: payload.checkin_time?.trim() || null,
    p_note: payload.note?.trim() || null,
    p_ota_prices: normalizedOtaPrices
  });

  // Backward-compatibility: some environments still expose legacy RPC args with p_room_number.
  if (error && isLegacyCreateRpcMismatch(error.message)) {
    let roomNumber: string | null = null;
    try {
      roomNumber = await resolveRoomNumberById(supabase, payload.room_id);
    } catch (resolveError) {
      return NextResponse.json({ error: (resolveError as Error).message }, { status: 400 });
    }

    const fallback = await supabase.rpc("booking_create_reservation", {
      p_actor_user_id: null,
      p_checkin_date: payload.checkin_date,
      p_checkin_time: payload.checkin_time?.trim() || null,
      p_checkout_date: payload.checkout_date,
      p_guest_name: payload.guest_name.trim(),
      p_note: payload.note?.trim() || null,
      p_ota_prices: normalizedOtaPrices,
      p_phone: payload.phone?.trim() || null,
      p_room_number: roomNumber,
      p_room_type_id: normalizedRoomTypeId,
      p_source: payload.source
    });

    reservation = fallback.data;
    error = fallback.error;
  }

  if (error) {
    const status = mapBookingErrorToStatus(error.message);
    return NextResponse.json({ error: error.message }, { status });
  }
  if (!reservation) {
    return NextResponse.json({ error: "Create reservation failed." }, { status: 500 });
  }

  // Update additional CRM fields (adults, children, specials, guest_profile_id)
  let { error: reservationExtraError } = await supabase
    .from("reservations")
    .update({
      adults: payload.adults ?? 1,
      children: payload.children ?? 0,
      specials: payload.specials || null,
      discount_percent: payload.discount_percent ?? 0,
      discount_type: payload.discount_type ?? "percent",
      discount_value: payload.discount_value ?? payload.discount_percent ?? 0,
      discount_reason: payload.discount_reason?.trim() || null,
      rate_plan_id: payload.rate_plan_id || null,
      booking_group_id: payload.booking_group_id || null
    })
    .eq("id", reservation.id);
  if (reservationExtraError && /discount_type|discount_value/i.test(reservationExtraError.message)) {
    const fallbackExtra = await supabase
      .from("reservations")
      .update({
        adults: payload.adults ?? 1,
        children: payload.children ?? 0,
        specials: payload.specials || null,
        discount_percent: payload.discount_percent ?? 0,
        discount_reason: payload.discount_reason?.trim() || null,
        rate_plan_id: payload.rate_plan_id || null,
        booking_group_id: payload.booking_group_id || null
      })
      .eq("id", reservation.id);
    reservationExtraError = fallbackExtra.error;
  }
  if (reservationExtraError) {
    return NextResponse.json({ error: reservationExtraError.message }, { status: 500 });
  }

  if (payload.guest_profile_id) {
    try {
      await linkPrimaryGuestToReservation(supabase, reservation.id, payload.guest_profile_id);
    } catch (error) {
      if (error instanceof ReservationPartyError) {
        return NextResponse.json({ error: error.message, ...(error.details ?? {}) }, { status: error.status });
      }
      return NextResponse.json({ error: (error as Error).message }, { status: 500 });
    }
  }

  if (pricedNights) {
    try {
      await applyNightlyRatesToReservation({
        supabase,
        reservationId: reservation.id,
        nights: pricedNights.nights,
        totalApplied: pricedNights.totalApplied
      });
    } catch (error) {
      if (error instanceof RatePlanPricingError) {
        return NextResponse.json({ error: error.message }, { status: error.status });
      }
      return NextResponse.json({ error: (error as Error).message }, { status: 500 });
    }
  }

  // Best-effort: keep booking_groups.total_rooms aligned when creating from group flow.
  if (payload.booking_group_id) {
    const { data: groupRow, error: groupReadError } = await supabase
      .from("booking_groups")
      .select("id, total_rooms")
      .eq("id", payload.booking_group_id)
      .maybeSingle();

    if (!groupReadError && groupRow) {
      const nextTotalRooms = Number(groupRow.total_rooms ?? 0) + 1;
      const { error: groupUpdateError } = await supabase
        .from("booking_groups")
        .update({ total_rooms: nextTotalRooms })
        .eq("id", payload.booking_group_id);
      if (groupUpdateError) {
        console.error("Group total_rooms increment failed:", groupUpdateError.message);
      }
    } else if (groupReadError) {
      console.error("Group lookup failed:", groupReadError.message);
    }

    try {
      await syncBookingGroupStatusById(supabase, payload.booking_group_id);
    } catch (syncError) {
      console.error("Group status sync after reservation create failed:", syncError);
    }
  }

  // Insert preferences
  if (payload.preferences && payload.preferences.length > 0) {
    const prefInserts = payload.preferences.map(code => ({
      reservation_id: reservation.id,
      feature_code: code
    }));
    await supabase.from("reservation_preferences").insert(prefInserts);
  }

  await syncReservationNightDependencyMetadata(supabase as any, {
    reservationId: String(reservation.id),
  });

  try {
    const businessDate = await resolveAuditBusinessDate(supabase);
    const user = await getAuthenticatedUser(supabase, request);
    const reservationEntityId = String(reservation.id);
    const createdAtThreshold = new Date(Date.now() - 5 * 60 * 1000).toISOString();

    const { data: backfilledRows, error: backfillError } = await supabase
      .from("audit_logs")
      .update({
        business_date: businessDate,
        source: normalizeAuditSource("manual"),
        actor_user_id: user?.id ?? null,
      })
      .eq("entity_type", "reservation")
      .eq("entity_id", reservationEntityId)
      .is("business_date", null)
      .gte("created_at", createdAtThreshold)
      .select("id");

    if (backfillError) {
      console.error("booking create audit backfill failed", backfillError);
    }

    if (!backfillError && (backfilledRows?.length ?? 0) === 0) {
      const { error: insertAuditError } = await supabase.from("audit_logs").insert({
        actor_user_id: user?.id ?? null,
        action: "reservation_created",
        entity_type: "reservation",
        entity_id: reservationEntityId,
        before_json: null,
        after_json: {
          booking_code: (reservation as any)?.booking_code ?? null,
          guest_name: payload.guest_name.trim(),
          source: payload.source,
          checkin_date: payload.checkin_date,
          checkout_date: payload.checkout_date,
          room_id: payload.room_id || null,
          room_type_id: normalizedRoomTypeId,
          booking_group_id: payload.booking_group_id || null,
          rate_plan_id: payload.rate_plan_id || null,
        },
        business_date: businessDate,
        source: normalizeAuditSource("manual"),
      });

      if (insertAuditError) {
        console.error("booking create audit insert failed", insertAuditError);
      }
    }
  } catch (auditError) {
    console.error("booking create audit ensure failed", auditError);
  }

  return NextResponse.json(
    {
      success: true,
      reservation
    },
    { status: 201 }
  );
}
