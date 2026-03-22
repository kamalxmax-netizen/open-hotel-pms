import { addDays, compareDateStrings, isValidDateString } from "@/lib/dates";
import { toBangkokDateString, normalizeAuditSource } from "@/lib/audit-utils";
import {
  appendReservationNoteLine,
  assertRoomAvailableForDateRange,
  syncReservationNightDependencyMetadata,
} from "@/lib/planned-room-moves";
import { executeRoomMove } from "@/lib/room-move";
import { calculateAppliedRateNights } from "@/lib/rate-plan-pricing";

type SupabaseLike = {
  from: (table: string) => any;
};

export type RoomPlannerActionType = "MOVE_WHOLE" | "ASSIGN" | "UNASSIGN";
export type RoomPlannerPricingPolicy = "keep_rtc" | "reprice_grid";

export type RoomPlannerNightOverride = {
  stay_date: string;
  nightly_price: number;
};

export type RoomPlannerActionInput = {
  type: RoomPlannerActionType;
  reservation_id: string;
  to_room_id?: string | null;
  pricing_policy?: RoomPlannerPricingPolicy;
  ota_night_overrides?: RoomPlannerNightOverride[] | null;
};

type ReservationNightRow = {
  reservation_id: string;
  stay_date: string;
  room_id: string | null;
  room_type_id: number | null;
  nightly_price: number;
  is_ota: boolean;
  assignment_source: string | null;
  dependency_plan_id: string | null;
  dependency_reason: string | null;
};

type ReservationContext = {
  id: string;
  booking_code: string | null;
  guest_name: string | null;
  source: string;
  status: string;
  checkin_date: string;
  checkout_date: string;
  checked_in_at: string | null;
  do_not_move_assigned_room: boolean;
  rate_plan_id: string | null;
  total_price: number;
  nights: ReservationNightRow[];
};

type RoomRow = {
  id: string;
  room_number: string;
  room_type_id: number;
  is_sellable: boolean;
  is_dayuse: boolean;
};

type ReservationSnapshot = {
  reservation_id: string;
  total_price: number;
  nights: ReservationNightRow[];
};

type PricingPreviewNight = {
  stay_date: string;
  current_price: number;
  new_price: number;
  is_ota: boolean;
  editable: boolean;
};

type ActionPricingPreview = {
  action_index: number;
  reservation_id: string;
  source: string;
  current_total: number;
  new_total: number;
  delta: number;
  nights: PricingPreviewNight[];
  rate_plan_name?: string;
};

export type RoomPlannerPreviewResult = {
  previews: ActionPricingPreview[];
  warnings: string[];
};

type ExecutedActionResult = {
  action_index: number;
  result: Record<string, unknown>;
};

type FailedActionResult = {
  action_index: number;
  error: string;
};

export type RoomPlannerCommitResult = {
  success: boolean;
  executed: ExecutedActionResult[];
  failed: FailedActionResult[];
  rolled_back: number[];
  warnings: string[];
};

type PricingComputation = {
  byStayDate: Map<string, number>;
  nights: PricingPreviewNight[];
  currentTotal: number;
  newTotal: number;
  delta: number;
  ratePlanName?: string;
};

export class RoomPlannerEngineError extends Error {
  status: number;

  constructor(message: string, status = 400) {
    super(message);
    this.name = "RoomPlannerEngineError";
    this.status = status;
  }
}

function toNumber(value: unknown): number {
  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function round2(value: number): number {
  return Number(value.toFixed(2));
}

function normalizeSource(source: string | null | undefined): string {
  return String(source ?? "").trim().toLowerCase();
}

function actionLabel(actionType: RoomPlannerActionType) {
  if (actionType === "MOVE_WHOLE") return "MOVE";
  if (actionType === "ASSIGN") return "ASSIGN";
  return "UNASSIGN";
}

function buildStayDatesFromNights(nights: ReservationNightRow[]): string[] {
  return nights.map((row) => row.stay_date).sort();
}

function buildAffectedNights(context: ReservationContext, businessDate: string): ReservationNightRow[] {
  return context.nights
    .filter((night) => compareDateStrings(night.stay_date, businessDate) >= 0)
    .sort((left, right) => left.stay_date.localeCompare(right.stay_date));
}

function isOtaSource(source: string): boolean {
  return normalizeSource(source) === "ota";
}

function isWalkInLikeSource(source: string): boolean {
  const normalized = normalizeSource(source);
  return normalized === "walkin" || normalized === "direct" || normalized === "agent";
}

async function loadReservationContexts(
  supabase: SupabaseLike,
  reservationIds: string[]
): Promise<Map<string, ReservationContext>> {
  const uniqueIds = Array.from(new Set(reservationIds.filter(Boolean)));
  if (uniqueIds.length === 0) return new Map();

  const { data: reservations, error: reservationsError } = await supabase
    .from("reservations")
    .select(`
      id,
      booking_code,
      guest_name,
      source,
      status,
      checkin_date,
      checkout_date,
      checked_in_at,
      do_not_move_assigned_room,
      rate_plan_id,
      total_price
    `)
    .in("id", uniqueIds);

  if (reservationsError) {
    throw new RoomPlannerEngineError(reservationsError.message ?? "Failed to load reservations.", 500);
  }

  const { data: nights, error: nightsError } = await supabase
    .from("reservation_nights")
    .select(`
      reservation_id,
      stay_date,
      room_id,
      room_type_id,
      nightly_price,
      is_ota,
      assignment_source,
      dependency_plan_id,
      dependency_reason
    `)
    .in("reservation_id", uniqueIds)
    .is("cancelled_at", null)
    .order("stay_date", { ascending: true });

  if (nightsError) {
    throw new RoomPlannerEngineError(nightsError.message ?? "Failed to load reservation nights.", 500);
  }

  const nightsByReservation = new Map<string, ReservationNightRow[]>();
  for (const row of nights ?? []) {
    const reservationId = String((row as any).reservation_id ?? "");
    if (!reservationId) continue;
    const list = nightsByReservation.get(reservationId) ?? [];
    list.push({
      reservation_id: reservationId,
      stay_date: String((row as any).stay_date ?? ""),
      room_id: (row as any).room_id ? String((row as any).room_id) : null,
      room_type_id: Number.isFinite(Number((row as any).room_type_id))
        ? Number((row as any).room_type_id)
        : null,
      nightly_price: round2(toNumber((row as any).nightly_price)),
      is_ota: Boolean((row as any).is_ota),
      assignment_source: (row as any).assignment_source ? String((row as any).assignment_source) : null,
      dependency_plan_id: (row as any).dependency_plan_id ? String((row as any).dependency_plan_id) : null,
      dependency_reason: (row as any).dependency_reason ? String((row as any).dependency_reason) : null,
    });
    nightsByReservation.set(reservationId, list);
  }

  const map = new Map<string, ReservationContext>();
  for (const row of reservations ?? []) {
    const reservationId = String((row as any).id ?? "");
    if (!reservationId) continue;
    map.set(reservationId, {
      id: reservationId,
      booking_code: (row as any).booking_code ? String((row as any).booking_code) : null,
      guest_name: (row as any).guest_name ? String((row as any).guest_name) : null,
      source: String((row as any).source ?? ""),
      status: String((row as any).status ?? ""),
      checkin_date: String((row as any).checkin_date ?? ""),
      checkout_date: String((row as any).checkout_date ?? ""),
      checked_in_at: (row as any).checked_in_at ? String((row as any).checked_in_at) : null,
      do_not_move_assigned_room: Boolean((row as any).do_not_move_assigned_room),
      rate_plan_id: (row as any).rate_plan_id ? String((row as any).rate_plan_id) : null,
      total_price: round2(toNumber((row as any).total_price)),
      nights: (nightsByReservation.get(reservationId) ?? []).sort((left, right) =>
        left.stay_date.localeCompare(right.stay_date)
      ),
    });
  }

  for (const id of uniqueIds) {
    if (!map.has(id)) {
      throw new RoomPlannerEngineError(`Reservation ${id} not found.`, 404);
    }
  }

  return map;
}

async function loadRoomsByIds(supabase: SupabaseLike, roomIds: string[]): Promise<Map<string, RoomRow>> {
  const uniqueIds = Array.from(new Set(roomIds.filter(Boolean)));
  if (uniqueIds.length === 0) return new Map();

  const { data, error } = await supabase
    .from("rooms")
    .select("id, room_number, room_type_id, is_sellable, is_dayuse")
    .in("id", uniqueIds);

  if (error) {
    throw new RoomPlannerEngineError(error.message ?? "Failed to load rooms.", 500);
  }

  const map = new Map<string, RoomRow>();
  for (const row of data ?? []) {
    const id = String((row as any).id ?? "");
    if (!id) continue;
    map.set(id, {
      id,
      room_number: String((row as any).room_number ?? ""),
      room_type_id: Number((row as any).room_type_id ?? 0),
      is_sellable: Boolean((row as any).is_sellable),
      is_dayuse: Boolean((row as any).is_dayuse),
    });
  }

  return map;
}

async function loadRatePlanNames(supabase: SupabaseLike, ratePlanIds: string[]) {
  const uniqueIds = Array.from(new Set(ratePlanIds.filter(Boolean)));
  const map = new Map<string, string>();
  if (uniqueIds.length === 0) return map;

  const { data, error } = await supabase
    .from("rate_plans")
    .select("id, name_en")
    .in("id", uniqueIds);
  if (error) {
    throw new RoomPlannerEngineError(error.message ?? "Failed to load rate plans.", 500);
  }

  for (const row of data ?? []) {
    const id = String((row as any).id ?? "");
    if (!id) continue;
    map.set(id, String((row as any).name_en ?? ""));
  }

  return map;
}

async function computeRackRatesByStayDate(params: {
  supabase: SupabaseLike;
  roomTypeId: number;
  stayDates: string[];
}): Promise<Map<string, number>> {
  const { supabase, roomTypeId, stayDates } = params;
  const result = new Map<string, number>();
  if (!Number.isFinite(roomTypeId) || roomTypeId <= 0 || stayDates.length === 0) return result;

  const { data: roomRows, error: roomError } = await supabase
    .from("rooms")
    .select("id")
    .eq("room_type_id", roomTypeId)
    .eq("is_sellable", true);

  if (roomError) {
    throw new RoomPlannerEngineError(roomError.message ?? "Failed to load room set for rate lookup.", 500);
  }
  const roomIds = (roomRows ?? []).map((row: any) => String(row.id ?? "")).filter(Boolean);
  if (roomIds.length === 0) {
    return result;
  }

  const { data: rateRows, error: rateError } = await supabase
    .from("rate_templates")
    .select("stay_date, price, room_id")
    .in("room_id", roomIds)
    .in("stay_date", stayDates);

  if (rateError) {
    throw new RoomPlannerEngineError(rateError.message ?? "Failed to load rack rates.", 500);
  }

  const byDate = new Map<string, number[]>();
  for (const row of rateRows ?? []) {
    const stayDate = String((row as any).stay_date ?? "");
    if (!stayDate) continue;
    const list = byDate.get(stayDate) ?? [];
    list.push(toNumber((row as any).price));
    byDate.set(stayDate, list);
  }

  for (const stayDate of stayDates) {
    const values = byDate.get(stayDate) ?? [];
    if (values.length === 0) continue;
    const avg = values.reduce((sum, value) => sum + value, 0) / values.length;
    result.set(stayDate, round2(avg));
  }

  return result;
}

function normalizeOverrides(overrides: RoomPlannerNightOverride[] | null | undefined) {
  const map = new Map<string, number>();
  for (const row of overrides ?? []) {
    const stayDate = String(row.stay_date ?? "");
    const nightlyPrice = round2(toNumber(row.nightly_price));
    if (!isValidDateString(stayDate)) {
      throw new RoomPlannerEngineError(`Invalid override stay_date: ${stayDate}`, 400);
    }
    if (!Number.isFinite(nightlyPrice) || nightlyPrice < 0) {
      throw new RoomPlannerEngineError(`Invalid override nightly_price on ${stayDate}.`, 400);
    }
    map.set(stayDate, nightlyPrice);
  }
  return map;
}

function ensureActionBasics(action: RoomPlannerActionInput) {
  if (!action.reservation_id) {
    throw new RoomPlannerEngineError("reservation_id is required.", 400);
  }
  if (action.type === "MOVE_WHOLE" || action.type === "ASSIGN") {
    if (!action.to_room_id) {
      throw new RoomPlannerEngineError(`${action.type} requires to_room_id.`, 400);
    }
  }
}

function ensureReservationGuards(params: {
  action: RoomPlannerActionInput;
  context: ReservationContext;
}) {
  const { action, context } = params;
  if (context.status !== "active") {
    throw new RoomPlannerEngineError(
      `Reservation ${context.booking_code ?? context.id} is not active.`,
      409
    );
  }

  if ((action.type === "MOVE_WHOLE" || action.type === "UNASSIGN") && context.do_not_move_assigned_room) {
    throw new RoomPlannerEngineError(
      `Reservation ${context.booking_code ?? context.id} is locked (Do Not Move).`,
      409
    );
  }

  if (action.type === "UNASSIGN" && context.checked_in_at) {
    throw new RoomPlannerEngineError(
      `Cannot unassign ${context.booking_code ?? context.id}: guest is checked in. Use Move Room.`,
      409
    );
  }
}

function assertTargetRoomUsable(room: RoomRow | undefined, roomId: string) {
  if (!room) throw new RoomPlannerEngineError(`Target room ${roomId} not found.`, 404);
  if (!room.is_sellable || room.is_dayuse) {
    throw new RoomPlannerEngineError(`Target room ${room.room_number} is not available for overnight stays.`, 400);
  }
}

function buildActionPreviewFallback(actionIndex: number, context: ReservationContext): ActionPricingPreview {
  return {
    action_index: actionIndex,
    reservation_id: context.id,
    source: normalizeSource(context.source),
    current_total: 0,
    new_total: 0,
    delta: 0,
    nights: [],
  };
}

async function computeMovePricing(params: {
  supabase: SupabaseLike;
  action: RoomPlannerActionInput;
  context: ReservationContext;
  targetRoom: RoomRow;
  affectedNights: ReservationNightRow[];
  ratePlanNamesById: Map<string, string>;
}): Promise<PricingComputation> {
  const { supabase, action, context, targetRoom, affectedNights, ratePlanNamesById } = params;

  const bookingSource = normalizeSource(context.source);
  const previewNights: PricingPreviewNight[] = affectedNights.map((night) => ({
    stay_date: night.stay_date,
    current_price: round2(toNumber(night.nightly_price)),
    new_price: round2(toNumber(night.nightly_price)),
    is_ota: isOtaSource(bookingSource),
    editable: isOtaSource(bookingSource),
  }));
  const byStayDate = new Map<string, number>(previewNights.map((night) => [night.stay_date, night.new_price]));

  let ratePlanName: string | undefined = undefined;
  const overrides = normalizeOverrides(action.ota_night_overrides);
  if (!isOtaSource(bookingSource) && overrides.size > 0) {
    throw new RoomPlannerEngineError(
      `Reservation ${context.booking_code ?? context.id} is not OTA. ota_night_overrides is not allowed.`,
      400
    );
  }

  if (isOtaSource(bookingSource)) {
    for (const [stayDate, nightlyPrice] of overrides.entries()) {
      const current = byStayDate.get(stayDate);
      if (current === undefined) {
        throw new RoomPlannerEngineError(
          `OTA override date ${stayDate} is outside move range for ${context.booking_code ?? context.id}.`,
          400
        );
      }
      byStayDate.set(stayDate, nightlyPrice);
    }
  } else if (isWalkInLikeSource(bookingSource)) {
    if (context.rate_plan_id) {
      const checkinDate = affectedNights[0].stay_date;
      const checkoutDate = addDays(affectedNights[affectedNights.length - 1].stay_date, 1);
      const applied = await calculateAppliedRateNights({
        supabase,
        roomTypeId: targetRoom.room_type_id,
        checkinDate,
        checkoutDate,
        ratePlanId: context.rate_plan_id,
      });
      for (const row of applied.nights) {
        byStayDate.set(row.stay_date, round2(toNumber(row.applied_rate)));
      }
      ratePlanName = ratePlanNamesById.get(context.rate_plan_id) ?? undefined;
    } else {
      const stayDates = affectedNights.map((night) => night.stay_date);
      const rackMap = await computeRackRatesByStayDate({
        supabase,
        roomTypeId: targetRoom.room_type_id,
        stayDates,
      });
      for (const stayDate of stayDates) {
        const current = byStayDate.get(stayDate) ?? 0;
        byStayDate.set(stayDate, rackMap.get(stayDate) ?? current);
      }
    }
  }

  const mergedNights = previewNights.map((night) => ({
    ...night,
    new_price: round2(byStayDate.get(night.stay_date) ?? night.current_price),
  }));
  const currentTotal = round2(mergedNights.reduce((sum, night) => sum + night.current_price, 0));
  const newTotal = round2(mergedNights.reduce((sum, night) => sum + night.new_price, 0));

  return {
    byStayDate: new Map(mergedNights.map((night) => [night.stay_date, night.new_price])),
    nights: mergedNights,
    currentTotal,
    newTotal,
    delta: round2(newTotal - currentTotal),
    ratePlanName,
  };
}

async function buildMovePreview(params: {
  supabase: SupabaseLike;
  actionIndex: number;
  action: RoomPlannerActionInput;
  context: ReservationContext;
  targetRoom: RoomRow;
  affectedNights: ReservationNightRow[];
  ratePlanNamesById: Map<string, string>;
}): Promise<ActionPricingPreview> {
  const pricing = await computeMovePricing({
    supabase: params.supabase,
    action: params.action,
    context: params.context,
    targetRoom: params.targetRoom,
    affectedNights: params.affectedNights,
    ratePlanNamesById: params.ratePlanNamesById,
  });
  return {
    action_index: params.actionIndex,
    reservation_id: params.context.id,
    source: normalizeSource(params.context.source),
    current_total: pricing.currentTotal,
    new_total: pricing.newTotal,
    delta: pricing.delta,
    nights: pricing.nights,
    rate_plan_name: pricing.ratePlanName,
  };
}

function buildOccupancyKey(stayDate: string, roomId: string) {
  return `${stayDate}|${roomId}`;
}

async function validateDraftMergedState(params: {
  supabase: SupabaseLike;
  actions: RoomPlannerActionInput[];
  contexts: Map<string, ReservationContext>;
  businessDate: string;
}) {
  const { supabase, actions, contexts, businessDate } = params;
  const affectedDates: string[] = [];
  for (const action of actions) {
    const context = contexts.get(action.reservation_id);
    if (!context) continue;
    const nights = buildAffectedNights(context, businessDate);
    affectedDates.push(...nights.map((night) => night.stay_date));
  }

  if (affectedDates.length === 0) return;
  const minDate = [...affectedDates].sort()[0];
  const maxDate = [...affectedDates].sort().slice(-1)[0];
  const checkoutBound = addDays(maxDate, 1);

  const { data: rows, error } = await supabase
    .from("reservation_nights")
    .select(`
      reservation_id,
      stay_date,
      room_id,
      reservations!inner(status, is_dayuse)
    `)
    .gte("stay_date", minDate)
    .lt("stay_date", checkoutBound)
    .is("cancelled_at", null)
    .eq("reservations.status", "active")
    .eq("reservations.is_dayuse", false)
    .not("room_id", "is", null);

  if (error) {
    throw new RoomPlannerEngineError(error.message ?? "Failed to validate room planner draft.", 500);
  }

  const occupancy = new Map<string, string>();
  for (const row of rows ?? []) {
    const reservationId = String((row as any).reservation_id ?? "");
    const stayDate = String((row as any).stay_date ?? "");
    const roomId = String((row as any).room_id ?? "");
    if (!reservationId || !stayDate || !roomId) continue;
    occupancy.set(buildOccupancyKey(stayDate, roomId), reservationId);
  }

  const roomByReservationAndNight = new Map<string, Map<string, string | null>>();
  for (const [reservationId, context] of contexts.entries()) {
    const map = new Map<string, string | null>();
    for (const night of context.nights) {
      map.set(night.stay_date, night.room_id);
    }
    roomByReservationAndNight.set(reservationId, map);
  }

  for (let actionIndex = 0; actionIndex < actions.length; actionIndex += 1) {
    const action = actions[actionIndex];
    const context = contexts.get(action.reservation_id);
    if (!context) continue;

    const affectedNights = buildAffectedNights(context, businessDate);
    if (affectedNights.length === 0) continue;
    const perNightMap = roomByReservationAndNight.get(context.id) ?? new Map<string, string | null>();
    roomByReservationAndNight.set(context.id, perNightMap);
    const targetRoomId =
      action.type === "MOVE_WHOLE" || action.type === "ASSIGN"
        ? String(action.to_room_id ?? "")
        : null;

    for (const night of affectedNights) {
      const stayDate = night.stay_date;
      const currentRoomId = perNightMap.get(stayDate) ?? null;
      if (currentRoomId) {
        const currentKey = buildOccupancyKey(stayDate, currentRoomId);
        const owner = occupancy.get(currentKey);
        if (owner === context.id) occupancy.delete(currentKey);
      }

      if (targetRoomId) {
        const targetKey = buildOccupancyKey(stayDate, targetRoomId);
        const owner = occupancy.get(targetKey);
        if (owner && owner !== context.id) {
          throw new RoomPlannerEngineError(
            `Draft conflict at action ${actionIndex}: room already occupied on ${stayDate}.`,
            409
          );
        }
        occupancy.set(targetKey, context.id);
      }

      perNightMap.set(stayDate, targetRoomId);
    }
  }
}

async function captureReservationSnapshot(
  supabase: SupabaseLike,
  reservationId: string
): Promise<ReservationSnapshot> {
  const { data: reservation, error: reservationError } = await supabase
    .from("reservations")
    .select("id, total_price")
    .eq("id", reservationId)
    .maybeSingle();
  if (reservationError) {
    throw new RoomPlannerEngineError(reservationError.message ?? "Failed to capture reservation snapshot.", 500);
  }
  if (!reservation) {
    throw new RoomPlannerEngineError(`Reservation ${reservationId} not found.`, 404);
  }

  const { data: nights, error: nightsError } = await supabase
    .from("reservation_nights")
    .select(`
      reservation_id,
      stay_date,
      room_id,
      room_type_id,
      nightly_price,
      is_ota,
      assignment_source,
      dependency_plan_id,
      dependency_reason
    `)
    .eq("reservation_id", reservationId)
    .is("cancelled_at", null)
    .order("stay_date", { ascending: true });
  if (nightsError) {
    throw new RoomPlannerEngineError(nightsError.message ?? "Failed to capture reservation nights.", 500);
  }

  return {
    reservation_id: reservationId,
    total_price: round2(toNumber((reservation as any).total_price)),
    nights: (nights ?? []).map((row: any) => ({
      reservation_id: String(row.reservation_id ?? reservationId),
      stay_date: String(row.stay_date ?? ""),
      room_id: row.room_id ? String(row.room_id) : null,
      room_type_id: Number.isFinite(Number(row.room_type_id)) ? Number(row.room_type_id) : null,
      nightly_price: round2(toNumber(row.nightly_price)),
      is_ota: Boolean(row.is_ota),
      assignment_source: row.assignment_source ? String(row.assignment_source) : null,
      dependency_plan_id: row.dependency_plan_id ? String(row.dependency_plan_id) : null,
      dependency_reason: row.dependency_reason ? String(row.dependency_reason) : null,
    })),
  };
}

async function restoreReservationSnapshot(
  supabase: SupabaseLike,
  snapshot: ReservationSnapshot
): Promise<void> {
  const cancelledAt = new Date().toISOString();

  const { error: cancelError } = await supabase
    .from("reservation_nights")
    .update({ cancelled_at: cancelledAt })
    .eq("reservation_id", snapshot.reservation_id)
    .is("cancelled_at", null);
  if (cancelError) {
    throw new RoomPlannerEngineError(cancelError.message ?? "Failed to rollback reservation nights.", 500);
  }

  if (snapshot.nights.length > 0) {
    const rows = snapshot.nights.map((row) => ({
      reservation_id: snapshot.reservation_id,
      stay_date: row.stay_date,
      room_id: row.room_id,
      room_type_id: row.room_type_id,
      nightly_price: row.nightly_price,
      is_ota: row.is_ota,
      assignment_source: row.assignment_source,
      dependency_plan_id: row.dependency_plan_id,
      dependency_reason: row.dependency_reason,
    }));
    const { error: insertError } = await supabase
      .from("reservation_nights")
      .insert(rows);
    if (insertError) {
      throw new RoomPlannerEngineError(insertError.message ?? "Failed to restore reservation nights.", 500);
    }
  }

  const { error: reservationError } = await supabase
    .from("reservations")
    .update({ total_price: snapshot.total_price })
    .eq("id", snapshot.reservation_id);
  if (reservationError) {
    throw new RoomPlannerEngineError(reservationError.message ?? "Failed to restore reservation total.", 500);
  }

  await syncReservationNightDependencyMetadata(supabase as any, {
    reservationId: snapshot.reservation_id,
  });
}

async function recomputeReservationTotalPrice(
  supabase: SupabaseLike,
  reservationId: string
): Promise<number> {
  const { data: nights, error: nightsError } = await supabase
    .from("reservation_nights")
    .select("nightly_price")
    .eq("reservation_id", reservationId)
    .is("cancelled_at", null);
  if (nightsError) {
    throw new RoomPlannerEngineError(nightsError.message ?? "Failed to recompute reservation total.", 500);
  }

  const nextTotal = round2((nights ?? []).reduce((sum: number, row: any) => sum + toNumber(row?.nightly_price), 0));
  const { error: updateError } = await supabase
    .from("reservations")
    .update({ total_price: nextTotal })
    .eq("id", reservationId);
  if (updateError) {
    throw new RoomPlannerEngineError(updateError.message ?? "Failed to update reservation total.", 500);
  }
  return nextTotal;
}

async function updateNightlyPrices(params: {
  supabase: SupabaseLike;
  reservationId: string;
  nightlyPricesByDate: Map<string, number>;
}) {
  const { supabase, reservationId, nightlyPricesByDate } = params;
  for (const [stayDate, nightlyPrice] of nightlyPricesByDate.entries()) {
    const { error } = await supabase
      .from("reservation_nights")
      .update({ nightly_price: round2(nightlyPrice) })
      .eq("reservation_id", reservationId)
      .eq("stay_date", stayDate)
      .is("cancelled_at", null);
    if (error) {
      throw new RoomPlannerEngineError(error.message ?? `Failed to update nightly price for ${stayDate}.`, 500);
    }
  }
}

async function executeAssignAction(params: {
  supabase: SupabaseLike;
  action: RoomPlannerActionInput;
  context: ReservationContext;
  targetRoom: RoomRow;
  businessDate: string;
  actorUserId: string;
}) {
  const { supabase, action, context, targetRoom, businessDate, actorUserId } = params;
  const affected = buildAffectedNights(context, businessDate);
  if (affected.length === 0) {
    throw new RoomPlannerEngineError(`No future nights to assign for ${context.booking_code ?? context.id}.`, 409);
  }

  const checkinDate = affected[0].stay_date;
  const checkoutDate = addDays(affected[affected.length - 1].stay_date, 1);
  await assertRoomAvailableForDateRange(supabase as any, {
    roomId: targetRoom.id,
    checkinDate,
    checkoutDate,
    excludeReservationId: context.id,
  });

  const stayDates = buildStayDatesFromNights(affected);
  const { error: updateError } = await supabase
    .from("reservation_nights")
    .update({
      room_id: targetRoom.id,
      room_type_id: targetRoom.room_type_id,
      assignment_source: "manual",
      dependency_plan_id: null,
      dependency_reason: null,
    })
    .eq("reservation_id", context.id)
    .is("cancelled_at", null)
    .in("stay_date", stayDates);

  if (updateError) {
    throw new RoomPlannerEngineError(updateError.message ?? "Failed to assign room.", 500);
  }

  await appendReservationNoteLine(
    supabase as any,
    context.id,
    `[ROOM PLANNER ASSIGN ${businessDate}] -> Room ${targetRoom.room_number} | nights=${stayDates.length}`
  );

  await supabase.from("audit_logs").insert({
    actor_user_id: actorUserId,
    action: "room_planner_assign",
    entity_type: "reservation",
    entity_id: context.id,
    before_json: {
      reservation_id: context.id,
      stay_dates: stayDates,
    },
    after_json: {
      reservation_id: context.id,
      room_id: targetRoom.id,
      room_number: targetRoom.room_number,
      room_type_id: targetRoom.room_type_id,
      stay_dates: stayDates,
    },
    business_date: businessDate,
    source: normalizeAuditSource("manual"),
  });

  return {
    reservation_id: context.id,
    booking_code: context.booking_code,
    action: "ASSIGN",
    to_room_number: targetRoom.room_number,
    nights_affected: stayDates.length,
  };
}

async function executeUnassignAction(params: {
  supabase: SupabaseLike;
  context: ReservationContext;
  businessDate: string;
  actorUserId: string;
}) {
  const { supabase, context, businessDate, actorUserId } = params;
  const affected = buildAffectedNights(context, businessDate);
  if (affected.length === 0) {
    throw new RoomPlannerEngineError(`No future nights to unassign for ${context.booking_code ?? context.id}.`, 409);
  }
  const stayDates = buildStayDatesFromNights(affected);

  const { error: updateError } = await supabase
    .from("reservation_nights")
    .update({
      room_id: null,
      assignment_source: "manual",
      dependency_plan_id: null,
      dependency_reason: null,
    })
    .eq("reservation_id", context.id)
    .is("cancelled_at", null)
    .in("stay_date", stayDates);
  if (updateError) {
    throw new RoomPlannerEngineError(updateError.message ?? "Failed to unassign room.", 500);
  }

  await appendReservationNoteLine(
    supabase as any,
    context.id,
    `[ROOM PLANNER UNASSIGN ${businessDate}] room cleared | nights=${stayDates.length}`
  );

  await supabase.from("audit_logs").insert({
    actor_user_id: actorUserId,
    action: "room_planner_unassign",
    entity_type: "reservation",
    entity_id: context.id,
    before_json: {
      reservation_id: context.id,
      stay_dates: stayDates,
    },
    after_json: {
      reservation_id: context.id,
      room_id: null,
      stay_dates: stayDates,
    },
    business_date: businessDate,
    source: normalizeAuditSource("manual"),
  });

  return {
    reservation_id: context.id,
    booking_code: context.booking_code,
    action: "UNASSIGN",
    nights_affected: stayDates.length,
  };
}

async function executeMoveAction(params: {
  supabase: SupabaseLike;
  action: RoomPlannerActionInput;
  context: ReservationContext;
  targetRoom: RoomRow;
  businessDate: string;
  actorUserId: string;
  ratePlanNamesById: Map<string, string>;
}) {
  const { supabase, action, context, targetRoom, businessDate, actorUserId, ratePlanNamesById } = params;
  const affected = buildAffectedNights(context, businessDate);
  if (affected.length === 0) {
    throw new RoomPlannerEngineError(`No future nights to move for ${context.booking_code ?? context.id}.`, 409);
  }

  const pricing = await computeMovePricing({
    supabase,
    action,
    context,
    targetRoom,
    affectedNights: affected,
    ratePlanNamesById,
  });

  const moveStartDate = affected[0].stay_date;
  const moveResult = await executeRoomMove({
    supabase: supabase as any,
    reservationId: context.id,
    newRoomId: targetRoom.id,
    reason: "Room Planner batch move",
    pricingPolicy: "keep_rtc",
    discountType: "percent",
    discountValue: 0,
    startDate: moveStartDate,
    endDate: null,
    notePrefix: "Room Planner Move",
    noteSuffix: null,
    auditAction: "room_planner_move",
    auditSource: "manual",
    appendNoteLine: true,
    markOldRoomDirty: true,
  });

  await updateNightlyPrices({
    supabase,
    reservationId: context.id,
    nightlyPricesByDate: pricing.byStayDate,
  });

  const reservationTotal = await recomputeReservationTotalPrice(supabase, context.id);
  await appendReservationNoteLine(
    supabase as any,
    context.id,
    `[ROOM PLANNER PRICE ${businessDate}] policy=${isOtaSource(context.source) ? "ota_override" : context.rate_plan_id ? "rate_plan" : "rate_grid"} | Δ=${pricing.delta >= 0 ? "+" : "-"}฿${Math.abs(pricing.delta).toLocaleString("th-TH", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
  );

  await supabase.from("audit_logs").insert({
    actor_user_id: actorUserId,
    action: "room_planner_reprice",
    entity_type: "reservation",
    entity_id: context.id,
    before_json: {
      reservation_id: context.id,
      source: normalizeSource(context.source),
      current_total: pricing.currentTotal,
    },
    after_json: {
      reservation_id: context.id,
      new_total: pricing.newTotal,
      delta: pricing.delta,
      rate_plan_name: pricing.ratePlanName ?? null,
      move_to_room: targetRoom.room_number,
      reservation_total_price: reservationTotal,
      move_payload: {
        action_pricing_policy: action.pricing_policy ?? null,
        ota_night_overrides: action.ota_night_overrides ?? [],
      },
      move_result: moveResult,
    },
    business_date: businessDate,
    source: normalizeAuditSource("manual"),
  });

  return {
    reservation_id: context.id,
    booking_code: context.booking_code,
    action: "MOVE_WHOLE",
    to_room_number: targetRoom.room_number,
    nights_affected: affected.length,
    current_total: pricing.currentTotal,
    new_total: pricing.newTotal,
    delta: pricing.delta,
  };
}

async function applyAction(
  supabase: SupabaseLike,
  params: {
    actionIndex: number;
    action: RoomPlannerActionInput;
    contexts: Map<string, ReservationContext>;
    roomsById: Map<string, RoomRow>;
    businessDate: string;
    actorUserId: string;
    ratePlanNamesById: Map<string, string>;
  }
) {
  const { action, contexts, roomsById, businessDate, actorUserId, ratePlanNamesById } = params;
  ensureActionBasics(action);
  const context = contexts.get(action.reservation_id);
  if (!context) {
    throw new RoomPlannerEngineError(`Reservation ${action.reservation_id} not found.`, 404);
  }
  ensureReservationGuards({ action, context });

  if (action.type === "ASSIGN") {
    const roomId = String(action.to_room_id ?? "");
    const targetRoom = roomsById.get(roomId);
    assertTargetRoomUsable(targetRoom, roomId);
    return executeAssignAction({
      supabase,
      action,
      context,
      targetRoom: targetRoom!,
      businessDate,
      actorUserId,
    });
  }

  if (action.type === "MOVE_WHOLE") {
    const roomId = String(action.to_room_id ?? "");
    const targetRoom = roomsById.get(roomId);
    assertTargetRoomUsable(targetRoom, roomId);
    return executeMoveAction({
      supabase,
      action,
      context,
      targetRoom: targetRoom!,
      businessDate,
      actorUserId,
      ratePlanNamesById,
    });
  }

  return executeUnassignAction({
    supabase,
    context,
    businessDate,
    actorUserId,
  });
}

export async function previewRoomPlannerActions(params: {
  supabase: SupabaseLike;
  actions: RoomPlannerActionInput[];
}): Promise<RoomPlannerPreviewResult> {
  const { supabase, actions } = params;
  if (!Array.isArray(actions) || actions.length === 0) {
    throw new RoomPlannerEngineError("actions is required.", 400);
  }

  const reservationIds = actions.map((action) => action.reservation_id);
  const contexts = await loadReservationContexts(supabase, reservationIds);
  const targetRoomIds = actions
    .filter((action) => action.type === "MOVE_WHOLE" || action.type === "ASSIGN")
    .map((action) => String(action.to_room_id ?? ""));
  const roomsById = await loadRoomsByIds(supabase, targetRoomIds);
  const ratePlanIds = Array.from(contexts.values())
    .map((context) => context.rate_plan_id)
    .filter((id): id is string => Boolean(id));
  const ratePlanNamesById = await loadRatePlanNames(supabase, ratePlanIds);
  const businessDate = toBangkokDateString();

  for (const action of actions) {
    ensureActionBasics(action);
    const context = contexts.get(action.reservation_id);
    if (!context) throw new RoomPlannerEngineError(`Reservation ${action.reservation_id} not found.`, 404);
    ensureReservationGuards({ action, context });
    if (action.type === "MOVE_WHOLE" || action.type === "ASSIGN") {
      const roomId = String(action.to_room_id ?? "");
      assertTargetRoomUsable(roomsById.get(roomId), roomId);
    }
  }

  await validateDraftMergedState({
    supabase,
    actions,
    contexts,
    businessDate,
  });

  const previews: ActionPricingPreview[] = [];
  const warnings: string[] = [];

  for (let actionIndex = 0; actionIndex < actions.length; actionIndex += 1) {
    const action = actions[actionIndex];
    const context = contexts.get(action.reservation_id);
    if (!context) continue;
    const affected = buildAffectedNights(context, businessDate);
    if (affected.length === 0) {
      previews.push(buildActionPreviewFallback(actionIndex, context));
      warnings.push(`Action ${actionIndex}: no future nights affected for ${context.booking_code ?? context.id}.`);
      continue;
    }

    if (action.type === "MOVE_WHOLE") {
      const targetRoom = roomsById.get(String(action.to_room_id ?? ""));
      assertTargetRoomUsable(targetRoom, String(action.to_room_id ?? ""));
      previews.push(
        await buildMovePreview({
          supabase,
          actionIndex,
          action,
          context,
          targetRoom: targetRoom!,
          affectedNights: affected,
          ratePlanNamesById,
        })
      );
      continue;
    }

    previews.push({
      action_index: actionIndex,
      reservation_id: context.id,
      source: normalizeSource(context.source),
      current_total: 0,
      new_total: 0,
      delta: 0,
      nights: [],
    });
  }

  return {
    previews,
    warnings,
  };
}

export async function commitRoomPlannerActions(params: {
  supabase: SupabaseLike;
  actions: RoomPlannerActionInput[];
  actorUserId: string;
}): Promise<RoomPlannerCommitResult> {
  const { supabase, actions, actorUserId } = params;
  if (!Array.isArray(actions) || actions.length === 0) {
    throw new RoomPlannerEngineError("actions is required.", 400);
  }
  if (!actorUserId) {
    throw new RoomPlannerEngineError("actor_user_id is required.", 400);
  }

  const reservationIds = actions.map((action) => action.reservation_id);
  const contexts = await loadReservationContexts(supabase, reservationIds);
  const targetRoomIds = actions
    .filter((action) => action.type === "MOVE_WHOLE" || action.type === "ASSIGN")
    .map((action) => String(action.to_room_id ?? ""));
  const roomsById = await loadRoomsByIds(supabase, targetRoomIds);
  const ratePlanIds = Array.from(contexts.values())
    .map((context) => context.rate_plan_id)
    .filter((id): id is string => Boolean(id));
  const ratePlanNamesById = await loadRatePlanNames(supabase, ratePlanIds);
  const businessDate = toBangkokDateString();

  for (const action of actions) {
    ensureActionBasics(action);
    const context = contexts.get(action.reservation_id);
    if (!context) throw new RoomPlannerEngineError(`Reservation ${action.reservation_id} not found.`, 404);
    ensureReservationGuards({ action, context });
    if (action.type === "MOVE_WHOLE" || action.type === "ASSIGN") {
      const roomId = String(action.to_room_id ?? "");
      assertTargetRoomUsable(roomsById.get(roomId), roomId);
    }
  }

  await validateDraftMergedState({
    supabase,
    actions,
    contexts,
    businessDate,
  });

  const executed: ExecutedActionResult[] = [];
  const failed: FailedActionResult[] = [];
  const rolledBack: number[] = [];
  const warnings: string[] = [];
  const snapshots: Array<{ actionIndex: number; snapshot: ReservationSnapshot }> = [];

  for (let actionIndex = 0; actionIndex < actions.length; actionIndex += 1) {
    const action = actions[actionIndex];
    const reservationId = action.reservation_id;

    try {
      const snapshot = await captureReservationSnapshot(supabase, reservationId);
      snapshots.push({ actionIndex, snapshot });

      const result = await applyAction(supabase, {
        actionIndex,
        action,
        contexts,
        roomsById,
        businessDate,
        actorUserId,
        ratePlanNamesById,
      });

      executed.push({
        action_index: actionIndex,
        result: result as Record<string, unknown>,
      });

      const refreshed = await loadReservationContexts(supabase, [reservationId]);
      const nextContext = refreshed.get(reservationId);
      if (nextContext) {
        contexts.set(reservationId, nextContext);
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      failed.push({
        action_index: actionIndex,
        error: message,
      });
      break;
    }
  }

  if (failed.length > 0) {
    for (let i = snapshots.length - 1; i >= 0; i -= 1) {
      const snapshotRef = snapshots[i];
      try {
        await restoreReservationSnapshot(supabase, snapshotRef.snapshot);
        rolledBack.push(snapshotRef.actionIndex);
      } catch (rollbackError) {
        warnings.push(
          `Rollback failed for action ${snapshotRef.actionIndex}: ${rollbackError instanceof Error ? rollbackError.message : String(rollbackError)}`
        );
      }
    }

    return {
      success: false,
      executed,
      failed,
      rolled_back: rolledBack.sort((left, right) => left - right),
      warnings,
    };
  }

  return {
    success: true,
    executed,
    failed,
    rolled_back: [],
    warnings,
  };
}
