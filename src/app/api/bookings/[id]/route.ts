import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { mapBookingErrorToStatus, normalizeMoney } from "@/lib/bookings";
import { isValidDateString, listNights } from "@/lib/dates";
import { syncDynamicRoomLinksForReservation } from "@/lib/logbook-api";
import { getAuthenticatedUser, getUserRole } from "@/lib/server-auth";
import {
  calculateAppliedRateNights,
  RatePlanPricingError
} from "@/lib/rate-plan-pricing";
import { assertRatePlanEligibleForGuest, resolveReservationGuestProfileId } from "@/lib/rate-plan-eligibility";
import {
  assertGuestProfileLinkable,
  linkPrimaryGuestToReservation,
  ReservationPartyError,
  unlinkPrimaryGuestFromReservation,
} from "@/lib/reservation-party";
import {
  assertRoomAvailableForDateRange,
  PlannedRoomMoveError,
  syncReservationNightDependencyMetadata,
  listReservationPlannedMoves,
  appendReservationNoteLine,
  floatPlanImpactAssignments,
  listPlanImpactAssignments,
  rebuildReservationFutureRoomPath,
} from "@/lib/planned-room-moves";
import { assertAssignedRoomUnlockedOrOverride, clearAssignedRoomLock, AssignedRoomLockError, getAssignedRoomLockContext } from "@/lib/assigned-room-lock";
import { assertRoomTypeCapacityForDateRange } from "@/lib/room-type-capacity";
import { resolveHotelCheckOutTime, resolveLinkedStay } from "@/lib/linked-stay";
import { normalizeExpectedArrivalTime, syncExpectedArrivalAlert } from "@/lib/expected-arrival-alert";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { unstable_noStore as noStore } from "next/cache";

export const dynamic = "force-dynamic";

function isLegacyUpdateRpcMismatch(message?: string | null): boolean {
  if (!message) return false;
  return message.includes("Could not find the function public.booking_update_reservation");
}

function isMissingColumnError(message?: string | null): boolean {
  if (!message) return false;
  return /checked_in_at|discount_type|discount_value|parent_reservation_id|expected_arrival_time/i.test(message);
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
  reservationId: string,
  roomTypeId?: string | number | null,
  roomId?: string | null
): Promise<number | null> {
  if (roomTypeId !== null && roomTypeId !== undefined) {
    const parsed = Number(roomTypeId);
    if (Number.isFinite(parsed) && parsed > 0) return parsed;
  }

  if (roomId) {
    const roomLookup = await supabase
      .from("rooms")
      .select("room_type_id")
      .eq("id", roomId)
      .maybeSingle();
    if (roomLookup.error) {
      throw new Error(`Unable to resolve room type from room_id: ${roomLookup.error.message}`);
    }
    const byRoomId = Number(roomLookup.data?.room_type_id);
    if (Number.isFinite(byRoomId) && byRoomId > 0) return byRoomId;
  }

  const nightLookup = await supabase
    .from("reservation_nights")
    .select("room_type_id, room_id")
    .eq("reservation_id", reservationId)
    .is("cancelled_at", null)
    .limit(1)
    .maybeSingle();
  if (nightLookup.error) {
    throw new Error(`Unable to resolve room type from reservation_nights: ${nightLookup.error.message}`);
  }

  const byNightType = Number(nightLookup.data?.room_type_id);
  if (Number.isFinite(byNightType) && byNightType > 0) return byNightType;

  const fallbackRoomId = nightLookup.data?.room_id ? String(nightLookup.data.room_id) : null;
  if (!fallbackRoomId) return null;

  const fallbackRoomLookup = await supabase
    .from("rooms")
    .select("room_type_id")
    .eq("id", fallbackRoomId)
    .maybeSingle();
  if (fallbackRoomLookup.error) {
    throw new Error(`Unable to resolve room type from fallback room_id: ${fallbackRoomLookup.error.message}`);
  }

  const fallbackType = Number(fallbackRoomLookup.data?.room_type_id);
  if (Number.isFinite(fallbackType) && fallbackType > 0) return fallbackType;
  return null;
}

async function resolveCurrentReservationRoomCode(
  supabase: any,
  reservationId: string
): Promise<string | null> {
  const today = toLocalDate(new Date());

  const { data: nightRow, error: nightError } = await supabase
    .from("reservation_nights")
    .select("room_id, stay_date")
    .eq("reservation_id", reservationId)
    .is("cancelled_at", null)
    .order("stay_date", { ascending: false })
    .limit(10);

  if (nightError) {
    throw new Error(`Unable to resolve current room from reservation_nights: ${nightError.message}`);
  }

  const rows = Array.isArray(nightRow) ? nightRow : [];
  const preferred =
    rows.find((row: any) => String(row?.stay_date ?? "") <= today && row?.room_id) ??
    rows.find((row: any) => Boolean(row?.room_id)) ??
    null;

  if (!preferred?.room_id) return null;
  return resolveRoomNumberById(supabase, String(preferred.room_id));
}

function parseJsonRecord(value: unknown): Record<string, any> {
  if (!value) return {};
  if (typeof value === "object") return value as Record<string, any>;
  if (typeof value === "string") {
    try {
      const parsed = JSON.parse(value);
      return parsed && typeof parsed === "object" ? parsed : {};
    } catch {
      return {};
    }
  }
  return {};
}

function toLocalDate(d: Date, tz = "Asia/Bangkok"): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: tz }).format(d);
}

function round2(value: number): number {
  return Number(value.toFixed(2));
}

type ReservationNightSnapshot = {
  stay_date: string;
  room_id: string | null;
  room_type_id: number | null;
  nightly_price: number;
};

const updateBookingSchema = z.object({
  guest_name: z.string().min(1),
  room_id: z.string().uuid().optional().nullable(),
  room_type_id: z.string().optional().nullable(),
  checkin_date: z.string(),
  checkout_date: z.string(),
  source: z.enum(["walkin", "ota", "direct", "agent"]).default("walkin"),
  phone: z.string().optional(),
  checkin_time: z.string().optional(),
  expected_arrival_time: z.string().optional().nullable(),
  note: z.string().optional(),
  ota_prices: z.array(z.number()).optional(),
  guest_profile_id: z.string().uuid().optional().nullable(),
  adults: z.number().min(1).optional(),
  children: z.number().min(0).optional(),
  specials: z.string().optional(),
  discount_percent: z.number().min(0).max(100).optional(),
  discount_type: z.enum(["percent", "fixed_total", "fixed_per_night"]).optional(),
  discount_value: z.number().min(0).optional(),
  discount_reason: z.string().optional(),
  preferences: z.array(z.string()).optional(),
  rate_plan_id: z.string().uuid().optional().nullable(),
  override_assigned_note: z.string().optional(),
  price_change_choice: z.enum(["keep_existing", "apply_rate_grid"]).optional().nullable(),
}).refine(data => data.room_id || data.room_type_id, {
  message: "Either room_id or room_type_id must be provided"
});

export async function GET(
  _request: Request,
  { params }: { params: { id: string } }
) {
  noStore();
  const reservationId = params.id;
  if (!reservationId) {
    return NextResponse.json({ error: "Missing reservation id." }, { status: 400 });
  }

  const supabase = createServerSupabaseClient();

  const baseSelect = `
    id,
    booking_code,
    guest_name,
    phone,
    source,
    status,
    checkin_date,
    checkout_date,
    checkin_time,
    expected_arrival_time,
    note,
    ota_ref,
    specials,
    total_price,
    deposit_amount,
    deposit_note,
    deposit_paid_at,
    discount_percent,
    discount_type,
    discount_value,
    discount_reason,
    do_not_move_assigned_room,
    do_not_move_reason,
    do_not_move_room_id_snapshot,
    do_not_move_set_at,
    do_not_move_set_by,
    guest_profile_id,
    rate_plan_id,
    booking_group_id,
    parent_reservation_id,
    reservation_nights(
      stay_date,
      nightly_price,
      room_id,
      room_type_id,
      cancelled_at
    )
  `;
  const legacyBaseSelect = `
    id,
    booking_code,
    guest_name,
    phone,
    source,
    status,
    checkin_date,
    checkout_date,
    checkin_time,
    note,
    ota_ref,
    specials,
    total_price,
    deposit_amount,
    deposit_note,
    deposit_paid_at,
    discount_percent,
    discount_reason,
    do_not_move_assigned_room,
    do_not_move_reason,
    do_not_move_room_id_snapshot,
    do_not_move_set_at,
    do_not_move_set_by,
    guest_profile_id,
    rate_plan_id,
    booking_group_id,
    parent_reservation_id,
    reservation_nights(
      stay_date,
      nightly_price,
      room_id,
      room_type_id,
      cancelled_at
    )
  `;
  const withCheckedInAtSelect = `
    id,
    booking_code,
    guest_name,
    phone,
    source,
    status,
    checkin_date,
    checkout_date,
    checkin_time,
    expected_arrival_time,
    note,
    ota_ref,
    specials,
    total_price,
    deposit_amount,
    deposit_note,
    deposit_paid_at,
    discount_percent,
    discount_type,
    discount_value,
    discount_reason,
    checked_in_at,
    do_not_move_assigned_room,
    do_not_move_reason,
    do_not_move_room_id_snapshot,
    do_not_move_set_at,
    do_not_move_set_by,
    guest_profile_id,
    rate_plan_id,
    booking_group_id,
    parent_reservation_id,
    reservation_nights(
      stay_date,
      nightly_price,
      room_id,
      room_type_id,
      cancelled_at
    )
  `;

  const withCheckedIn = await supabase
    .from("reservations")
    .select(withCheckedInAtSelect)
    .eq("id", reservationId)
    .maybeSingle();

  let row: any | null = null;
  if (withCheckedIn.error && isMissingColumnError(withCheckedIn.error.message)) {
    const fallback = await supabase
      .from("reservations")
      .select(legacyBaseSelect)
      .eq("id", reservationId)
      .maybeSingle();
    if (fallback.error) {
      return NextResponse.json({ error: fallback.error.message }, { status: 500 });
    }
    row = fallback.data ?? null;
  } else {
    if (withCheckedIn.error) {
      return NextResponse.json({ error: withCheckedIn.error.message }, { status: 500 });
    }
    row = withCheckedIn.data ?? null;
  }

  if (!row) {
    return NextResponse.json({ error: "Reservation not found." }, { status: 404 });
  }

  const checkOutTimeHHmm = await resolveHotelCheckOutTime(supabase);
  const linkedStay = await resolveLinkedStay(supabase, reservationId, checkOutTimeHHmm);

  const activeNights = Array.isArray(row.reservation_nights)
    ? row.reservation_nights
        .filter((n: any) => !n?.cancelled_at)
        .sort((a: any, b: any) => String(a.stay_date).localeCompare(String(b.stay_date)))
    : [];
  const today = toLocalDate(new Date());
  const activeNightsDesc = [...activeNights].sort((a: any, b: any) =>
    String(b?.stay_date ?? "").localeCompare(String(a?.stay_date ?? ""))
  );
  const nightsUpToToday = activeNightsDesc.filter((n: any) => String(n?.stay_date ?? "") <= today);
  const stayNight = nightsUpToToday[0] ?? activeNightsDesc[0] ?? null;
  const roomId = stayNight?.room_id ? String(stayNight.room_id) : null;
  const roomTypeId = stayNight?.room_type_id != null ? String(stayNight.room_type_id) : null;

  const { data: roomMoveLogs, error: roomMoveLogError } = await supabase
    .from("audit_logs")
    .select("created_at, before_json, after_json")
    .eq("entity_type", "reservation")
    .eq("entity_id", reservationId)
    .eq("action", "room_moved")
    .order("created_at", { ascending: true });

  if (roomMoveLogError) {
    return NextResponse.json({ error: roomMoveLogError.message }, { status: 500 });
  }

  const roomMoves = (roomMoveLogs ?? []).map((log: any) => {
    const before = parseJsonRecord(log.before_json);
    const after = parseJsonRecord(log.after_json);
    const createdAt = log.created_at ? String(log.created_at) : null;
    return {
      moved_at: createdAt,
      move_date: String(after.move_date ?? (createdAt ? createdAt.slice(0, 10) : "")),
      from_room_number: String(before.room_number ?? "unknown"),
      to_room_number: String(after.room_number ?? "unknown"),
      reason: typeof after.reason === "string" ? after.reason : ""
    };
  });
  const doNotMoveRoomIdSnapshot = row.do_not_move_room_id_snapshot ? String(row.do_not_move_room_id_snapshot) : null;
  let doNotMoveRoomNumberSnapshot: string | null = null;
  if (doNotMoveRoomIdSnapshot) {
    try {
      doNotMoveRoomNumberSnapshot = await resolveRoomNumberById(supabase, doNotMoveRoomIdSnapshot);
    } catch {
      doNotMoveRoomNumberSnapshot = null;
    }
  }

  return NextResponse.json({
    success: true,
    reservation: {
      id: row.id,
      booking_code: row.booking_code,
      guest_name: row.guest_name,
      phone: row.phone,
      source: row.source,
      status: row.status,
      checkin_date: row.checkin_date,
      checkout_date: row.checkout_date,
      checkin_time: row.checkin_time,
      expected_arrival_time: row.expected_arrival_time ?? null,
      checked_in_at: row.checked_in_at ?? null,
      note: row.note,
      ota_ref: row.ota_ref,
      specials: row.specials,
      total_price: Number(row.total_price ?? 0),
      deposit_amount: Number(row.deposit_amount ?? 0),
      deposit_note: row.deposit_note ?? null,
      deposit_paid_at: row.deposit_paid_at ?? null,
      discount_type:
        row.discount_type === "fixed_total" || row.discount_type === "fixed_per_night" || row.discount_type === "percent"
          ? row.discount_type
          : "percent",
      discount_value: Number(row.discount_value ?? row.discount_percent ?? 0),
      do_not_move_assigned_room: Boolean(row.do_not_move_assigned_room),
      do_not_move_reason: row.do_not_move_reason ?? null,
      do_not_move_room_id_snapshot: doNotMoveRoomIdSnapshot,
      do_not_move_room_number_snapshot: doNotMoveRoomNumberSnapshot,
      do_not_move_set_at: row.do_not_move_set_at ?? null,
      do_not_move_set_by: row.do_not_move_set_by ?? null,
      discount_percent: Number(row.discount_percent ?? 0),
      discount_reason: row.discount_reason,
      guest_profile_id: row.guest_profile_id ?? null,
      rate_plan_id: row.rate_plan_id ?? null,
      booking_group_id: row.booking_group_id ?? null,
      parent_reservation_id: row.parent_reservation_id ?? null,
      room_id: roomId,
      room_type_id: roomTypeId,
      total_nights: activeNights.length,
      nights: activeNights.map((n: any) => ({
        stay_date: n.stay_date,
        nightly_price: Number(n.nightly_price ?? 0),
        room_id: n.room_id ?? null,
        room_type_id: n.room_type_id ?? null
      })),
      room_moves: roomMoves
    },
    linked_stay: linkedStay
  });
}

export async function PUT(
  request: Request,
  { params }: { params: { id: string } }
) {
  const reservationId = params.id;
  if (!reservationId) {
    return NextResponse.json({ error: "Missing reservation id." }, { status: 400 });
  }

  const json = await request.json().catch(() => null);
  const parsed = updateBookingSchema.safeParse(json);

  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid payload", details: parsed.error.flatten() },
      { status: 400 }
    );
  }

  const payload = parsed.data;
  const responseWarnings: string[] = [];
  const hasSpecialsField = Object.prototype.hasOwnProperty.call(json ?? {}, "specials");
  const hasExpectedArrivalField = Object.prototype.hasOwnProperty.call(json ?? {}, "expected_arrival_time");
  const normalizedSpecials = hasSpecialsField
    ? (typeof payload.specials === "string" ? payload.specials.trim() : "")
    : null;
  let normalizedExpectedArrivalTime: string | null = null;
  if (hasExpectedArrivalField) {
    try {
      normalizedExpectedArrivalTime = normalizeExpectedArrivalTime(payload.expected_arrival_time);
    } catch (error) {
      return NextResponse.json({ error: (error as Error).message }, { status: 400 });
    }
  }
  const explicitRoomUnassignRequested =
    Object.prototype.hasOwnProperty.call(json ?? {}, "room_id") &&
    payload.room_id === null;
  const normalizedRoomTypeText = typeof payload.room_type_id === "string" ? payload.room_type_id.trim() : "";
  if (normalizedRoomTypeText && !/^\d+$/u.test(normalizedRoomTypeText)) {
    return NextResponse.json({ error: "Invalid room_type_id format." }, { status: 400 });
  }
  const normalizedRoomTypeId = normalizedRoomTypeText ? parseInt(normalizedRoomTypeText, 10) : null;
  const shouldForceFloatingRoomType = payload.room_id === null && normalizedRoomTypeId !== null;

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
  const { data: currentReservation, error: currentReservationError } = await supabase
    .from("reservations")
    .select("id, checkin_date, checkout_date, source, expected_arrival_time, rate_plan_id, total_price")
    .eq("id", reservationId)
    .maybeSingle();
  if (currentReservationError) {
    return NextResponse.json({ error: currentReservationError.message }, { status: 500 });
  }
  if (!currentReservation) {
    return NextResponse.json({ error: "Reservation not found." }, { status: 404 });
  }
  const previousCheckoutDate = currentReservation.checkout_date
    ? String(currentReservation.checkout_date)
    : null;
  const checkoutDateChanged = Boolean(previousCheckoutDate && previousCheckoutDate !== payload.checkout_date);
  const { data: currentNights, error: currentNightsError } = await supabase
    .from("reservation_nights")
    .select("stay_date, room_id, room_type_id, nightly_price")
    .eq("reservation_id", reservationId)
    .is("cancelled_at", null)
    .order("stay_date", { ascending: false });
  if (currentNightsError) {
    return NextResponse.json({ error: currentNightsError.message }, { status: 500 });
  }
  const normalizedNightSnapshots: ReservationNightSnapshot[] = (currentNights ?? []).map((row: any) => ({
    stay_date: String(row?.stay_date ?? ""),
    room_id: row?.room_id ? String(row.room_id) : null,
    room_type_id: row?.room_type_id != null ? Number(row.room_type_id) : null,
    nightly_price: round2(Number(row?.nightly_price ?? 0)),
  })).filter((row) => row.stay_date);
  const incomingRoomId = payload.room_id ? String(payload.room_id) : null;
  const incomingRoomTypeId = normalizedRoomTypeId;
  const unchangedDateScope =
    String(currentReservation.checkin_date ?? "") === payload.checkin_date &&
    String(currentReservation.checkout_date ?? "") === payload.checkout_date;
  const unchangedSource = String(currentReservation.source ?? "") === payload.source;
  const unchangedAssignment =
    normalizedNightSnapshots.length > 0 &&
    normalizedNightSnapshots.every((night) => {
      if (incomingRoomId !== null) {
        return (
          String(night.room_id ?? "") === incomingRoomId &&
          (incomingRoomTypeId === null || Number(night.room_type_id ?? 0) === incomingRoomTypeId)
        );
      }
      return (
        night.room_id === null &&
        incomingRoomTypeId !== null &&
        Number(night.room_type_id ?? 0) === incomingRoomTypeId
      );
    });
  const shouldForceNightRebuild = payload.source === "ota";
  const skipNightRebuild = !shouldForceNightRebuild && unchangedDateScope && unchangedSource && unchangedAssignment;
  const previousNightlyByDate = new Map(
    normalizedNightSnapshots.map((night) => [night.stay_date, night.nightly_price] as const)
  );
  const previousStayDateSet = new Set(Array.from(previousNightlyByDate.keys()));
  const overlappingStayDates = nights.filter((stayDate) => previousStayDateSet.has(stayDate));
  const addedStayDates = nights.filter((stayDate) => !previousStayDateSet.has(stayDate));
  const previousPrimaryRoomTypeId =
    normalizedNightSnapshots.find((night) => Number.isFinite(Number(night.room_type_id ?? 0)) && Number(night.room_type_id ?? 0) > 0)
      ?.room_type_id ?? null;
  const currentRatePlanId = currentReservation.rate_plan_id ? String(currentReservation.rate_plan_id) : null;
  const nextRatePlanId = payload.rate_plan_id !== undefined ? (payload.rate_plan_id ? String(payload.rate_plan_id) : null) : currentRatePlanId;
  const ratePlanChanged = currentRatePlanId !== nextRatePlanId;
  const requestedPriceChoice =
    payload.price_change_choice === "apply_rate_grid" || payload.price_change_choice === "keep_existing"
      ? payload.price_change_choice
      : null;

  let capacityRoomTypeId: number | null = null;
  try {
    capacityRoomTypeId = await resolveRoomTypeIdForPricing(
      supabase,
      reservationId,
      payload.room_id ? null : normalizedRoomTypeId,
      payload.room_id
    );
  } catch (error) {
    return NextResponse.json({ error: (error as Error).message }, { status: 400 });
  }
  const roomTypeChangedForPricing =
    previousPrimaryRoomTypeId !== null &&
    capacityRoomTypeId !== null &&
    Number(previousPrimaryRoomTypeId) !== Number(capacityRoomTypeId);
  const preserveOverlappingRates =
    payload.source !== "ota" &&
    overlappingStayDates.length > 0 &&
    !roomTypeChangedForPricing &&
    !(ratePlanChanged && requestedPriceChoice === "apply_rate_grid");
  const shouldWarnOtaRoomTypeChange = payload.source === "ota" && roomTypeChangedForPricing;
  if (shouldWarnOtaRoomTypeChange) {
    responseWarnings.push("OTA room type changed. Please re-check and confirm OTA nightly rates.");
  }

  if (!skipNightRebuild && capacityRoomTypeId !== null) {
    try {
      await assertRoomTypeCapacityForDateRange(supabase as any, {
        roomTypeId: capacityRoomTypeId,
        nights,
        excludeReservationId: reservationId,
      });
    } catch (error) {
      if (error instanceof PlannedRoomMoveError) {
        return NextResponse.json({ error: error.message }, { status: error.status });
      }
      return NextResponse.json({ error: (error as Error).message }, { status: 500 });
    }
  }
  if (!skipNightRebuild && payload.room_id) {
    try {
      await assertRoomAvailableForDateRange(supabase as any, {
        roomId: payload.room_id,
        checkinDate: payload.checkin_date,
        checkoutDate: payload.checkout_date,
        excludeReservationId: reservationId,
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
  let previousRoomCode: string | null = null;
  try {
    previousRoomCode = await resolveCurrentReservationRoomCode(supabase, reservationId);
  } catch (error) {
    return NextResponse.json({ error: (error as Error).message }, { status: 500 });
  }
  let assignedLockContext: Awaited<ReturnType<typeof getAssignedRoomLockContext>> | null = null;
  const overrideAssignedNote = String(payload.override_assigned_note ?? "").trim();
  try {
    assignedLockContext = await getAssignedRoomLockContext(supabase as any, reservationId);
  } catch (error) {
    if (error instanceof AssignedRoomLockError) {
      return NextResponse.json({ error: error.message, reason_code: error.code }, { status: error.status });
    }
    return NextResponse.json({ error: (error as Error).message }, { status: 500 });
  }
  const roomIdWillChange =
    assignedLockContext.currentRoomId !== null &&
    payload.room_id !== undefined &&
    String(payload.room_id ?? "") !== String(assignedLockContext.currentRoomId ?? "");
  const roomWillBeDropped = assignedLockContext.currentRoomId !== null && explicitRoomUnassignRequested;
  const shouldCheckAssignedLock =
    roomIdWillChange || roomWillBeDropped || (assignedLockContext.currentRoomId !== null && payload.room_id === undefined && normalizedRoomTypeId !== null);
  if (shouldCheckAssignedLock) {
    try {
      await assertAssignedRoomUnlockedOrOverride({
        supabase: supabase as any,
        reservationId,
        action: "reservation_update",
        overrideNote: overrideAssignedNote,
      });
    } catch (error) {
      if (error instanceof AssignedRoomLockError) {
        return NextResponse.json({ error: error.message, reason_code: error.code }, { status: error.status });
      }
      return NextResponse.json({ error: (error as Error).message }, { status: 500 });
    }
  }

  const normalizedOtaPrices = payload.source === "ota"
    ? payload.ota_prices?.map((item) => normalizeMoney(item))
    : null;

  let pricedNights: Awaited<ReturnType<typeof calculateAppliedRateNights>> | null = null;
  if (payload.source !== "ota" && nextRatePlanId) {
    let pricingRoomTypeId: number | null = null;
    try {
      pricingRoomTypeId = await resolveRoomTypeIdForPricing(
        supabase,
        reservationId,
        payload.room_type_id,
        payload.room_id
      );
    } catch (error) {
      return NextResponse.json({ error: (error as Error).message }, { status: 400 });
    }

    if (!pricingRoomTypeId) {
      return NextResponse.json({ error: "Unable to resolve room type for rate plan pricing." }, { status: 400 });
    }

    try {
      const effectiveGuestProfileId =
        payload.guest_profile_id !== undefined
          ? (payload.guest_profile_id ?? null)
          : await resolveReservationGuestProfileId(supabase, reservationId);

      await assertRatePlanEligibleForGuest({
        supabase,
        ratePlanId: nextRatePlanId,
        guestProfileId: effectiveGuestProfileId,
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
        ratePlanId: nextRatePlanId
      });
    } catch (error) {
      if (error instanceof RatePlanPricingError) {
        return NextResponse.json({ error: error.message }, { status: error.status });
      }
      return NextResponse.json({ error: (error as Error).message }, { status: 500 });
    }
  }

  let reservation: any = null;
  if (skipNightRebuild) {
    const { data: metadataOnlyReservation, error: metadataOnlyError } = await supabase
      .from("reservations")
      .update({
        guest_name: payload.guest_name.trim(),
        phone: payload.phone?.trim() || null,
        source: payload.source,
        checkin_date: payload.checkin_date,
        checkout_date: payload.checkout_date,
        checkin_time: payload.checkin_time?.trim() || null,
        ...(hasExpectedArrivalField ? { expected_arrival_time: normalizedExpectedArrivalTime } : {}),
        note: payload.note?.trim() || null,
      })
      .eq("id", reservationId)
      .select("id, booking_code, guest_name, source, checkin_date, checkout_date, total_price")
      .maybeSingle();
    if (metadataOnlyError) {
      return NextResponse.json({ error: metadataOnlyError.message }, { status: 500 });
    }
    if (!metadataOnlyReservation) {
      return NextResponse.json({ error: "Update reservation failed." }, { status: 500 });
    }
    reservation = metadataOnlyReservation;
  } else {
    let { data, error } = await supabase.rpc("booking_update_reservation", {
      p_reservation_id: reservationId,
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
    if (error && isLegacyUpdateRpcMismatch(error.message)) {
      let roomNumber: string | null = null;
      try {
        roomNumber = await resolveRoomNumberById(supabase, payload.room_id);
      } catch (resolveError) {
        return NextResponse.json({ error: (resolveError as Error).message }, { status: 400 });
      }

      const fallback = await supabase.rpc("booking_update_reservation", {
        p_actor_user_id: null,
        p_checkin_date: payload.checkin_date,
        p_checkin_time: payload.checkin_time?.trim() || null,
        p_checkout_date: payload.checkout_date,
        p_guest_name: payload.guest_name.trim(),
        p_note: payload.note?.trim() || null,
        p_ota_prices: normalizedOtaPrices,
        p_phone: payload.phone?.trim() || null,
        p_reservation_id: reservationId,
        p_room_number: roomNumber,
        p_room_type_id: normalizedRoomTypeId,
        p_source: payload.source
      });

      data = fallback.data;
      error = fallback.error;
    }

    if (error) {
      const status = mapBookingErrorToStatus(error.message);
      return NextResponse.json({ error: error.message }, { status });
    }
    if (!data) {
      return NextResponse.json({ error: "Update reservation failed." }, { status: 500 });
    }
    reservation = data;
  }

  // Update additional CRM fields (adults, children, specials, guest_profile_id)
  const reservationExtraPatch: Record<string, unknown> = {
    adults: payload.adults ?? 1,
    children: payload.children ?? 0,
    discount_percent: payload.discount_percent ?? 0,
    discount_type: payload.discount_type ?? "percent",
    discount_value: payload.discount_value ?? payload.discount_percent ?? 0,
    discount_reason: payload.discount_reason?.trim() || null,
    ...(payload.rate_plan_id !== undefined ? { rate_plan_id: payload.rate_plan_id || null } : {}),
    ...(hasSpecialsField ? { specials: normalizedSpecials || null } : {}),
    ...(hasExpectedArrivalField ? { expected_arrival_time: normalizedExpectedArrivalTime } : {}),
  };
  let { error: reservationExtraError } = await supabase
    .from("reservations")
    .update(reservationExtraPatch)
    .eq("id", reservationId);
  if (reservationExtraError && /discount_type|discount_value|expected_arrival_time/i.test(reservationExtraError.message)) {
    const reservationLegacyExtraPatch: Record<string, unknown> = {
      adults: payload.adults ?? 1,
      children: payload.children ?? 0,
      discount_percent: payload.discount_percent ?? 0,
      discount_reason: payload.discount_reason?.trim() || null,
      ...(payload.rate_plan_id !== undefined ? { rate_plan_id: payload.rate_plan_id || null } : {}),
      ...(hasSpecialsField ? { specials: normalizedSpecials || null } : {}),
    };
    const fallbackExtra = await supabase
      .from("reservations")
      .update(reservationLegacyExtraPatch)
      .eq("id", reservationId);
    reservationExtraError = fallbackExtra.error;
  }
  if (reservationExtraError) {
    return NextResponse.json({ error: reservationExtraError.message }, { status: 500 });
  }

  if (hasExpectedArrivalField) {
    try {
      const previousExpectedArrivalTime = normalizeExpectedArrivalTime(currentReservation.expected_arrival_time ?? null);
      if (previousExpectedArrivalTime !== normalizedExpectedArrivalTime) {
        await syncExpectedArrivalAlert({
          supabase,
          reservationId,
          expectedArrivalTime: normalizedExpectedArrivalTime,
        });
      }
    } catch (error) {
      return NextResponse.json({ error: (error as Error).message }, { status: 500 });
    }
  }

  if (payload.guest_profile_id !== undefined) {
    try {
      if (payload.guest_profile_id) {
        await linkPrimaryGuestToReservation(supabase, reservationId, payload.guest_profile_id);
      } else {
        await unlinkPrimaryGuestFromReservation(supabase, reservationId);
      }
    } catch (error) {
      if (error instanceof ReservationPartyError) {
        return NextResponse.json({ error: error.message, ...(error.details ?? {}) }, { status: error.status });
      }
      return NextResponse.json({ error: (error as Error).message }, { status: 500 });
    }
  }

  let finalReservationTotal = round2(Number(currentReservation.total_price ?? reservation?.total_price ?? 0));
  const preservedNightDates: string[] = [];
  const repricedNightDates: string[] = [];
  if (payload.source !== "ota") {
    try {
      if (preserveOverlappingRates && !skipNightRebuild) {
        for (const stayDate of overlappingStayDates) {
          const oldNightly = previousNightlyByDate.get(stayDate);
          if (oldNightly === undefined) continue;
          const { error: restoreNightError } = await supabase
            .from("reservation_nights")
            .update({ nightly_price: oldNightly })
            .eq("reservation_id", reservationId)
            .eq("stay_date", stayDate)
            .is("cancelled_at", null);
          if (restoreNightError) {
            throw new RatePlanPricingError(restoreNightError.message, 500);
          }
          preservedNightDates.push(stayDate);
        }
      }

      if (pricedNights) {
        const appliedByDate = new Map(
          pricedNights.nights.map((night) => [String(night.stay_date), round2(Number(night.applied_rate ?? 0))] as const)
        );
        const datesToApply = preserveOverlappingRates ? addedStayDates : nights;
        for (const stayDate of datesToApply) {
          const appliedRate = appliedByDate.get(stayDate);
          if (appliedRate === undefined) continue;
          const { error: applyNightError } = await supabase
            .from("reservation_nights")
            .update({ nightly_price: appliedRate })
            .eq("reservation_id", reservationId)
            .eq("stay_date", stayDate)
            .is("cancelled_at", null);
          if (applyNightError) {
            throw new RatePlanPricingError(applyNightError.message, 500);
          }
          repricedNightDates.push(stayDate);
        }
      }

      const shouldRecomputeTotal =
        !skipNightRebuild ||
        preservedNightDates.length > 0 ||
        repricedNightDates.length > 0 ||
        (ratePlanChanged && requestedPriceChoice === "apply_rate_grid");

      if (shouldRecomputeTotal) {
        const { data: activeNightsAfter, error: activeNightsAfterError } = await supabase
          .from("reservation_nights")
          .select("nightly_price")
          .eq("reservation_id", reservationId)
          .is("cancelled_at", null);
        if (activeNightsAfterError) {
          throw new RatePlanPricingError(activeNightsAfterError.message, 500);
        }

        finalReservationTotal = round2(
          (activeNightsAfter ?? []).reduce((sum: number, row: any) => sum + Number(row?.nightly_price ?? 0), 0)
        );
        const { error: totalUpdateError } = await supabase
          .from("reservations")
          .update({ total_price: finalReservationTotal })
          .eq("id", reservationId);
        if (totalUpdateError) {
          throw new RatePlanPricingError(totalUpdateError.message, 500);
        }
      }
    } catch (error) {
      if (error instanceof RatePlanPricingError) {
        return NextResponse.json({ error: error.message }, { status: error.status });
      }
      return NextResponse.json({ error: (error as Error).message }, { status: 500 });
    }

    if (reservation && typeof reservation === "object") {
      reservation.total_price = finalReservationTotal;
    }

    const previousTotal = round2(Number(currentReservation.total_price ?? 0));
    const hasDelta = Math.abs(finalReservationTotal - previousTotal) >= 0.01;
    const shouldWritePriceTrace =
      hasDelta ||
      roomTypeChangedForPricing ||
      ratePlanChanged ||
      preservedNightDates.length > 0 ||
      repricedNightDates.length > 0;

    if (shouldWritePriceTrace) {
      const businessDate = toLocalDate(new Date());
      const nowIso = new Date().toISOString();
      const traceTags = [
        roomTypeChangedForPricing ? "room_type_changed" : null,
        ratePlanChanged ? "rate_plan_changed" : null,
        addedStayDates.length > 0 ? "extended" : null,
        nights.length < previousStayDateSet.size ? "shortened" : null,
      ].filter(Boolean);
      const traceLine = [
        `[PRICE TRACE ${businessDate}]`,
        `policy=${preserveOverlappingRates ? "keep_existing_overlap" : "apply_rate_grid"}`,
        `total=${previousTotal.toFixed(2)}→${finalReservationTotal.toFixed(2)}`,
        preservedNightDates.length > 0 ? `kept=${preservedNightDates.length} night(s)` : null,
        repricedNightDates.length > 0 ? `repriced=${repricedNightDates.length} night(s)` : null,
        traceTags.length > 0 ? `tags=${traceTags.join(",")}` : null,
      ]
        .filter(Boolean)
        .join(" | ");

      try {
        await appendReservationNoteLine(supabase as any, reservationId, traceLine);
      } catch (traceNoteError) {
        console.error("[booking-update-price-trace-note]", traceNoteError);
      }

      try {
        await supabase.from("audit_logs").insert({
          actor_user_id: null,
          action: "reservation_price_reconciled",
          entity_type: "reservation",
          entity_id: reservationId,
          before_json: {
            total_price: previousTotal,
            rate_plan_id: currentRatePlanId,
            room_type_id: previousPrimaryRoomTypeId,
          },
          after_json: {
            total_price: finalReservationTotal,
            rate_plan_id: nextRatePlanId,
            room_type_id: capacityRoomTypeId,
            pricing_policy: preserveOverlappingRates ? "keep_existing_overlap" : "apply_rate_grid",
            kept_nights: preservedNightDates,
            repriced_nights: repricedNightDates,
            tags: traceTags,
          },
          business_date: businessDate,
          source: "manual",
        });
      } catch (traceAuditError) {
        console.error("[booking-update-price-trace-audit]", traceAuditError);
      }

      try {
        await supabase.from("folio_payments").insert({
          reservation_id: reservationId,
          tx_type: "payment",
          method: null,
          amount: 0,
          note: traceLine,
          revenue_category: "extra_charge",
          is_record_only: true,
          cashier_name: "FO",
          paid_date: businessDate,
          paid_at: nowIso,
        });
      } catch (traceFolioError) {
        console.error("[booking-update-price-trace-folio]", traceFolioError);
      }
    }
  }

  if (shouldWarnOtaRoomTypeChange) {
    const businessDate = toLocalDate(new Date());
    try {
      await appendReservationNoteLine(
        supabase as any,
        reservationId,
        `[OTA RATE CHECK ${businessDate}] Room type changed. Re-check OTA nightly prices before final settlement.`
      );
    } catch (otaTraceError) {
      console.error("[booking-update-ota-room-type-warning]", otaTraceError);
    }
  }

  if (checkoutDateChanged && previousCheckoutDate) {
    // Keep "default due date = checkout date" loan traces in sync when reservation C/O changes.
    const { error: syncLoanDueError } = await supabase
      .from("reservation_traces")
      .update({ to_date: payload.checkout_date })
      .eq("reservation_id", reservationId)
      .eq("status", "open")
      .not("loan_item_code", "is", null)
      .is("due_date", null)
      .eq("to_date", previousCheckoutDate);
    if (syncLoanDueError) {
      return NextResponse.json(
        {
          error: `Reservation updated but failed to sync default loan due dates: ${syncLoanDueError.message}`,
        },
        { status: 500 }
      );
    }
  }

  if (explicitRoomUnassignRequested || shouldForceFloatingRoomType) {
    const manualNightPatch: Record<string, unknown> = {
      assignment_source: "manual",
      dependency_plan_id: null,
      dependency_reason: null,
    };
    if (explicitRoomUnassignRequested) {
      manualNightPatch.room_id = null;
    }
    if (shouldForceFloatingRoomType && normalizedRoomTypeId !== null) {
      manualNightPatch.room_type_id = normalizedRoomTypeId;
    }
    const { error: clearRoomError } = await supabase
      .from("reservation_nights")
      .update(manualNightPatch)
      .eq("reservation_id", reservationId)
      .is("cancelled_at", null);
    if (clearRoomError) {
      return NextResponse.json({ error: clearRoomError.message }, { status: 500 });
    }
  }

  // Update preferences
  if (payload.preferences !== undefined) {
    // Delete old preferences
    await supabase.from("reservation_preferences").delete().eq("reservation_id", reservationId);

    // Insert new preferences if any
    if (payload.preferences.length > 0) {
      const prefInserts = payload.preferences.map(code => ({
        reservation_id: reservationId,
        feature_code: code
      }));
      await supabase.from("reservation_preferences").insert(prefInserts);
    }
  }

  // ── Auto-cancel zombie planned moves when room changes manually ──
  // When a user changes room_id directly on reservation edit, any status='planned'
  // moves become stale and would permanently block their target rooms.
  if (roomIdWillChange || roomWillBeDropped) {
    try {
      const activePlans = (await listReservationPlannedMoves(supabase as any, reservationId))
        .filter((row) => row.status === "planned");

      if (activePlans.length > 0) {
        const today = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Bangkok" }).format(new Date());

        for (const plan of activePlans) {
          // Float any dependent reservations first
          const impacted = await listPlanImpactAssignments(supabase as any, {
            planId: plan.id,
            sourceRoomId: plan.from_room_id_snapshot ?? null,
            startDate: plan.start_date,
            endDate: plan.end_date,
            excludeReservationId: reservationId,
          });

          if (impacted.length > 0) {
            await floatPlanImpactAssignments(supabase as any, {
              planId: plan.id,
              sourceRoomId: plan.from_room_id_snapshot ?? null,
              startDate: plan.start_date,
              endDate: plan.end_date,
              excludeReservationId: reservationId,
              auditSource: "system",
            });
          }

          // Cancel the planned move
          await supabase
            .from("reservation_room_plans")
            .update({
              status: "cancelled",
              cancelled_at: new Date().toISOString(),
              updated_by: null,
            })
            .eq("id", plan.id)
            .eq("reservation_id", reservationId);

          // Audit trail
          await appendReservationNoteLine(
            supabase as any,
            reservationId,
            `[AUTO-CANCEL PLANNED MOVE ${today}] Room changed manually. Plan ${plan.start_date}→${plan.end_date} to_room=${plan.to_room_id} cancelled.${impacted.length > 0 ? ` Floated ${impacted.length} dependent reservation(s).` : ""}`
          );
        }
      }
    } catch (error) {
      // Non-fatal: log but don't block the reservation update
      console.error("[auto-cancel-planned-moves]", error);
    }
  }

  await syncReservationNightDependencyMetadata(supabase as any, {
    reservationId,
  });

  try {
    const nextRoomCode = payload.room_id ? await resolveRoomNumberById(supabase, payload.room_id) : null;
    const roomChanged = String(previousRoomCode ?? "") !== String(nextRoomCode ?? "");
    const becameFloating = !nextRoomCode && previousRoomCode !== null;
    if (roomChanged || becameFloating) {
      await syncDynamicRoomLinksForReservation(supabase, {
        reservationId,
        nextRoomCode,
      });
    }
  } catch (error) {
    return NextResponse.json({ error: (error as Error).message }, { status: 500 });
  }

  if (shouldCheckAssignedLock && assignedLockContext?.isLocked) {
    try {
      await clearAssignedRoomLock({
        supabase: supabase as any,
        reservationId,
        actor: "FO",
        reason: overrideAssignedNote,
        clearReason: "stale_override",
        appendNote: true,
      });
    } catch (error) {
      if (error instanceof AssignedRoomLockError) {
        return NextResponse.json({ error: error.message, reason_code: error.code }, { status: error.status });
      }
      return NextResponse.json({ error: (error as Error).message }, { status: 500 });
    }
  }

  return NextResponse.json(
    {
      success: true,
      reservation,
      warnings: responseWarnings,
    },
    { status: 200 }
  );
}

/* ─── PATCH /api/bookings/[id] ───────────────────
   Lightweight field-level update (e.g. tax_invoice_requested toggle).
   Only whitelisted fields are accepted.
*/
const patchBookingSchema = z.object({
  tax_invoice_requested: z.boolean().optional(),
});

export async function PATCH(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  const reservationId = params.id;
  if (!reservationId) {
    return NextResponse.json({ error: "Missing reservation id." }, { status: 400 });
  }

  const json = await request.json().catch(() => null);
  const parsed = patchBookingSchema.safeParse(json);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid payload", details: parsed.error.flatten() },
      { status: 400 }
    );
  }

  const patch: Record<string, unknown> = {};
  if (parsed.data.tax_invoice_requested !== undefined) {
    patch.tax_invoice_requested = parsed.data.tax_invoice_requested;
  }

  if (Object.keys(patch).length === 0) {
    return NextResponse.json({ error: "No fields to update." }, { status: 400 });
  }

  const supabase = createServerSupabaseClient();
  const user = await getAuthenticatedUser(supabase, request);
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { data: existingReservation, error: existingReservationError } = await supabase
    .from("reservations")
    .select("id, tax_invoice_requested, checkout_date")
    .eq("id", reservationId)
    .maybeSingle();

  if (existingReservationError) {
    return NextResponse.json({ error: existingReservationError.message }, { status: 500 });
  }
  if (!existingReservation) {
    return NextResponse.json({ error: "Reservation not found." }, { status: 404 });
  }

  const previousTaxInvoiceRequested = Boolean(existingReservation.tax_invoice_requested ?? false);
  const nextTaxInvoiceRequested =
    typeof patch.tax_invoice_requested === "boolean"
      ? patch.tax_invoice_requested
      : previousTaxInvoiceRequested;

  let role: string | null = null;
  let businessDate = toLocalDate(new Date());
  try {
    role = await getUserRole(supabase as any, user.id);
  } catch (roleError) {
    console.error("Failed to resolve role for booking PATCH:", roleError);
  }

  const { data: settingsRow, error: settingsError } = await supabase
    .from("hotel_settings")
    .select("business_date")
    .eq("id", 1)
    .maybeSingle();
  if (!settingsError && settingsRow?.business_date) {
    const resolvedBusinessDate = String(settingsRow.business_date);
    if (/^\d{4}-\d{2}-\d{2}$/.test(resolvedBusinessDate)) {
      businessDate = resolvedBusinessDate;
    }
  }

  const checkoutDateRaw = String(existingReservation.checkout_date ?? "").trim();
  const checkoutDate = /^\d{4}-\d{2}-\d{2}$/.test(checkoutDateRaw) ? checkoutDateRaw : null;
  const isRetroactiveToggle = Boolean(checkoutDate && businessDate > checkoutDate);
  const normalizedRole = String(role ?? "").trim().toLowerCase();
  const isAdmin = normalizedRole === "admin";

  if (isRetroactiveToggle && previousTaxInvoiceRequested !== nextTaxInvoiceRequested && !isAdmin) {
    return NextResponse.json(
      { error: "Only admin can toggle tax invoice after checkout day is closed." },
      { status: 403 }
    );
  }

  const { error } = await supabase
    .from("reservations")
    .update(patch)
    .eq("id", reservationId);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  if (previousTaxInvoiceRequested !== nextTaxInvoiceRequested) {
    try {
      await supabase.from("audit_logs").insert({
        actor_user_id: user.id,
        action: "tax_invoice_toggled",
        entity_type: "reservation",
        entity_id: reservationId,
        before_json: { tax_invoice_requested: previousTaxInvoiceRequested },
        after_json: { tax_invoice_requested: nextTaxInvoiceRequested },
        business_date: businessDate,
        source: "manual",
      });
    } catch (auditError) {
      console.error("Failed to write audit log for tax invoice toggle:", auditError);
    }

    if (isRetroactiveToggle && isAdmin) {
      try {
        await supabase.from("audit_logs").insert({
          actor_user_id: user.id,
          action: "tax_invoice_admin_override",
          entity_type: "reservation",
          entity_id: reservationId,
          source: "manual",
          business_date: businessDate,
          note:
            nextTaxInvoiceRequested
              ? "Admin enabled tax invoice retroactively"
              : "Admin disabled tax invoice retroactively",
          after_json: {
            tax_invoice_requested: nextTaxInvoiceRequested,
            checkout_date: checkoutDate,
            toggled_by: user.id,
          },
        });
      } catch (overrideAuditError) {
        console.error("Failed to write admin override audit log:", overrideAuditError);
      }
    }
  }

  return NextResponse.json({ success: true });
}
