import { z } from "zod";
import { mapBookingErrorToStatus, normalizeMoney, sumMoney } from "@/lib/bookings";
import { syncBookingGroupStatusById } from "@/lib/booking-group-status";
import { normalizeAuditSource, toBangkokDateString } from "@/lib/audit-utils";
import { addDays, compareDateStrings, isValidDateString, listNights } from "@/lib/dates";
import { isLegacyDayUseRoom } from "@/lib/dayuse-rooms";
import { normalizeExpectedArrivalTime, syncExpectedArrivalAlert } from "@/lib/expected-arrival-alert";
import { assertRatePlanEligibleForGuest } from "@/lib/rate-plan-eligibility";
import {
  appendReservationNoteLine,
  expandPlannedMoveNights,
  listOverlappingPlannedRoomHolds,
  syncReservationNightDependencyMetadata,
} from "@/lib/planned-room-moves";
import {
  assertGuestProfileLinkable,
  linkPrimaryGuestToReservation,
  ReservationPartyError,
} from "@/lib/reservation-party";
import { getRoomIdsBlockedOnNight, ROOM_UNSELLABLE_BLOCK_TYPES } from "@/lib/room-block-availability";
import { cleanBookingNameInput } from "@/lib/text-normalization";
import { normalizePhoneForStorage } from "@/lib/phone";

type SupabaseLike = {
  from: (table: string) => any;
  rpc: (fn: string, args?: Record<string, unknown>) => any;
};

type BookingSource = "walkin" | "ota" | "direct" | "agent";
type BookingDiscountType = "percent" | "fixed_total" | "fixed_per_night";
type RatePlanDiscountType = "percent" | "fixed" | "override";

type RoomCandidate = {
  id: string;
  room_number: string;
  room_type_id: number;
  room_type_name: string;
  room_sort_order: number;
  room_type_sort_order: number;
};

type AssignedNight = {
  stay_date: string;
  room: RoomCandidate;
  nightly_rate: number;
};

type RoomOverride = {
  start_date: string;
  end_date: string;
  room_id: string;
};

type RatePlanContext = {
  id: string;
  discount_type: RatePlanDiscountType;
  discount_value: number;
  min_nights: number;
  max_nights: number | null;
  valid_from: string | null;
  valid_until: string | null;
  apply_to_room_types: number[];
};

export type ContinuousStaySegment = {
  start_date: string;
  end_date: string;
  room_id: string;
  room_number: string;
  room_type_id: number;
  room_type_name: string;
  nightly_rates: Array<{ stay_date: string; rate: number }>;
  subtotal: number;
  available_rooms: Array<{
    room_id: string;
    room_number: string;
    room_type_id: number;
    room_type_name: string;
    nightly_rates: Array<{ stay_date: string; rate: number }>;
    subtotal: number;
  }>;
};

export type ContinuousStayPlan = {
  requires_continuous_plan: boolean;
  blocked_nights: Array<{
    stay_date: string;
    requested_room_id: string | null;
    requested_room_number: string | null;
    requested_room_type_id: number;
    requested_room_type_name: string;
    assigned_room_id: string;
    assigned_room_number: string;
    assigned_room_type_id: number;
    assigned_room_type_name: string;
  }>;
  requested: {
    room_id: string | null;
    room_number: string | null;
    room_type_id: number;
    room_type_name: string;
  };
  segments: ContinuousStaySegment[];
  totals: {
    subtotal: number;
    discount_amount: number;
    total: number;
    nights: number;
  };
};

export class ContinuousStayPlanError extends Error {
  status: number;

  constructor(message: string, status = 400) {
    super(message);
    this.name = "ContinuousStayPlanError";
    this.status = status;
  }
}

export const continuousStayBookingPayloadSchema = z.object({
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
  booking_group_id: z.string().uuid().optional().nullable(),
  room_overrides: z.array(z.object({
    start_date: z.string(),
    end_date: z.string(),
    room_id: z.string().uuid(),
  })).optional(),
}).refine((data) => data.room_id || data.room_type_id, {
  message: "Either room_id or room_type_id must be provided",
});

export type ContinuousStayBookingPayload = z.infer<typeof continuousStayBookingPayloadSchema>;

function toNumber(value: unknown): number {
  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function round2(value: number) {
  return Number(value.toFixed(2));
}

function normalizeRoomTypeText(value: unknown): string {
  return String(value ?? "")
    .trim()
    .toLowerCase()
    .replace(/[_-]+/g, " ")
    .replace(/\s+/g, " ");
}

function shouldHideOperationalRoomType(row: { code?: unknown; name_en?: unknown }) {
  const haystack = `${normalizeRoomTypeText(row.code)} ${normalizeRoomTypeText(row.name_en)}`.trim();
  if (!haystack) return false;
  return (
    haystack.includes("day use") ||
    haystack.includes("dayuse") ||
    haystack.includes("close room") ||
    haystack.includes("closed room") ||
    haystack.includes("plan move") ||
    /^move$/.test(haystack)
  );
}

function normalizeRoomTypeId(value: unknown): number | null {
  const text = typeof value === "string" ? value.trim() : "";
  if (!text) return null;
  if (!/^\d+$/u.test(text)) {
    throw new ContinuousStayPlanError("Invalid room_type_id format.", 400);
  }
  const parsed = Number(text);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

function normalizeDiscountType(value: unknown): BookingDiscountType {
  if (value === "fixed_total" || value === "fixed_per_night") return value;
  return "percent";
}

function calculateBookingDiscount(params: {
  subtotal: number;
  nights: number;
  discountType?: BookingDiscountType;
  discountValue?: number;
  discountPercent?: number;
}) {
  const subtotal = normalizeMoney(params.subtotal);
  const nights = Math.max(0, params.nights);
  const discountType = normalizeDiscountType(params.discountType);
  const discountValue = Math.max(0, normalizeMoney(params.discountValue ?? 0));
  const discountPercent = Math.max(0, Math.min(100, normalizeMoney(params.discountPercent ?? discountValue)));
  const rawDiscount =
    discountType === "percent"
      ? subtotal * (discountPercent / 100)
      : discountType === "fixed_per_night"
        ? discountValue * nights
        : discountValue;
  const discountAmount = normalizeMoney(Math.max(0, Math.min(subtotal, rawDiscount)));
  return {
    discount_amount: discountAmount,
    total: normalizeMoney(subtotal - discountAmount),
  };
}

function applyRatePlanDiscount(rackRate: number, discountType: RatePlanDiscountType, discountValue: number) {
  if (discountType === "percent") {
    return round2(Math.max(0, rackRate * (1 - discountValue / 100)));
  }
  if (discountType === "fixed") {
    return round2(Math.max(0, rackRate - discountValue));
  }
  return round2(Math.max(0, discountValue));
}

function isRatePlanAllowedForRoomType(ratePlan: RatePlanContext | null, roomTypeId: number) {
  if (!ratePlan) return true;
  if (ratePlan.apply_to_room_types.length === 0) return true;
  return ratePlan.apply_to_room_types.includes(roomTypeId);
}

function roomTypeRef(row: any) {
  if (!row?.room_types) return null;
  return Array.isArray(row.room_types) ? row.room_types[0] : row.room_types;
}

function sortRooms(left: RoomCandidate, right: RoomCandidate) {
  if (left.room_type_sort_order !== right.room_type_sort_order) {
    return left.room_type_sort_order - right.room_type_sort_order;
  }
  if (left.room_type_id !== right.room_type_id) return left.room_type_id - right.room_type_id;
  if (left.room_sort_order !== right.room_sort_order) return left.room_sort_order - right.room_sort_order;
  return left.room_number.localeCompare(right.room_number, undefined, { numeric: true, sensitivity: "base" });
}

function buildRateKey(roomId: string, stayDate: string) {
  return `${roomId}::${stayDate}`;
}

function buildTypeRateKey(roomTypeId: number, stayDate: string) {
  return `${roomTypeId}::${stayDate}`;
}

function mergeAssignedNightsIntoSegments(nights: AssignedNight[]): ContinuousStaySegment[] {
  const segments: ContinuousStaySegment[] = [];
  for (const night of nights) {
    const last = segments[segments.length - 1];
    if (last && last.room_id === night.room.id && last.end_date === night.stay_date) {
      last.end_date = addDays(night.stay_date, 1);
      last.nightly_rates.push({ stay_date: night.stay_date, rate: night.nightly_rate });
      last.subtotal = normalizeMoney(last.subtotal + night.nightly_rate);
      continue;
    }

    segments.push({
      start_date: night.stay_date,
      end_date: addDays(night.stay_date, 1),
      room_id: night.room.id,
      room_number: night.room.room_number,
      room_type_id: night.room.room_type_id,
      room_type_name: night.room.room_type_name,
      nightly_rates: [{ stay_date: night.stay_date, rate: night.nightly_rate }],
      subtotal: normalizeMoney(night.nightly_rate),
      available_rooms: [],
    });
  }
  return segments;
}

function normalizeRoomOverrides(raw: RoomOverride[] | undefined, checkinDate: string, checkoutDate: string) {
  const overrides: RoomOverride[] = [];
  for (const item of raw ?? []) {
    if (!isValidDateString(item.start_date) || !isValidDateString(item.end_date)) {
      throw new ContinuousStayPlanError("Invalid room override date range.", 400);
    }
    if (compareDateStrings(item.end_date, item.start_date) <= 0) {
      throw new ContinuousStayPlanError("Room override end_date must be after start_date.", 400);
    }
    if (compareDateStrings(item.start_date, checkinDate) < 0 || compareDateStrings(item.end_date, checkoutDate) > 0) {
      throw new ContinuousStayPlanError("Room override range must stay within selected stay dates.", 400);
    }
    overrides.push({
      start_date: item.start_date,
      end_date: item.end_date,
      room_id: item.room_id,
    });
  }
  return overrides.sort((left, right) => left.start_date.localeCompare(right.start_date));
}

function findRoomOverrideForNight(overrides: RoomOverride[], stayDate: string) {
  return overrides.find((item) => item.start_date <= stayDate && item.end_date > stayDate) ?? null;
}

async function loadRooms(supabase: SupabaseLike): Promise<RoomCandidate[]> {
  const { data, error } = await supabase
    .from("rooms")
    .select("id, room_number, room_type_id, sort_order, is_sellable, is_dayuse, room_types(id, code, name_en, sort_order)")
    .eq("is_sellable", true)
    .order("sort_order", { ascending: true })
    .order("room_number", { ascending: true });

  if (error) {
    throw new ContinuousStayPlanError(error.message ?? "Failed to load rooms.", 500);
  }

  return (data ?? [])
    .map((row: any): RoomCandidate | null => {
      const roomId = row?.id ? String(row.id) : "";
      const roomNumber = String(row?.room_number ?? "").trim();
      const roomTypeId = Number(row?.room_type_id ?? 0);
      const typeRef = roomTypeRef(row);
      if (!roomId || !roomNumber || !Number.isFinite(roomTypeId) || roomTypeId <= 0) return null;
      if (Boolean(row?.is_dayuse) || isLegacyDayUseRoom(roomNumber)) return null;
      if (shouldHideOperationalRoomType(typeRef ?? {})) return null;
      return {
        id: roomId,
        room_number: roomNumber,
        room_type_id: roomTypeId,
        room_type_name: String(typeRef?.name_en ?? typeRef?.code ?? `Room Type #${roomTypeId}`),
        room_sort_order: Number(row?.sort_order ?? 0) || 0,
        room_type_sort_order: Number(typeRef?.sort_order ?? 0) || 0,
      };
    })
    .filter((row: RoomCandidate | null): row is RoomCandidate => Boolean(row))
    .sort(sortRooms);
}

async function loadOccupiedRoomIdsByNight(params: {
  supabase: SupabaseLike;
  nights: string[];
}): Promise<Map<string, Set<string>>> {
  const { supabase, nights } = params;
  const map = new Map<string, Set<string>>();
  for (const night of nights) map.set(night, new Set());

  const { data, error } = await supabase
    .from("reservation_nights")
    .select("stay_date, room_id, reservations!inner(status, is_dayuse)")
    .in("stay_date", nights)
    .is("cancelled_at", null)
    .eq("reservations.status", "active")
    .eq("reservations.is_dayuse", false);

  if (error) {
    throw new ContinuousStayPlanError(error.message ?? "Failed to load occupied rooms.", 500);
  }

  for (const row of data ?? []) {
    const stayDate = String((row as any)?.stay_date ?? "");
    const roomId = (row as any)?.room_id ? String((row as any).room_id) : "";
    if (!stayDate || !roomId) continue;
    const set = map.get(stayDate) ?? new Set<string>();
    set.add(roomId);
    map.set(stayDate, set);
  }

  return map;
}

async function loadBlockedRoomIdsByNight(params: {
  supabase: SupabaseLike;
  roomIds: string[];
  nights: string[];
  checkinDate: string;
  checkoutDate: string;
}): Promise<Map<string, Set<string>>> {
  const { supabase, roomIds, nights, checkinDate, checkoutDate } = params;
  const map = new Map<string, Set<string>>();
  for (const night of nights) map.set(night, new Set());
  if (roomIds.length === 0) return map;

  const { data, error } = await supabase
    .from("room_blocks")
    .select("room_id, start_date, end_date, block_type")
    .in("room_id", roomIds)
    .in("block_type", ROOM_UNSELLABLE_BLOCK_TYPES)
    .lt("start_date", checkoutDate)
    .gt("end_date", checkinDate);

  if (error) {
    throw new ContinuousStayPlanError(error.message ?? "Failed to load room blocks.", 500);
  }

  for (const night of nights) {
    map.set(night, getRoomIdsBlockedOnNight(data, night));
  }

  return map;
}

async function loadPlannedHoldRoomIdsByNight(params: {
  supabase: SupabaseLike;
  roomIds: string[];
  nights: string[];
  checkinDate: string;
  checkoutDate: string;
}): Promise<Map<string, Set<string>>> {
  const { supabase, roomIds, nights, checkinDate, checkoutDate } = params;
  const map = new Map<string, Set<string>>();
  for (const night of nights) map.set(night, new Set());
  if (roomIds.length === 0) return map;

  const holds = await listOverlappingPlannedRoomHolds(supabase as any, {
    checkinDate,
    checkoutDate,
    roomIds,
  });

  for (const hold of holds) {
    const roomId = String(hold.to_room_id ?? "");
    if (!roomId) continue;
    for (const stayDate of expandPlannedMoveNights(hold)) {
      if (!nights.includes(stayDate)) continue;
      const set = map.get(stayDate) ?? new Set<string>();
      set.add(roomId);
      map.set(stayDate, set);
    }
  }

  return map;
}

async function loadExactRates(params: {
  supabase: SupabaseLike;
  roomIds: string[];
  nights: string[];
}): Promise<Map<string, number>> {
  const { supabase, roomIds, nights } = params;
  const map = new Map<string, number>();
  if (roomIds.length === 0 || nights.length === 0) return map;

  const { data, error } = await supabase
    .from("rate_templates")
    .select("room_id, stay_date, price")
    .in("room_id", roomIds)
    .in("stay_date", nights);

  if (error) {
    throw new ContinuousStayPlanError(error.message ?? "Failed to load rate grid.", 500);
  }

  for (const row of data ?? []) {
    const roomId = String((row as any)?.room_id ?? "");
    const stayDate = String((row as any)?.stay_date ?? "");
    if (!roomId || !stayDate) continue;
    map.set(buildRateKey(roomId, stayDate), normalizeMoney((row as any)?.price));
  }

  return map;
}

async function loadTypeAverageRates(params: {
  supabase: SupabaseLike;
  rooms: RoomCandidate[];
  roomTypeIds: number[];
  nights: string[];
}): Promise<Map<string, number>> {
  const { supabase, rooms, roomTypeIds, nights } = params;
  const typeSet = new Set(roomTypeIds.filter((value) => Number.isFinite(value) && value > 0));
  const pricingRooms = rooms.filter((room) => typeSet.has(room.room_type_id));
  const map = new Map<string, number>();
  if (pricingRooms.length === 0 || nights.length === 0) return map;

  const typeByRoomId = new Map(pricingRooms.map((room) => [room.id, room.room_type_id]));
  const { data, error } = await supabase
    .from("rate_templates")
    .select("room_id, stay_date, price")
    .in("room_id", pricingRooms.map((room) => room.id))
    .in("stay_date", nights);

  if (error) {
    throw new ContinuousStayPlanError(error.message ?? "Failed to load type rate grid.", 500);
  }

  const valuesByTypeDate = new Map<string, number[]>();
  for (const row of data ?? []) {
    const roomId = String((row as any)?.room_id ?? "");
    const stayDate = String((row as any)?.stay_date ?? "");
    const roomTypeId = typeByRoomId.get(roomId);
    if (!roomId || !stayDate || !roomTypeId) continue;
    const key = buildTypeRateKey(roomTypeId, stayDate);
    const values = valuesByTypeDate.get(key) ?? [];
    values.push(toNumber((row as any)?.price));
    valuesByTypeDate.set(key, values);
  }

  for (const roomTypeId of typeSet) {
    for (const night of nights) {
      const key = buildTypeRateKey(roomTypeId, night);
      const values = valuesByTypeDate.get(key) ?? [];
      if (values.length === 0) continue;
      map.set(key, round2(values.reduce((sum, value) => sum + value, 0) / values.length));
    }
  }

  return map;
}

async function loadRatePlanContext(params: {
  supabase: SupabaseLike;
  ratePlanId?: string | null;
}): Promise<RatePlanContext | null> {
  const { supabase, ratePlanId } = params;
  if (!ratePlanId) return null;

  const { data, error } = await supabase
    .from("rate_plans")
    .select("id, discount_type, discount_value, min_nights, max_nights, valid_from, valid_until, is_active, apply_to_room_types")
    .eq("id", ratePlanId)
    .maybeSingle();

  if (error) {
    throw new ContinuousStayPlanError(error.message ?? "Failed to load rate plan.", 500);
  }
  if (!data) {
    throw new ContinuousStayPlanError("Rate plan not found.", 404);
  }
  if (!Boolean((data as any).is_active)) {
    throw new ContinuousStayPlanError("Rate plan is inactive.", 400);
  }

  const rawType = String((data as any).discount_type ?? "percent").toLowerCase();
  const discountType: RatePlanDiscountType =
    rawType === "fixed" ? "fixed" : rawType === "override" ? "override" : "percent";
  const applyToRoomTypes = Array.isArray((data as any).apply_to_room_types)
    ? (data as any).apply_to_room_types
        .map((value: unknown) => Number(value))
        .filter((value: number) => Number.isFinite(value) && value > 0)
    : [];

  return {
    id: String((data as any).id),
    discount_type: discountType,
    discount_value: normalizeMoney((data as any).discount_value),
    min_nights: Math.max(1, Math.trunc(toNumber((data as any).min_nights ?? 1))),
    max_nights:
      (data as any).max_nights == null
        ? null
        : Math.max(1, Math.trunc(toNumber((data as any).max_nights))),
    valid_from: (data as any).valid_from ? String((data as any).valid_from) : null,
    valid_until: (data as any).valid_until ? String((data as any).valid_until) : null,
    apply_to_room_types: applyToRoomTypes,
  };
}

function validateRatePlanForStay(params: {
  ratePlan: RatePlanContext;
  nights: string[];
}) {
  const { ratePlan, nights } = params;
  if (nights.length < ratePlan.min_nights) {
    throw new ContinuousStayPlanError(`Rate plan requires minimum ${ratePlan.min_nights} night(s).`, 400);
  }
  if (ratePlan.max_nights != null && nights.length > ratePlan.max_nights) {
    throw new ContinuousStayPlanError(`Rate plan allows maximum ${ratePlan.max_nights} night(s).`, 400);
  }
  const outsidePeriod = nights.some((night) => {
    if (ratePlan.valid_from && night < ratePlan.valid_from) return true;
    if (ratePlan.valid_until && night > ratePlan.valid_until) return true;
    return false;
  });
  if (outsidePeriod) {
    throw new ContinuousStayPlanError("Rate plan is outside valid date range for selected stay.", 400);
  }
}

async function priceAssignedNights(params: {
  supabase: SupabaseLike;
  rooms: RoomCandidate[];
  assignedNights: Array<{ stay_date: string; room: RoomCandidate }>;
  ratePlan: RatePlanContext | null;
}) {
  const { supabase, rooms, assignedNights, ratePlan } = params;
  const roomIds = Array.from(new Set(assignedNights.map((row) => row.room.id)));
  const stayDates = assignedNights.map((row) => row.stay_date);
  const exactRates = await loadExactRates({ supabase, roomIds, nights: stayDates });
  const typeRates = ratePlan
    ? await loadTypeAverageRates({
        supabase,
        rooms,
        roomTypeIds: assignedNights.map((row) => row.room.room_type_id),
        nights: stayDates,
      })
    : new Map<string, number>();

  return assignedNights.map((night): AssignedNight => {
    const exactRate = exactRates.get(buildRateKey(night.room.id, night.stay_date)) ?? 0;
    const rackRate = ratePlan
      ? typeRates.get(buildTypeRateKey(night.room.room_type_id, night.stay_date)) ?? exactRate
      : exactRate;
    const nightlyRate = ratePlan
      ? applyRatePlanDiscount(rackRate, ratePlan.discount_type, ratePlan.discount_value)
      : normalizeMoney(rackRate);
    return {
      stay_date: night.stay_date,
      room: night.room,
      nightly_rate: nightlyRate,
    };
  });
}

async function buildAvailableRoomOptionsForSegment(params: {
  supabase: SupabaseLike;
  rooms: RoomCandidate[];
  eligibleRooms: RoomCandidate[];
  segment: ContinuousStaySegment;
  isAvailable: (room: RoomCandidate, stayDate: string) => boolean;
  ratePlan: RatePlanContext | null;
}) {
  const { supabase, rooms, eligibleRooms, segment, isAvailable, ratePlan } = params;
  const stayDates = segment.nightly_rates.map((night) => night.stay_date);
  const candidates = eligibleRooms.filter((room) =>
    stayDates.every((stayDate) => room.id === segment.room_id || isAvailable(room, stayDate))
  );
  const pricedOptions = await Promise.all(
    candidates.map(async (room) => {
      const pricedNights = await priceAssignedNights({
        supabase,
        rooms,
        assignedNights: stayDates.map((stayDate) => ({ stay_date: stayDate, room })),
        ratePlan,
      });
      return {
        room_id: room.id,
        room_number: room.room_number,
        room_type_id: room.room_type_id,
        room_type_name: room.room_type_name,
        nightly_rates: pricedNights.map((night) => ({
          stay_date: night.stay_date,
          rate: night.nightly_rate,
        })),
        subtotal: sumMoney(pricedNights.map((night) => night.nightly_rate)),
      };
    })
  );

  return pricedOptions.sort((left, right) => {
    if (left.room_id === segment.room_id) return -1;
    if (right.room_id === segment.room_id) return 1;
    const leftRoom = eligibleRooms.find((room) => room.id === left.room_id);
    const rightRoom = eligibleRooms.find((room) => room.id === right.room_id);
    if (leftRoom && rightRoom) return sortRooms(leftRoom, rightRoom);
    return left.room_number.localeCompare(right.room_number, undefined, { numeric: true, sensitivity: "base" });
  });
}

async function resolveAuditBusinessDate(supabase: SupabaseLike): Promise<string> {
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

export async function previewContinuousStayPlan(params: {
  supabase: SupabaseLike;
  payload: ContinuousStayBookingPayload;
}): Promise<ContinuousStayPlan> {
  const { supabase, payload } = params;
  if (payload.source === "ota") {
    throw new ContinuousStayPlanError("OTA bookings should use the normal booking flow.", 400);
  }

  const normalizedRoomTypeId = normalizeRoomTypeId(payload.room_type_id);
  if (!isValidDateString(payload.checkin_date) || !isValidDateString(payload.checkout_date)) {
    throw new ContinuousStayPlanError("Invalid date format. Use YYYY-MM-DD.", 400);
  }

  const nights = listNights(payload.checkin_date, payload.checkout_date);
  const rooms = await loadRooms(supabase);
  const roomById = new Map(rooms.map((room) => [room.id, room]));
  const roomOverrides = normalizeRoomOverrides(payload.room_overrides, payload.checkin_date, payload.checkout_date);
  const selectedRoom = payload.room_id ? roomById.get(payload.room_id) ?? null : null;
  if (payload.room_id && !selectedRoom) {
    throw new ContinuousStayPlanError("Selected room is not sellable or could not be found.", 404);
  }

  const requestedRoomTypeId = selectedRoom?.room_type_id ?? normalizedRoomTypeId;
  if (!requestedRoomTypeId) {
    throw new ContinuousStayPlanError("Either room_id or room_type_id must be provided.", 400);
  }

  const requestedTypeRoom = rooms.find((room) => room.room_type_id === requestedRoomTypeId) ?? selectedRoom;
  if (!requestedTypeRoom) {
    throw new ContinuousStayPlanError("No sellable rooms found for selected room type.", 404);
  }

  const ratePlan = await loadRatePlanContext({ supabase, ratePlanId: payload.rate_plan_id ?? null });
  if (ratePlan) {
    validateRatePlanForStay({ ratePlan, nights });
    try {
      await assertRatePlanEligibleForGuest({
        supabase,
        ratePlanId: ratePlan.id,
        guestProfileId: payload.guest_profile_id ?? null,
        roomTypeId: requestedRoomTypeId,
        nights: nights.length,
        checkinDate: payload.checkin_date,
        checkoutDate: payload.checkout_date,
      });
    } catch (error) {
      const status = typeof (error as any)?.status === "number"
        ? (error as any).status
        : mapBookingErrorToStatus((error as Error).message);
      throw new ContinuousStayPlanError((error as Error).message, status);
    }
  }

  const eligibleRooms = rooms.filter((room) => isRatePlanAllowedForRoomType(ratePlan, room.room_type_id));
  const roomIds = eligibleRooms.map((room) => room.id);
  const [occupiedByNight, blockedByNight, plannedByNight] = await Promise.all([
    loadOccupiedRoomIdsByNight({ supabase, nights }),
    loadBlockedRoomIdsByNight({
      supabase,
      roomIds,
      nights,
      checkinDate: payload.checkin_date,
      checkoutDate: payload.checkout_date,
    }),
    loadPlannedHoldRoomIdsByNight({
      supabase,
      roomIds,
      nights,
      checkinDate: payload.checkin_date,
      checkoutDate: payload.checkout_date,
    }),
  ]);

  const isAvailable = (room: RoomCandidate, stayDate: string) => {
    return (
      !occupiedByNight.get(stayDate)?.has(room.id) &&
      !blockedByNight.get(stayDate)?.has(room.id) &&
      !plannedByNight.get(stayDate)?.has(room.id)
    );
  };

  const assignedWithoutPrices: Array<{ stay_date: string; room: RoomCandidate }> = [];
  let previousRoom: RoomCandidate | null = null;

  for (const stayDate of nights) {
    const override = findRoomOverrideForNight(roomOverrides, stayDate);
    if (override) {
      const overrideRoom = roomById.get(override.room_id) ?? null;
      if (!overrideRoom || !eligibleRooms.some((room) => room.id === overrideRoom.id)) {
        throw new ContinuousStayPlanError("Selected move room is not sellable or not eligible for this rate plan.", 400);
      }
      if (!isAvailable(overrideRoom, stayDate)) {
        throw new ContinuousStayPlanError(`Selected move room ${overrideRoom.room_number} is not available on ${stayDate}.`, 409);
      }
      assignedWithoutPrices.push({ stay_date: stayDate, room: overrideRoom });
      previousRoom = overrideRoom;
      continue;
    }

    const candidates: RoomCandidate[] = [];
    const pushUnique = (room: RoomCandidate | null | undefined) => {
      if (!room) return;
      if (!eligibleRooms.some((candidate) => candidate.id === room.id)) return;
      if (candidates.some((candidate) => candidate.id === room.id)) return;
      candidates.push(room);
    };

    if (selectedRoom) pushUnique(selectedRoom);
    if (!selectedRoom && previousRoom?.room_type_id === requestedRoomTypeId) pushUnique(previousRoom);
    for (const room of eligibleRooms.filter((item) => item.room_type_id === requestedRoomTypeId)) pushUnique(room);
    if (previousRoom) pushUnique(previousRoom);
    for (const room of eligibleRooms.filter((item) => item.room_type_id !== requestedRoomTypeId)) pushUnique(room);

    const assignedRoom = candidates.find((room) => isAvailable(room, stayDate));
    if (!assignedRoom) {
      throw new ContinuousStayPlanError(`No available sellable room found on ${stayDate}.`, 409);
    }

    assignedWithoutPrices.push({ stay_date: stayDate, room: assignedRoom });
    previousRoom = assignedRoom;
  }

  const assignedNights = await priceAssignedNights({
    supabase,
    rooms,
    assignedNights: assignedWithoutPrices,
    ratePlan,
  });
  const segments = mergeAssignedNightsIntoSegments(assignedNights);
  for (const segment of segments) {
    segment.available_rooms = await buildAvailableRoomOptionsForSegment({
      supabase,
      rooms,
      eligibleRooms,
      segment,
      isAvailable,
      ratePlan,
    });
  }

  const requestedRoomId = selectedRoom?.id ?? null;
  const requiresContinuousPlan = assignedNights.some((night) => {
    if (requestedRoomId) return night.room.id !== requestedRoomId;
    return night.room.room_type_id !== requestedRoomTypeId;
  });

  const blockedNights = assignedNights
    .filter((night) => {
      if (requestedRoomId) return night.room.id !== requestedRoomId;
      return night.room.room_type_id !== requestedRoomTypeId;
    })
    .map((night) => ({
      stay_date: night.stay_date,
      requested_room_id: requestedRoomId,
      requested_room_number: selectedRoom?.room_number ?? null,
      requested_room_type_id: requestedRoomTypeId,
      requested_room_type_name: requestedTypeRoom.room_type_name,
      assigned_room_id: night.room.id,
      assigned_room_number: night.room.room_number,
      assigned_room_type_id: night.room.room_type_id,
      assigned_room_type_name: night.room.room_type_name,
    }));

  const subtotal = sumMoney(assignedNights.map((night) => night.nightly_rate));
  const discount = calculateBookingDiscount({
    subtotal,
    nights: assignedNights.length,
    discountType: payload.discount_type,
    discountValue: payload.discount_value,
    discountPercent: payload.discount_percent,
  });

  return {
    requires_continuous_plan: requiresContinuousPlan,
    blocked_nights: blockedNights,
    requested: {
      room_id: selectedRoom?.id ?? null,
      room_number: selectedRoom?.room_number ?? null,
      room_type_id: requestedRoomTypeId,
      room_type_name: requestedTypeRoom.room_type_name,
    },
    segments,
    totals: {
      subtotal,
      discount_amount: discount.discount_amount,
      total: discount.total,
      nights: assignedNights.length,
    },
  };
}

async function rollbackCreatedReservation(supabase: SupabaseLike, reservationId: string | null) {
  if (!reservationId) return;
  await supabase.from("reservations").delete().eq("id", reservationId);
}

export async function commitContinuousStayBooking(params: {
  supabase: SupabaseLike;
  payload: ContinuousStayBookingPayload;
  actorUserId?: string | null;
}): Promise<{ reservation: any; plan: ContinuousStayPlan }> {
  const { supabase, payload, actorUserId = null } = params;
  const normalizedGuestName = cleanBookingNameInput(payload.guest_name);
  if (!normalizedGuestName) {
    throw new ContinuousStayPlanError("Guest Name is required.", 400);
  }
  const normalizedPhone = normalizePhoneForStorage(payload.phone);
  let normalizedExpectedArrivalTime: string | null = null;
  try {
    normalizedExpectedArrivalTime = normalizeExpectedArrivalTime(payload.expected_arrival_time);
  } catch (error) {
    throw new ContinuousStayPlanError((error as Error).message, 400);
  }

  if (payload.guest_profile_id) {
    try {
      await assertGuestProfileLinkable(supabase, payload.guest_profile_id);
    } catch (error) {
      if (error instanceof ReservationPartyError) {
        throw new ContinuousStayPlanError(error.message, error.status);
      }
      throw new ContinuousStayPlanError((error as Error).message, 500);
    }
  }

  const plan = await previewContinuousStayPlan({ supabase, payload });
  if (!plan.requires_continuous_plan) {
    throw new ContinuousStayPlanError("No continuous stay plan is required for this booking.", 400);
  }

  let reservationId: string | null = null;
  const { data: bookingCode, error: bookingCodeError } = await supabase.rpc("generate_booking_code");
  if (bookingCodeError || !bookingCode) {
    throw new ContinuousStayPlanError(bookingCodeError?.message ?? "Cannot generate unique booking code", 500);
  }

  const reservationInsert = {
    booking_code: String(bookingCode),
    guest_name: normalizedGuestName,
    phone: normalizedPhone,
    source: payload.source,
    status: "active",
    checkin_date: payload.checkin_date,
    checkout_date: payload.checkout_date,
    checkin_time: payload.checkin_time?.trim() || null,
    note: payload.note?.trim() || null,
    total_price: plan.totals.subtotal,
    created_by: actorUserId,
    updated_by: actorUserId,
    adults: payload.adults ?? 1,
    children: payload.children ?? 0,
    specials: payload.specials || null,
    discount_percent: payload.discount_percent ?? 0,
    discount_type: payload.discount_type ?? "percent",
    discount_value: payload.discount_value ?? payload.discount_percent ?? 0,
    discount_reason: payload.discount_reason?.trim() || null,
    rate_plan_id: payload.rate_plan_id || null,
    booking_group_id: payload.booking_group_id || null,
    expected_arrival_time: normalizedExpectedArrivalTime,
  };

  const { data: reservation, error: reservationError } = await supabase
    .from("reservations")
    .insert(reservationInsert)
    .select("*")
    .single();
  if (reservationError || !reservation) {
    throw new ContinuousStayPlanError(reservationError?.message ?? "Create reservation failed.", 500);
  }
  reservationId = String((reservation as any).id);

  try {
    const nightRows = plan.segments.flatMap((segment) =>
      segment.nightly_rates.map((night) => ({
        reservation_id: reservationId,
        room_id: segment.room_id,
        room_type_id: segment.room_type_id,
        stay_date: night.stay_date,
        nightly_price: night.rate,
        is_ota: false,
        assignment_source: "auto_assign",
      }))
    );
    const { error: nightsError } = await supabase.from("reservation_nights").insert(nightRows);
    if (nightsError) {
      throw new ContinuousStayPlanError(nightsError.message ?? "Failed to create reservation nights.", 409);
    }

    if (plan.segments.length > 1) {
      const planRows = plan.segments.slice(1).map((segment, index) => {
        const previousSegment = plan.segments[index];
        return {
          reservation_id: reservationId,
          start_date: segment.start_date,
          end_date: segment.end_date,
          from_room_id_snapshot: previousSegment.room_id,
          to_room_type_id: segment.room_type_id,
          to_room_id: segment.room_id,
          move_reason: "Auto split stay from booking create conflict",
          pricing_policy: "reprice_grid",
          discount_type: null,
          discount_value: null,
          discount_reason: null,
          do_not_move: false,
          status: "planned",
          created_by: actorUserId,
          updated_by: actorUserId,
        };
      });
      const { error: plansError } = await supabase.from("reservation_room_plans").insert(planRows);
      if (plansError) {
        throw new ContinuousStayPlanError(plansError.message ?? "Failed to create planned room moves.", 500);
      }
    }
  } catch (error) {
    await rollbackCreatedReservation(supabase, reservationId);
    throw error;
  }

  try {
    await syncReservationNightDependencyMetadata(supabase as any, { reservationId });
  } catch (error) {
    console.error("[continuous-stay] dependency metadata sync failed", error);
  }

  try {
    await syncExpectedArrivalAlert({
      supabase,
      reservationId,
      expectedArrivalTime: normalizedExpectedArrivalTime,
    });
  } catch (error) {
    console.error("[continuous-stay] expected arrival alert sync failed", error);
  }

  if (payload.guest_profile_id) {
    try {
      await linkPrimaryGuestToReservation(supabase, reservationId, payload.guest_profile_id);
    } catch (error) {
      if (error instanceof ReservationPartyError) {
        throw new ContinuousStayPlanError(error.message, error.status);
      }
      throw new ContinuousStayPlanError((error as Error).message, 500);
    }
  }

  if (payload.booking_group_id) {
    const { data: groupRow, error: groupReadError } = await supabase
      .from("booking_groups")
      .select("id, total_rooms")
      .eq("id", payload.booking_group_id)
      .maybeSingle();
    if (!groupReadError && groupRow) {
      await supabase
        .from("booking_groups")
        .update({ total_rooms: Number((groupRow as any).total_rooms ?? 0) + 1 })
        .eq("id", payload.booking_group_id);
    }
    try {
      await syncBookingGroupStatusById(supabase as any, payload.booking_group_id);
    } catch (error) {
      console.error("[continuous-stay] booking group status sync failed", error);
    }
  }

  if (payload.preferences && payload.preferences.length > 0) {
    await supabase.from("reservation_preferences").insert(
      payload.preferences.map((code) => ({
        reservation_id: reservationId,
        feature_code: code,
      }))
    );
  }

  const businessDate = await resolveAuditBusinessDate(supabase);
  const pathLabel = plan.segments
    .map((segment) => `${segment.room_number} ${segment.start_date}->${segment.end_date}`)
    .join(" | ");

  try {
    await appendReservationNoteLine(
      supabase as any,
      reservationId,
      `[AUTO SPLIT ${businessDate}] Continuous stay created from availability conflict: ${pathLabel}`
    );
  } catch (error) {
    console.error("[continuous-stay] reservation note append failed", error);
  }

  try {
    await supabase.from("audit_logs").insert({
      actor_user_id: actorUserId,
      action: "reservation_created_continuous_stay",
      entity_type: "reservation",
      entity_id: reservationId,
      before_json: null,
      after_json: {
        booking_code: String((reservation as any).booking_code ?? bookingCode),
        guest_name: normalizedGuestName,
        source: payload.source,
        checkin_date: payload.checkin_date,
        checkout_date: payload.checkout_date,
        requested: plan.requested,
        segments: plan.segments,
        totals: plan.totals,
      },
      business_date: businessDate,
      source: normalizeAuditSource("manual"),
    });
  } catch (error) {
    console.error("[continuous-stay] audit insert failed", error);
  }

  const { data: refreshedReservation } = await supabase
    .from("reservations")
    .select("*")
    .eq("id", reservationId)
    .maybeSingle();

  return {
    reservation: refreshedReservation ?? reservation,
    plan,
  };
}
