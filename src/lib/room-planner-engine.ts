import { addDays, compareDateStrings, isValidDateString } from "@/lib/dates";
import { normalizeAuditSource } from "@/lib/audit-utils";
import {
  appendReservationNoteLine,
  assertRoomAvailableForDateRange,
  syncReservationNightDependencyMetadata,
} from "@/lib/planned-room-moves";
import { executeRoomMove } from "@/lib/room-move";
import { calculateAppliedRateNights } from "@/lib/rate-plan-pricing";
import { markRoomDirtyTask } from "@/lib/hk-dirty";
import { resolveBusinessDate, toLocalDate } from "@/lib/folio-fees";

type SupabaseLike = {
  from: (table: string) => any;
};

async function resolvePlannerBusinessDate(supabase: SupabaseLike): Promise<string> {
  return resolveBusinessDate(supabase as any, toLocalDate(new Date(), "Asia/Bangkok"));
}

export type RoomPlannerActionType =
  | "MOVE_WHOLE"
  | "ASSIGN"
  | "UNASSIGN"
  | "MOVE_NIGHTS"
  | "EXTEND"
  | "SHORTEN";
export type RoomPlannerPricingPolicy = "keep_rtc" | "reprice_grid";

export type RoomPlannerNightOverride = {
  stay_date: string;
  nightly_price: number;
};

export type RoomPlannerActionInput = {
  type: RoomPlannerActionType;
  reservation_id: string;
  from_room_id?: string | null;
  to_room_id?: string | null;
  pricing_policy?: RoomPlannerPricingPolicy;
  ota_night_overrides?: RoomPlannerNightOverride[] | null;
  swap_pair_id?: string | null;
  linked_root_id?: string | null;
  linked_reservation_ids?: string[] | null;
  affected_nights?: string[] | null;
  new_checkout_date?: string | null;
  new_checkin_date?: string | null;
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
  parent_reservation_id: string | null;
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
  action_type: RoomPlannerActionType;
  reservation_id: string;
  booking_code?: string | null;
  guest_name?: string | null;
  source: string;
  current_total: number;
  new_total: number;
  delta: number;
  nights: PricingPreviewNight[];
  rate_plan_name?: string;
  from_room_number?: string;
  to_room_number?: string;
  affected_nights?: string[];
  nights_added?: PricingPreviewNight[];
  nights_removed?: PricingPreviewNight[];
  original_checkout?: string;
  new_checkout?: string;
  original_checkin?: string;
  new_checkin?: string;
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
  if (actionType === "MOVE_NIGHTS") return "MOVE_NIGHTS";
  if (actionType === "EXTEND") return "EXTEND";
  if (actionType === "SHORTEN") return "SHORTEN";
  if (actionType === "ASSIGN") return "ASSIGN";
  return "UNASSIGN";
}

function buildStayDatesFromNights(nights: ReservationNightRow[]): string[] {
  return nights.map((row) => row.stay_date).sort();
}

function dedupeAndSortDates(stayDates: Array<string | null | undefined>): string[] {
  return Array.from(new Set(stayDates.map((row) => String(row ?? "").trim()).filter(Boolean))).sort();
}

function listNightDates(checkinDate: string, checkoutDate: string): string[] {
  if (!isValidDateString(checkinDate) || !isValidDateString(checkoutDate)) return [];
  if (compareDateStrings(checkoutDate, checkinDate) <= 0) return [];
  const dates: string[] = [];
  let cursor = checkinDate;
  while (compareDateStrings(cursor, checkoutDate) < 0) {
    dates.push(cursor);
    cursor = addDays(cursor, 1);
  }
  return dates;
}

function buildAffectedNights(context: ReservationContext, businessDate: string): ReservationNightRow[] {
  return context.nights
    .filter((night) => compareDateStrings(night.stay_date, businessDate) >= 0)
    .sort((left, right) => left.stay_date.localeCompare(right.stay_date));
}

function buildMoveNightRows(params: {
  action: RoomPlannerActionInput;
  context: ReservationContext;
  businessDate: string;
}): ReservationNightRow[] {
  const { action, context, businessDate } = params;
  const requestedDates = dedupeAndSortDates((action.affected_nights ?? []) as string[]);
  if (requestedDates.length === 0) {
    throw new RoomPlannerEngineError("MOVE_NIGHTS requires affected_nights.", 400);
  }

  const byDate = new Map(context.nights.map((night) => [night.stay_date, night]));
  const selected: ReservationNightRow[] = [];
  for (const stayDate of requestedDates) {
    if (!isValidDateString(stayDate)) {
      throw new RoomPlannerEngineError(`Invalid affected night: ${stayDate}`, 400);
    }
    const night = byDate.get(stayDate);
    if (!night) {
      throw new RoomPlannerEngineError(
        `Night ${stayDate} is not part of reservation ${context.booking_code ?? context.id}.`,
        400
      );
    }
    if (compareDateStrings(stayDate, businessDate) < 0) {
      throw new RoomPlannerEngineError(
        `Cannot move historical night ${stayDate} for ${context.booking_code ?? context.id}.`,
        409
      );
    }
    selected.push(night);
  }
  return selected.sort((left, right) => left.stay_date.localeCompare(right.stay_date));
}

function resolveEdgeNightRows(context: ReservationContext) {
  const nights = [...context.nights].sort((left, right) => left.stay_date.localeCompare(right.stay_date));
  return {
    firstNight: nights[0] ?? null,
    lastNight: nights[nights.length - 1] ?? null,
  };
}

function isOtaSource(source: string): boolean {
  return normalizeSource(source) === "ota";
}

function isWalkInLikeSource(source: string): boolean {
  const normalized = normalizeSource(source);
  return normalized === "walkin" || normalized === "direct" || normalized === "agent";
}

type LinkedMemberRow = {
  id: string;
  parent_reservation_id: string | null;
  status: string;
  checked_in_at: string | null;
};

function hasSwapPairId(action: RoomPlannerActionInput): boolean {
  return Boolean(String(action.swap_pair_id ?? "").trim());
}

function normalizeSwapPairId(action: RoomPlannerActionInput): string {
  return String(action.swap_pair_id ?? "").trim();
}

function resolveLinkedRootId(params: {
  action: RoomPlannerActionInput;
  context: ReservationContext;
  childrenByParent?: Map<string, LinkedMemberRow[]>;
}): string {
  const { action, context, childrenByParent } = params;
  const explicitRoot = String(action.linked_root_id ?? "").trim();
  if (explicitRoot) return explicitRoot;
  if (context.parent_reservation_id) return String(context.parent_reservation_id);

  const linkedIds = (action.linked_reservation_ids ?? []).map((id) => String(id ?? "").trim()).filter(Boolean);
  if (linkedIds.length > 1) return context.id;

  const children = childrenByParent?.get(context.id) ?? [];
  if (children.length > 0) return context.id;

  return "";
}

async function loadChildrenByParent(
  supabase: SupabaseLike,
  parentIds: string[]
): Promise<Map<string, LinkedMemberRow[]>> {
  const uniqueParentIds = Array.from(new Set(parentIds.filter(Boolean)));
  const result = new Map<string, LinkedMemberRow[]>();
  if (uniqueParentIds.length === 0) return result;

  const { data, error } = await supabase
    .from("reservations")
    .select("id, parent_reservation_id, status, checked_in_at")
    .in("parent_reservation_id", uniqueParentIds);
  if (error) {
    throw new RoomPlannerEngineError(error.message ?? "Failed to load linked children.", 500);
  }

  for (const row of data ?? []) {
    const parentId = String((row as any).parent_reservation_id ?? "");
    const id = String((row as any).id ?? "");
    if (!parentId || !id) continue;
    const list = result.get(parentId) ?? [];
    list.push({
      id,
      parent_reservation_id: parentId,
      status: String((row as any).status ?? ""),
      checked_in_at: (row as any).checked_in_at ? String((row as any).checked_in_at) : null,
    });
    result.set(parentId, list);
  }

  return result;
}

async function loadLinkedMembersByRoots(
  supabase: SupabaseLike,
  rootIds: string[]
): Promise<Map<string, LinkedMemberRow[]>> {
  const uniqueRootIds = Array.from(new Set(rootIds.filter(Boolean)));
  const result = new Map<string, LinkedMemberRow[]>();
  if (uniqueRootIds.length === 0) return result;

  const [{ data: roots, error: rootsError }, { data: children, error: childrenError }] = await Promise.all([
    supabase
      .from("reservations")
      .select("id, parent_reservation_id, status, checked_in_at")
      .in("id", uniqueRootIds),
    supabase
      .from("reservations")
      .select("id, parent_reservation_id, status, checked_in_at")
      .in("parent_reservation_id", uniqueRootIds),
  ]);

  if (rootsError) {
    throw new RoomPlannerEngineError(rootsError.message ?? "Failed to load linked roots.", 500);
  }
  if (childrenError) {
    throw new RoomPlannerEngineError(childrenError.message ?? "Failed to load linked members.", 500);
  }

  for (const rootId of uniqueRootIds) {
    result.set(rootId, []);
  }

  for (const row of roots ?? []) {
    const id = String((row as any).id ?? "");
    if (!id) continue;
    const list = result.get(id) ?? [];
    list.push({
      id,
      parent_reservation_id: (row as any).parent_reservation_id ? String((row as any).parent_reservation_id) : null,
      status: String((row as any).status ?? ""),
      checked_in_at: (row as any).checked_in_at ? String((row as any).checked_in_at) : null,
    });
    result.set(id, list);
  }

  for (const row of children ?? []) {
    const id = String((row as any).id ?? "");
    const parentId = String((row as any).parent_reservation_id ?? "");
    if (!id || !parentId) continue;
    const list = result.get(parentId) ?? [];
    list.push({
      id,
      parent_reservation_id: parentId,
      status: String((row as any).status ?? ""),
      checked_in_at: (row as any).checked_in_at ? String((row as any).checked_in_at) : null,
    });
    result.set(parentId, list);
  }

  return result;
}

function dedupeActions(actions: RoomPlannerActionInput[]): RoomPlannerActionInput[] {
  const seen = new Set<string>();
  const next: RoomPlannerActionInput[] = [];
  for (const action of actions) {
    const normalizedAffectedNights = dedupeAndSortDates((action.affected_nights ?? []) as string[]).join(",");
    const normalizedOverrides = (action.ota_night_overrides ?? [])
      .map((row) => `${String(row?.stay_date ?? "").trim()}=${round2(toNumber(row?.nightly_price))}`)
      .sort()
      .join(",");
    const key = [
      action.type,
      action.reservation_id,
      String(action.to_room_id ?? ""),
      String(action.from_room_id ?? ""),
      String(action.swap_pair_id ?? ""),
      String(action.linked_root_id ?? ""),
      normalizedAffectedNights,
      String(action.new_checkin_date ?? ""),
      String(action.new_checkout_date ?? ""),
      String(action.pricing_policy ?? ""),
      normalizedOverrides,
    ].join("|");
    if (seen.has(key)) continue;
    seen.add(key);
    next.push(action);
  }
  return next;
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
      parent_reservation_id,
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
      parent_reservation_id: (row as any).parent_reservation_id ? String((row as any).parent_reservation_id) : null,
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

function resolveActionCurrentRoomId(context: ReservationContext, businessDate: string): string | null {
  const affected = buildAffectedNights(context, businessDate);
  if (affected.length > 0) {
    return affected[0].room_id ? String(affected[0].room_id) : null;
  }
  const fallback = context.nights[0]?.room_id;
  return fallback ? String(fallback) : null;
}

function resolveActionCurrentRoomTypeId(context: ReservationContext, businessDate: string): number | null {
  const affected = buildAffectedNights(context, businessDate);
  if (affected.length > 0) {
    return Number.isFinite(Number(affected[0].room_type_id)) ? Number(affected[0].room_type_id) : null;
  }
  const fallback = context.nights[0]?.room_type_id;
  return Number.isFinite(Number(fallback)) ? Number(fallback) : null;
}

function normalizeHousekeepingStatus(status: string | null | undefined): string {
  return String(status ?? "").trim().toLowerCase();
}

function formatHousekeepingStatus(status: string): string {
  if (status === "in_progress") return "cleaning in progress";
  if (status === "paused") return "cleaning paused";
  return status;
}

async function getLatestHousekeepingStatus(params: {
  supabase: SupabaseLike;
  roomId: string;
  businessDate: string;
  cache: Map<string, string | null>;
}): Promise<string | null> {
  const { supabase, roomId, businessDate, cache } = params;
  const key = `${roomId}|${businessDate}`;
  if (cache.has(key)) return cache.get(key) ?? null;

  const { data, error } = await supabase
    .from("housekeeping_tasks")
    .select("status, task_seq, updated_at")
    .eq("room_id", roomId)
    .eq("stay_date", businessDate)
    .order("task_seq", { ascending: false })
    .order("updated_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) {
    throw new RoomPlannerEngineError(error.message ?? "Failed to check housekeeping status.", 500);
  }

  const status = data?.status ? normalizeHousekeepingStatus(String(data.status)) : null;
  cache.set(key, status);
  return status;
}

async function assertTargetRoomHousekeepingReady(params: {
  supabase: SupabaseLike;
  action: RoomPlannerActionInput;
  context: ReservationContext;
  targetRoom: RoomRow;
  businessDate: string;
  hkCache: Map<string, string | null>;
}) {
  const { supabase, action, context, targetRoom, businessDate, hkCache } = params;
  if (action.type !== "MOVE_WHOLE" && action.type !== "ASSIGN" && action.type !== "MOVE_NIGHTS") return;

  const affected =
    action.type === "MOVE_NIGHTS"
      ? buildMoveNightRows({ action, context, businessDate })
      : buildAffectedNights(context, businessDate);
  if (affected.length === 0) return;
  if (compareDateStrings(affected[0].stay_date, businessDate) > 0) return;

  const hkStatus = await getLatestHousekeepingStatus({
    supabase,
    roomId: targetRoom.id,
    businessDate,
    cache: hkCache,
  });

  if (!hkStatus) return;
  if (hkStatus === "dirty" || hkStatus === "in_progress" || hkStatus === "paused") {
    throw new RoomPlannerEngineError(
      `Target room ${targetRoom.room_number} is not ready (HK: ${formatHousekeepingStatus(hkStatus)}).`,
      409
    );
  }
}

async function assertRoomAvailableForStayDates(params: {
  supabase: SupabaseLike;
  roomId: string;
  stayDates: string[];
  excludeReservationId: string;
}) {
  const { supabase, roomId, stayDates, excludeReservationId } = params;
  const normalizedStayDates = dedupeAndSortDates(stayDates);
  if (!roomId || normalizedStayDates.length === 0) return;

  const { data, error } = await supabase
    .from("reservation_nights")
    .select(`
      reservation_id,
      stay_date,
      reservations!inner(status, is_dayuse)
    `)
    .eq("room_id", roomId)
    .in("stay_date", normalizedStayDates)
    .is("cancelled_at", null)
    .eq("reservations.status", "active")
    .eq("reservations.is_dayuse", false)
    .neq("reservation_id", excludeReservationId);

  if (error) {
    throw new RoomPlannerEngineError(error.message ?? "Failed to check room availability.", 500);
  }

  if ((data ?? []).length > 0) {
    const first = data?.[0] as any;
    const stayDate = String(first?.stay_date ?? normalizedStayDates[0] ?? "");
    throw new RoomPlannerEngineError(`Target room is occupied on ${stayDate}.`, 409);
  }
}

function resolveLinkedSegmentPosition(params: {
  action: RoomPlannerActionInput;
  context: ReservationContext;
  contexts: Map<string, ReservationContext>;
  linkedMembersByRoot: Map<string, LinkedMemberRow[]>;
  childrenByParent: Map<string, LinkedMemberRow[]>;
}): "single" | "first" | "middle" | "last" {
  const { action, context, contexts, linkedMembersByRoot, childrenByParent } = params;
  const rootId = resolveLinkedRootId({ action, context, childrenByParent });
  if (!rootId) return "single";
  const members = linkedMembersByRoot.get(rootId) ?? [];
  if (members.length <= 1) return "single";
  const memberContexts = members
    .map((member) => contexts.get(member.id))
    .filter((row): row is ReservationContext => Boolean(row))
    .sort((left, right) => {
      if (left.checkin_date !== right.checkin_date) return left.checkin_date.localeCompare(right.checkin_date);
      if (left.checkout_date !== right.checkout_date) return left.checkout_date.localeCompare(right.checkout_date);
      return left.id.localeCompare(right.id);
    });
  if (memberContexts.length <= 1) return "single";
  const index = memberContexts.findIndex((row) => row.id === context.id);
  if (index <= 0) return "first";
  if (index >= memberContexts.length - 1) return "last";
  return "middle";
}

function assertLinkedResizeGuard(params: {
  action: RoomPlannerActionInput;
  context: ReservationContext;
  contexts: Map<string, ReservationContext>;
  linkedMembersByRoot: Map<string, LinkedMemberRow[]>;
  childrenByParent: Map<string, LinkedMemberRow[]>;
}) {
  const { action, context, contexts, linkedMembersByRoot, childrenByParent } = params;
  if (action.type !== "EXTEND" && action.type !== "SHORTEN") return;

  const position = resolveLinkedSegmentPosition({
    action,
    context,
    contexts,
    linkedMembersByRoot,
    childrenByParent,
  });
  if (position === "single") return;

  if (action.type === "EXTEND") {
    if (position !== "last") {
      throw new RoomPlannerEngineError(
        "Cannot extend checkout of non-last linked segment.",
        409
      );
    }
    return;
  }

  if (action.new_checkout_date) {
    if (position !== "last") {
      throw new RoomPlannerEngineError(
        "Cannot shorten checkout of non-last linked segment.",
        409
      );
    }
  }
  if (action.new_checkin_date) {
    if (position !== "first") {
      throw new RoomPlannerEngineError(
        "Cannot shorten checkin of non-first linked segment.",
        409
      );
    }
  }
}

type LinkedExpansionPlan = {
  rootId: string;
  targetRoomId: string;
  allMemberIds: string[];
  movableMemberIds: Set<string>;
  templateAction: RoomPlannerActionInput;
};

function computeLinkedMovableMembers(params: {
  rootId: string;
  members: LinkedMemberRow[];
}): { allMemberIds: string[]; movableMemberIds: string[] } {
  const { rootId, members } = params;
  const allMemberIds = Array.from(new Set(members.map((member) => String(member.id ?? "")).filter(Boolean))).sort();
  if (allMemberIds.length === 0) {
    return { allMemberIds, movableMemberIds: [] };
  }

  const parent =
    members.find((member) => String(member.id ?? "") === rootId) ??
    members.find((member) => !member.parent_reservation_id) ??
    null;
  const childMembers = parent ? members.filter((member) => member.id !== parent.id) : members;

  if (parent && parent.status === "checked_out") {
    const checkedInChild = childMembers.find((member) => Boolean(member.checked_in_at));
    if (checkedInChild) {
      throw new RoomPlannerEngineError(
        "Cannot move linked stay: parent checked out and child already checked in (transition complete).",
        409
      );
    }

    const movableChildren = childMembers
      .filter((member) => member.status === "active" && !member.checked_in_at)
      .map((member) => member.id);

    return {
      allMemberIds,
      movableMemberIds: Array.from(new Set(movableChildren)),
    };
  }

  const movableAll = members
    .filter((member) => member.status === "active")
    .map((member) => member.id);

  return {
    allMemberIds,
    movableMemberIds: Array.from(new Set(movableAll)),
  };
}

async function expandLinkedMoveActionsForCommit(params: {
  supabase: SupabaseLike;
  actions: RoomPlannerActionInput[];
  businessDate: string;
}): Promise<{ actions: RoomPlannerActionInput[]; contexts: Map<string, ReservationContext> }> {
  const { supabase, actions, businessDate } = params;
  const deduped = dedupeActions(actions);
  const contexts = await loadReservationContexts(
    supabase,
    deduped.map((action) => action.reservation_id)
  );
  const childrenByParent = await loadChildrenByParent(supabase, Array.from(contexts.keys()));

  const linkedRootByActionIndex = new Map<number, string>();
  const linkedRootIds = new Set<string>();
  for (let index = 0; index < deduped.length; index += 1) {
    const action = deduped[index];
    if (action.type !== "MOVE_WHOLE") continue;
    const context = contexts.get(action.reservation_id);
    if (!context) continue;
    const rootId = resolveLinkedRootId({ action, context, childrenByParent });
    if (!rootId) continue;
    linkedRootByActionIndex.set(index, rootId);
    linkedRootIds.add(rootId);
  }

  const linkedMembersByRoot = await loadLinkedMembersByRoots(supabase, Array.from(linkedRootIds));
  const missingMemberIds: string[] = [];
  for (const members of linkedMembersByRoot.values()) {
    for (const member of members) {
      if (!contexts.has(member.id)) missingMemberIds.push(member.id);
    }
  }
  if (missingMemberIds.length > 0) {
    const missingContexts = await loadReservationContexts(supabase, missingMemberIds);
    for (const [reservationId, context] of missingContexts.entries()) {
      contexts.set(reservationId, context);
    }
  }

  const linkedPlansByRoot = new Map<string, LinkedExpansionPlan>();
  for (const [actionIndex, rootId] of linkedRootByActionIndex.entries()) {
    const action = deduped[actionIndex];
    const targetRoomId = String(action.to_room_id ?? "");
    if (!targetRoomId) continue;

    const existing = linkedPlansByRoot.get(rootId);
    if (existing) {
      if (existing.targetRoomId !== targetRoomId) {
        throw new RoomPlannerEngineError(
          `Conflicting linked move target rooms for root ${rootId}.`,
          409
        );
      }
      continue;
    }

    const members = linkedMembersByRoot.get(rootId) ?? [];
    if (members.length <= 1) continue;
    const movable = computeLinkedMovableMembers({ rootId, members });
    if (movable.movableMemberIds.length === 0) {
      throw new RoomPlannerEngineError(
        "No movable linked stay segment for this action.",
        409
      );
    }

    linkedPlansByRoot.set(rootId, {
      rootId,
      targetRoomId,
      allMemberIds: movable.allMemberIds,
      movableMemberIds: new Set(movable.movableMemberIds),
      templateAction: action,
    });
  }

  const expandedActions: RoomPlannerActionInput[] = [];
  for (let index = 0; index < deduped.length; index += 1) {
    const action = deduped[index];
    const rootId = linkedRootByActionIndex.get(index);
    const linkedPlan = rootId ? linkedPlansByRoot.get(rootId) : null;

    if (action.type === "MOVE_WHOLE" && linkedPlan) {
      if (String(action.to_room_id ?? "") !== linkedPlan.targetRoomId) {
        throw new RoomPlannerEngineError(
          `Conflicting linked move target for reservation ${action.reservation_id}.`,
          409
        );
      }
      if (!linkedPlan.movableMemberIds.has(action.reservation_id)) {
        continue;
      }
      expandedActions.push({
        ...action,
        linked_root_id: linkedPlan.rootId,
        linked_reservation_ids: linkedPlan.allMemberIds,
      });
      continue;
    }

    expandedActions.push(action);
  }

  for (const linkedPlan of linkedPlansByRoot.values()) {
    for (const memberId of linkedPlan.movableMemberIds.values()) {
      const alreadyIncluded = expandedActions.some(
        (action) =>
          action.type === "MOVE_WHOLE" &&
          action.reservation_id === memberId &&
          String(action.to_room_id ?? "") === linkedPlan.targetRoomId
      );
      if (alreadyIncluded) continue;

      const memberContext = contexts.get(memberId);
      if (!memberContext) continue;
      expandedActions.push({
        ...linkedPlan.templateAction,
        reservation_id: memberId,
        from_room_id: resolveActionCurrentRoomId(memberContext, businessDate),
        to_room_id: linkedPlan.targetRoomId,
        linked_root_id: linkedPlan.rootId,
        linked_reservation_ids: linkedPlan.allMemberIds,
      });
    }
  }

  return {
    actions: dedupeActions(expandedActions),
    contexts,
  };
}

async function hydrateLinkedContextMaps(params: {
  supabase: SupabaseLike;
  actions: RoomPlannerActionInput[];
  contexts: Map<string, ReservationContext>;
}): Promise<{
  childrenByParent: Map<string, LinkedMemberRow[]>;
  linkedMembersByRoot: Map<string, LinkedMemberRow[]>;
}> {
  const { supabase, actions, contexts } = params;
  const childrenByParent = await loadChildrenByParent(supabase, Array.from(contexts.keys()));
  const linkedRootIds = Array.from(
    new Set(
      actions
        .filter((action) => action.type === "MOVE_WHOLE" || action.type === "EXTEND" || action.type === "SHORTEN")
        .map((action) => {
          const context = contexts.get(action.reservation_id);
          if (!context) return "";
          return resolveLinkedRootId({ action, context, childrenByParent });
        })
        .filter(Boolean)
    )
  );

  const linkedMembersByRoot = await loadLinkedMembersByRoots(supabase, linkedRootIds);
  const missingMemberIds: string[] = [];
  for (const members of linkedMembersByRoot.values()) {
    for (const member of members) {
      if (!contexts.has(member.id)) missingMemberIds.push(member.id);
    }
  }
  if (missingMemberIds.length > 0) {
    const loaded = await loadReservationContexts(supabase, missingMemberIds);
    for (const [reservationId, context] of loaded.entries()) {
      contexts.set(reservationId, context);
    }
  }

  return {
    childrenByParent,
    linkedMembersByRoot,
  };
}

function buildSwapPairIndexes(actions: RoomPlannerActionInput[]): Map<string, number[]> {
  const map = new Map<string, number[]>();
  for (let index = 0; index < actions.length; index += 1) {
    const action = actions[index];
    if (!hasSwapPairId(action)) continue;
    const pairId = normalizeSwapPairId(action);
    const list = map.get(pairId) ?? [];
    list.push(index);
    map.set(pairId, list);
  }
  return map;
}

function validateSwapPairs(params: {
  actions: RoomPlannerActionInput[];
  contexts: Map<string, ReservationContext>;
  roomsById: Map<string, RoomRow>;
  businessDate: string;
}) {
  const { actions, contexts, roomsById, businessDate } = params;
  const swapPairs = buildSwapPairIndexes(actions);

  for (const [pairId, indexes] of swapPairs.entries()) {
    // Multi-booking swap: N ≥ 2 actions per pair (1 source + N-1 targets)
    if (indexes.length < 2) {
      throw new RoomPlannerEngineError(
        `Invalid swap pair ${pairId}: expected at least 2 actions, got ${indexes.length}.`,
        400
      );
    }

    const sortedIndexes = indexes.sort((left, right) => left - right);
    const pairActions = sortedIndexes.map((i) => actions[i]);

    // All must be MOVE_WHOLE
    for (const action of pairActions) {
      if (action.type !== "MOVE_WHOLE") {
        throw new RoomPlannerEngineError(
          `Invalid swap pair ${pairId}: swap actions must be MOVE_WHOLE.`,
          400
        );
      }
    }

    // No duplicate reservations
    const resIds = new Set(pairActions.map((a) => a.reservation_id));
    if (resIds.size !== pairActions.length) {
      throw new RoomPlannerEngineError(
        `Invalid swap pair ${pairId}: duplicate reservation.`,
        400
      );
    }

    // Load contexts, check guards
    const pairContexts: ReservationContext[] = [];
    for (const action of pairActions) {
      const ctx = contexts.get(action.reservation_id);
      if (!ctx) {
        throw new RoomPlannerEngineError(`Invalid swap pair ${pairId}: reservation context missing.`, 404);
      }
      if (ctx.checked_in_at) {
        throw new RoomPlannerEngineError(
          `Cannot swap checked-in reservation ${ctx.booking_code ?? ctx.id} in pair ${pairId}.`,
          409
        );
      }
      pairContexts.push(ctx);
    }

    // Validate target rooms
    for (const action of pairActions) {
      const targetRoomId = String(action.to_room_id ?? "");
      const targetRoom = roomsById.get(targetRoomId);
      assertTargetRoomUsable(targetRoom, targetRoomId);
    }

    // Verify exactly 2 distinct rooms involved (source room + target room)
    const allTargetRoomIds = new Set(pairActions.map((a) => String(a.to_room_id ?? "")));
    if (allTargetRoomIds.size !== 2) {
      // For a valid swap, bookings must go to exactly 2 rooms (swapping between them)
      if (allTargetRoomIds.size > 2) {
        throw new RoomPlannerEngineError(
          `Invalid swap pair ${pairId}: swap involves more than 2 rooms.`,
          400
        );
      }
    }

    // Same room type check
    const targetRooms = pairActions.map((a) => roomsById.get(String(a.to_room_id ?? ""))).filter(Boolean) as RoomRow[];
    const roomTypeIds = new Set(targetRooms.map((r) => Number(r.room_type_id)));
    if (roomTypeIds.size > 1) {
      throw new RoomPlannerEngineError(
        `Cannot swap pair ${pairId}: target rooms have different room types.`,
        409
      );
    }

    // At least one pair of bookings must overlap
    const allNightSets = pairActions.map((action) => {
      const ctx = contexts.get(action.reservation_id)!;
      return new Set(buildAffectedNights(ctx, businessDate).map((night) => night.stay_date));
    });
    // Check: first action (source) must overlap with at least one other
    const sourceNights = allNightSets[0];
    const hasAnyOverlap = allNightSets.slice(1).some((targetNights) =>
      Array.from(sourceNights.values()).some((d) => targetNights.has(d))
    );
    if (!hasAnyOverlap) {
      throw new RoomPlannerEngineError(
        `Cannot swap pair ${pairId}: source booking does not overlap with any target booking.`,
        409
      );
    }
  }
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
  if (action.type === "MOVE_WHOLE" || action.type === "ASSIGN" || action.type === "MOVE_NIGHTS") {
    if (!action.to_room_id) {
      throw new RoomPlannerEngineError(`${action.type} requires to_room_id.`, 400);
    }
  }
  if (action.type === "MOVE_NIGHTS") {
    const nights = dedupeAndSortDates((action.affected_nights ?? []) as string[]);
    if (nights.length === 0) {
      throw new RoomPlannerEngineError("MOVE_NIGHTS requires affected_nights.", 400);
    }
  }
  if (action.type === "EXTEND") {
    const nextCheckout = String(action.new_checkout_date ?? "").trim();
    if (!nextCheckout || !isValidDateString(nextCheckout)) {
      throw new RoomPlannerEngineError("EXTEND requires valid new_checkout_date.", 400);
    }
  }
  if (action.type === "SHORTEN") {
    const nextCheckout = String(action.new_checkout_date ?? "").trim();
    const nextCheckin = String(action.new_checkin_date ?? "").trim();
    if (!nextCheckout && !nextCheckin) {
      throw new RoomPlannerEngineError("SHORTEN requires new_checkout_date or new_checkin_date.", 400);
    }
    if (nextCheckout && nextCheckin) {
      throw new RoomPlannerEngineError("SHORTEN cannot set both new_checkout_date and new_checkin_date.", 400);
    }
    if (nextCheckout && !isValidDateString(nextCheckout)) {
      throw new RoomPlannerEngineError("Invalid SHORTEN new_checkout_date.", 400);
    }
    if (nextCheckin && !isValidDateString(nextCheckin)) {
      throw new RoomPlannerEngineError("Invalid SHORTEN new_checkin_date.", 400);
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

  if ((action.type === "MOVE_WHOLE" || action.type === "MOVE_NIGHTS" || action.type === "UNASSIGN") && context.do_not_move_assigned_room) {
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

  if (action.type === "SHORTEN" && action.new_checkin_date && context.checked_in_at) {
    throw new RoomPlannerEngineError(
      `Cannot shorten checkin of ${context.booking_code ?? context.id}: guest already checked in.`,
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

function buildActionPreviewFallback(
  actionIndex: number,
  actionType: RoomPlannerActionType,
  context: ReservationContext
): ActionPricingPreview {
  return {
    action_index: actionIndex,
    action_type: actionType,
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
  roomsById?: Map<string, RoomRow>;
}): Promise<ActionPricingPreview> {
  const pricing = await computeMovePricing({
    supabase: params.supabase,
    action: params.action,
    context: params.context,
    targetRoom: params.targetRoom,
    affectedNights: params.affectedNights,
    ratePlanNamesById: params.ratePlanNamesById,
  });
  // Resolve from_room_number from context's current nights
  const currentRoomId = params.context.nights[0]?.room_id ?? null;
  const fromRoomNumber = currentRoomId
    ? params.roomsById?.get(currentRoomId)?.room_number ?? ""
    : "";

  return {
    action_index: params.actionIndex,
    action_type: params.action.type,
    reservation_id: params.context.id,
    booking_code: params.context.booking_code,
    guest_name: params.context.guest_name,
    source: normalizeSource(params.context.source),
    current_total: pricing.currentTotal,
    new_total: pricing.newTotal,
    delta: pricing.delta,
    nights: pricing.nights,
    rate_plan_name: pricing.ratePlanName,
    from_room_number: fromRoomNumber,
    to_room_number: params.targetRoom.room_number,
  };
}

function assertMoveNightsPolicy(params: {
  action: RoomPlannerActionInput;
  context: ReservationContext;
  affectedNights: ReservationNightRow[];
}) {
  const { action, context, affectedNights } = params;
  if (action.type !== "MOVE_NIGHTS") return;
  const bookingSource = normalizeSource(context.source);
  const overrides = normalizeOverrides(action.ota_night_overrides);

  if (isOtaSource(bookingSource)) {
    const missing = affectedNights
      .map((night) => night.stay_date)
      .filter((stayDate) => !overrides.has(stayDate));
    if (missing.length > 0) {
      throw new RoomPlannerEngineError(
        `MOVE_NIGHTS for OTA requires manual price on: ${missing.join(", ")}`,
        400
      );
    }
    const pricingPolicy = String(action.pricing_policy ?? "keep_rtc").trim();
    if (pricingPolicy && pricingPolicy !== "keep_rtc") {
      throw new RoomPlannerEngineError("OTA MOVE_NIGHTS supports keep_rtc pricing_policy only.", 400);
    }
    return;
  }

  if (overrides.size > 0) {
    throw new RoomPlannerEngineError(
      `Reservation ${context.booking_code ?? context.id} is not OTA. ota_night_overrides is not allowed.`,
      400
    );
  }
}

function resolveMoveFromRoomNumber(params: {
  context: ReservationContext;
  action: RoomPlannerActionInput;
  roomsById?: Map<string, RoomRow>;
  affectedNights?: ReservationNightRow[];
}): string {
  const { context, action, roomsById, affectedNights } = params;
  const firstAffected = (affectedNights ?? []).slice().sort((left, right) => left.stay_date.localeCompare(right.stay_date))[0] ?? null;
  const sourceRoomId =
    String(action.from_room_id ?? "").trim() ||
    String(firstAffected?.room_id ?? "") ||
    String(context.nights[0]?.room_id ?? "");
  if (!sourceRoomId) return "";
  return roomsById?.get(sourceRoomId)?.room_number ?? "";
}

async function buildMoveNightsPreview(params: {
  supabase: SupabaseLike;
  actionIndex: number;
  action: RoomPlannerActionInput;
  context: ReservationContext;
  targetRoom: RoomRow;
  affectedNights: ReservationNightRow[];
  ratePlanNamesById: Map<string, string>;
  roomsById?: Map<string, RoomRow>;
}): Promise<ActionPricingPreview> {
  const { action, context, affectedNights } = params;
  assertMoveNightsPolicy({ action, context, affectedNights });

  const pricing = await computeMovePricing({
    supabase: params.supabase,
    action,
    context,
    targetRoom: params.targetRoom,
    affectedNights,
    ratePlanNamesById: params.ratePlanNamesById,
  });

  const fullCurrent = round2(toNumber(context.total_price));
  const fullNext = round2(fullCurrent + pricing.delta);
  return {
    action_index: params.actionIndex,
    action_type: "MOVE_NIGHTS",
    reservation_id: context.id,
    booking_code: context.booking_code,
    guest_name: context.guest_name,
    source: normalizeSource(context.source),
    current_total: fullCurrent,
    new_total: fullNext,
    delta: pricing.delta,
    nights: pricing.nights,
    rate_plan_name: pricing.ratePlanName,
    from_room_number: resolveMoveFromRoomNumber({
      context,
      action,
      roomsById: params.roomsById,
      affectedNights,
    }),
    to_room_number: params.targetRoom.room_number,
    affected_nights: buildStayDatesFromNights(affectedNights),
  };
}

async function computeExtendNightlyPrices(params: {
  supabase: SupabaseLike;
  context: ReservationContext;
  room: RoomRow;
  extensionDates: string[];
  ratePlanNamesById: Map<string, string>;
}): Promise<{ byStayDate: Map<string, number>; ratePlanName?: string }> {
  const { supabase, context, room, extensionDates } = params;
  const byStayDate = new Map<string, number>();
  if (extensionDates.length === 0) return { byStayDate };

  const rackRates = await computeRackRatesByStayDate({
    supabase,
    roomTypeId: room.room_type_id,
    stayDates: extensionDates,
  });
  const fallback = round2(
    toNumber(
      [...context.nights].sort((left, right) => left.stay_date.localeCompare(right.stay_date)).slice(-1)[0]?.nightly_price ?? 0
    )
  );
  for (const stayDate of extensionDates) {
    byStayDate.set(stayDate, round2(rackRates.get(stayDate) ?? fallback));
  }

  return { byStayDate, ratePlanName: "Rack / Rate Grid (No Rate Plan)" };
}

function resolveExtensionRoomId(params: {
  action: RoomPlannerActionInput;
  context: ReservationContext;
}): string {
  const { action, context } = params;
  const fromRoomId = String(action.from_room_id ?? "").trim();
  if (fromRoomId) return fromRoomId;
  const { lastNight } = resolveEdgeNightRows(context);
  const roomId = String(lastNight?.room_id ?? "").trim();
  if (!roomId) {
    throw new RoomPlannerEngineError(
      `Cannot extend ${context.booking_code ?? context.id}: assigned room not found.`,
      409
    );
  }
  return roomId;
}

function resolveRemovedNightsForShorten(params: {
  action: RoomPlannerActionInput;
  context: ReservationContext;
  businessDate: string;
}): ReservationNightRow[] {
  const { action, context, businessDate } = params;
  const sorted = [...context.nights].sort((left, right) => left.stay_date.localeCompare(right.stay_date));
  if (String(action.new_checkout_date ?? "").trim()) {
    const newCheckout = String(action.new_checkout_date ?? "");
    if (compareDateStrings(newCheckout, context.checkout_date) >= 0) {
      throw new RoomPlannerEngineError("SHORTEN checkout must be earlier than current checkout.", 400);
    }
    if (compareDateStrings(newCheckout, context.checkin_date) <= 0) {
      throw new RoomPlannerEngineError("SHORTEN checkout must keep at least one night.", 400);
    }
    const removed = sorted.filter((night) => compareDateStrings(night.stay_date, newCheckout) >= 0);
    if (removed.length === 0) {
      throw new RoomPlannerEngineError("No nights to shorten from checkout.", 409);
    }
    if (removed.some((night) => compareDateStrings(night.stay_date, businessDate) < 0)) {
      throw new RoomPlannerEngineError("Cannot shorten nights in the past.", 409);
    }
    return removed;
  }

  const newCheckin = String(action.new_checkin_date ?? "");
  if (compareDateStrings(newCheckin, context.checkin_date) <= 0) {
    throw new RoomPlannerEngineError("SHORTEN checkin must be later than current checkin.", 400);
  }
  if (compareDateStrings(newCheckin, context.checkout_date) >= 0) {
    throw new RoomPlannerEngineError("SHORTEN checkin must be before checkout.", 400);
  }
  if (compareDateStrings(context.checkin_date, businessDate) < 0) {
    throw new RoomPlannerEngineError("Cannot shorten checkin after stay has started.", 409);
  }

  const removed = sorted.filter((night) => compareDateStrings(night.stay_date, newCheckin) < 0);
  if (removed.length === 0) {
    throw new RoomPlannerEngineError("No nights to shorten from checkin.", 409);
  }
  if (removed.some((night) => compareDateStrings(night.stay_date, businessDate) < 0)) {
    throw new RoomPlannerEngineError("Cannot shorten nights in the past.", 409);
  }
  return removed;
}

async function buildExtendPreview(params: {
  supabase: SupabaseLike;
  actionIndex: number;
  action: RoomPlannerActionInput;
  context: ReservationContext;
  roomsById: Map<string, RoomRow>;
  ratePlanNamesById: Map<string, string>;
  businessDate: string;
}): Promise<ActionPricingPreview> {
  const { action, context, roomsById, supabase, ratePlanNamesById, businessDate } = params;
  const newCheckoutDate = String(action.new_checkout_date ?? "").trim();
  if (!newCheckoutDate || !isValidDateString(newCheckoutDate)) {
    throw new RoomPlannerEngineError("EXTEND requires valid new_checkout_date.", 400);
  }
  if (compareDateStrings(newCheckoutDate, context.checkout_date) <= 0) {
    throw new RoomPlannerEngineError("new_checkout_date must be after current checkout_date.", 400);
  }

  const roomId = resolveExtensionRoomId({ action, context });
  const room = roomsById.get(roomId);
  assertTargetRoomUsable(room, roomId);
  await assertRoomAvailableForDateRange(supabase as any, {
    roomId,
    checkinDate: context.checkout_date,
    checkoutDate: newCheckoutDate,
    excludeReservationId: context.id,
  });

  const extensionDates = listNightDates(context.checkout_date, newCheckoutDate);
  if (extensionDates.length === 0) {
    throw new RoomPlannerEngineError("No extension nights to add.", 409);
  }
  if (extensionDates.some((stayDate) => compareDateStrings(stayDate, businessDate) < 0)) {
    throw new RoomPlannerEngineError("Cannot extend into historical nights.", 409);
  }

  const priced = await computeExtendNightlyPrices({
    supabase,
    context,
    room: room!,
    extensionDates,
    ratePlanNamesById,
  });
  const nightsAdded: PricingPreviewNight[] = extensionDates.map((stayDate) => ({
    stay_date: stayDate,
    current_price: 0,
    new_price: round2(priced.byStayDate.get(stayDate) ?? 0),
    is_ota: isOtaSource(context.source),
    editable: false,
  }));
  const addedTotal = round2(nightsAdded.reduce((sum, night) => sum + night.new_price, 0));
  const currentTotal = round2(toNumber(context.total_price));
  const newTotal = round2(currentTotal + addedTotal);

  return {
    action_index: params.actionIndex,
    action_type: "EXTEND",
    reservation_id: context.id,
    booking_code: context.booking_code,
    guest_name: context.guest_name,
    source: normalizeSource(context.source),
    current_total: currentTotal,
    new_total: newTotal,
    delta: round2(newTotal - currentTotal),
    nights: nightsAdded,
    nights_added: nightsAdded,
    original_checkout: context.checkout_date,
    new_checkout: newCheckoutDate,
    original_checkin: context.checkin_date,
    new_checkin: context.checkin_date,
    from_room_number: room?.room_number ?? "",
    to_room_number: room?.room_number ?? "",
    rate_plan_name: priced.ratePlanName,
  };
}

function buildShortenPreview(params: {
  actionIndex: number;
  action: RoomPlannerActionInput;
  context: ReservationContext;
  businessDate: string;
}): ActionPricingPreview {
  const { action, context, businessDate } = params;
  const removedNights = resolveRemovedNightsForShorten({ action, context, businessDate });
  const nightsRemoved: PricingPreviewNight[] = removedNights.map((night) => ({
    stay_date: night.stay_date,
    current_price: round2(toNumber(night.nightly_price)),
    new_price: 0,
    is_ota: Boolean(night.is_ota),
    editable: false,
  }));
  const removedTotal = round2(nightsRemoved.reduce((sum, night) => sum + night.current_price, 0));
  const currentTotal = round2(toNumber(context.total_price));
  const newTotal = round2(currentTotal - removedTotal);
  const nextCheckin = String(action.new_checkin_date ?? "").trim() || context.checkin_date;
  const nextCheckout = String(action.new_checkout_date ?? "").trim() || context.checkout_date;

  return {
    action_index: params.actionIndex,
    action_type: "SHORTEN",
    reservation_id: context.id,
    booking_code: context.booking_code,
    guest_name: context.guest_name,
    source: normalizeSource(context.source),
    current_total: currentTotal,
    new_total: newTotal,
    delta: round2(newTotal - currentTotal),
    nights: nightsRemoved,
    nights_removed: nightsRemoved,
    original_checkin: context.checkin_date,
    new_checkin: nextCheckin,
    original_checkout: context.checkout_date,
    new_checkout: nextCheckout,
  };
}

function buildOccupancyKey(stayDate: string, roomId: string) {
  return `${stayDate}|${roomId}`;
}

async function validateDraftMergedState(params: {
  supabase: SupabaseLike;
  actions: RoomPlannerActionInput[];
  contexts: Map<string, ReservationContext>;
  roomsById?: Map<string, RoomRow>;
  businessDate: string;
}) {
  const { supabase, actions, contexts, roomsById, businessDate } = params;

  const rangeDatesForAction = (action: RoomPlannerActionInput, context: ReservationContext): string[] => {
    if (action.type === "MOVE_NIGHTS") {
      return buildMoveNightRows({ action, context, businessDate }).map((night) => night.stay_date);
    }
    if (action.type === "EXTEND") {
      const newCheckout = String(action.new_checkout_date ?? "").trim();
      if (!newCheckout) return [];
      return listNightDates(context.checkout_date, newCheckout);
    }
    if (action.type === "SHORTEN") {
      return resolveRemovedNightsForShorten({ action, context, businessDate }).map((night) => night.stay_date);
    }
    return buildAffectedNights(context, businessDate).map((night) => night.stay_date);
  };

  const affectedDates: string[] = [];
  for (const action of actions) {
    const context = contexts.get(action.reservation_id);
    if (!context) continue;
    affectedDates.push(...rangeDatesForAction(action, context));
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

  const swapPairs = buildSwapPairIndexes(actions);
  const handledSwapPairIds = new Set<string>();

  for (let actionIndex = 0; actionIndex < actions.length; actionIndex += 1) {
    const action = actions[actionIndex];
    const context = contexts.get(action.reservation_id);
    if (!context) continue;

    if (hasSwapPairId(action)) {
      const pairId = normalizeSwapPairId(action);
      if (handledSwapPairIds.has(pairId)) continue;
      handledSwapPairIds.add(pairId);

      const pairIndexes = (swapPairs.get(pairId) ?? []).sort((left, right) => left - right);
      if (pairIndexes.length !== 2) {
        throw new RoomPlannerEngineError(
          `Invalid swap pair ${pairId}: expected 2 actions, got ${pairIndexes.length}.`,
          400
        );
      }

      const pairRows = pairIndexes
        .map((index) => ({
          actionIndex: index,
          action: actions[index],
          context: contexts.get(actions[index]?.reservation_id ?? ""),
        }))
        .filter((row) => row.action && row.context) as Array<{
        actionIndex: number;
        action: RoomPlannerActionInput;
        context: ReservationContext;
      }>;

      // Remove all current occupancy of pair first, then apply both targets.
      for (const row of pairRows) {
        const pairNightMap = roomByReservationAndNight.get(row.context.id) ?? new Map<string, string | null>();
        roomByReservationAndNight.set(row.context.id, pairNightMap);
        const affectedNights =
          row.action.type === "MOVE_NIGHTS"
            ? buildMoveNightRows({ action: row.action, context: row.context, businessDate })
            : buildAffectedNights(row.context, businessDate);
        for (const night of affectedNights) {
          const currentRoomId = pairNightMap.get(night.stay_date) ?? null;
          if (!currentRoomId) continue;
          const currentKey = buildOccupancyKey(night.stay_date, currentRoomId);
          const owner = occupancy.get(currentKey);
          if (owner === row.context.id) {
            occupancy.delete(currentKey);
          }
        }
      }

      for (const row of pairRows) {
        const pairNightMap = roomByReservationAndNight.get(row.context.id) ?? new Map<string, string | null>();
        roomByReservationAndNight.set(row.context.id, pairNightMap);
        const affectedNights =
          row.action.type === "MOVE_NIGHTS"
            ? buildMoveNightRows({ action: row.action, context: row.context, businessDate })
            : buildAffectedNights(row.context, businessDate);
        const targetRoomId =
          row.action.type === "MOVE_WHOLE" || row.action.type === "ASSIGN" || row.action.type === "MOVE_NIGHTS"
            ? String(row.action.to_room_id ?? "")
            : null;

        for (const night of affectedNights) {
          if (targetRoomId) {
            const targetKey = buildOccupancyKey(night.stay_date, targetRoomId);
            const owner = occupancy.get(targetKey);
            if (owner && owner !== row.context.id) {
              throw new RoomPlannerEngineError(
                `Draft conflict at action ${row.actionIndex}: room already occupied on ${night.stay_date}.`,
                409
              );
            }
            occupancy.set(targetKey, row.context.id);
          }
          pairNightMap.set(night.stay_date, targetRoomId);
        }
      }
      continue;
    }

    const affectedNights =
      action.type === "MOVE_NIGHTS"
        ? buildMoveNightRows({ action, context, businessDate })
        : action.type === "SHORTEN"
          ? resolveRemovedNightsForShorten({ action, context, businessDate })
          : buildAffectedNights(context, businessDate);

    if (action.type !== "EXTEND" && affectedNights.length === 0) continue;
    const perNightMap = roomByReservationAndNight.get(context.id) ?? new Map<string, string | null>();
    roomByReservationAndNight.set(context.id, perNightMap);
    const targetRoomId =
      action.type === "MOVE_WHOLE" || action.type === "ASSIGN" || action.type === "MOVE_NIGHTS"
        ? String(action.to_room_id ?? "")
        : null;

    if (action.type === "EXTEND") {
      const newCheckout = String(action.new_checkout_date ?? "").trim();
      if (!newCheckout) continue;
      const extensionRoomId = resolveExtensionRoomId({ action, context });
      if (!extensionRoomId) {
        throw new RoomPlannerEngineError(`Cannot resolve extension room for ${context.booking_code ?? context.id}.`, 409);
      }
      if (roomsById) {
        assertTargetRoomUsable(roomsById.get(extensionRoomId), extensionRoomId);
      }
      const extensionDates = listNightDates(context.checkout_date, newCheckout);
      for (const stayDate of extensionDates) {
        if (compareDateStrings(stayDate, businessDate) < 0) {
          throw new RoomPlannerEngineError(`Cannot extend into historical date ${stayDate}.`, 409);
        }
        const targetKey = buildOccupancyKey(stayDate, extensionRoomId);
        const owner = occupancy.get(targetKey);
        if (owner && owner !== context.id) {
          throw new RoomPlannerEngineError(
            `Draft conflict at action ${actionIndex}: room already occupied on ${stayDate}.`,
            409
          );
        }
        occupancy.set(targetKey, context.id);
        perNightMap.set(stayDate, extensionRoomId);
      }
      continue;
    }

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

async function executeMoveNightsAction(params: {
  supabase: SupabaseLike;
  action: RoomPlannerActionInput;
  context: ReservationContext;
  targetRoom: RoomRow;
  businessDate: string;
  actorUserId: string;
  ratePlanNamesById: Map<string, string>;
  roomsById: Map<string, RoomRow>;
}) {
  const { supabase, action, context, targetRoom, businessDate, actorUserId, ratePlanNamesById, roomsById } = params;
  const affected = buildMoveNightRows({ action, context, businessDate });
  assertMoveNightsPolicy({ action, context, affectedNights: affected });
  if (affected.length === 0) {
    throw new RoomPlannerEngineError(`No nights selected for move on ${context.booking_code ?? context.id}.`, 409);
  }

  const stayDates = buildStayDatesFromNights(affected);
  await assertRoomAvailableForStayDates({
    supabase,
    roomId: targetRoom.id,
    stayDates,
    excludeReservationId: context.id,
  });

  const pricing = await computeMovePricing({
    supabase,
    action,
    context,
    targetRoom,
    affectedNights: affected,
    ratePlanNamesById,
  });

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
    throw new RoomPlannerEngineError(updateError.message ?? "Failed to apply MOVE_NIGHTS.", 500);
  }

  await updateNightlyPrices({
    supabase,
    reservationId: context.id,
    nightlyPricesByDate: pricing.byStayDate,
  });

  const reservationTotal = await recomputeReservationTotalPrice(supabase, context.id);
  const sourceRoomNumber = resolveMoveFromRoomNumber({
    context,
    action,
    roomsById,
    affectedNights: affected,
  });

  if (stayDates.includes(businessDate)) {
    const sourceRoomId = String(action.from_room_id ?? "").trim() || String(affected[0]?.room_id ?? "");
    if (sourceRoomId && sourceRoomId !== targetRoom.id) {
      await markRoomDirtyTask(supabase as any, {
        roomId: sourceRoomId,
        stayDate: businessDate,
        assignedMaidName: null,
        clearDailyPlanWhenUnassigned: true,
        logNote: "Marked dirty after room planner split move",
      }).catch((error) => {
        throw new RoomPlannerEngineError(error?.message ?? "Failed to mark source room dirty.", 500);
      });
    }
  }

  await appendReservationNoteLine(
    supabase as any,
    context.id,
    `[ROOM PLANNER MOVE_NIGHTS ${businessDate}] ${sourceRoomNumber || "unknown"} -> ${targetRoom.room_number} | nights=${stayDates.join(", ")} | Δ=${pricing.delta >= 0 ? "+" : "-"}฿${Math.abs(pricing.delta).toLocaleString("th-TH", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
  );

  await supabase.from("audit_logs").insert({
    actor_user_id: actorUserId,
    action: "room_planner_move_nights",
    entity_type: "reservation",
    entity_id: context.id,
    before_json: {
      reservation_id: context.id,
      stay_dates: stayDates,
      source_room_number: sourceRoomNumber || null,
      current_total: round2(toNumber(context.total_price)),
    },
    after_json: {
      reservation_id: context.id,
      stay_dates: stayDates,
      target_room_id: targetRoom.id,
      target_room_number: targetRoom.room_number,
      delta: pricing.delta,
      new_total: reservationTotal,
      move_payload: {
        pricing_policy: action.pricing_policy ?? null,
        ota_night_overrides: action.ota_night_overrides ?? [],
      },
    },
    business_date: businessDate,
    source: normalizeAuditSource("manual"),
  });

  return {
    reservation_id: context.id,
    booking_code: context.booking_code,
    action: "MOVE_NIGHTS",
    to_room_number: targetRoom.room_number,
    affected_nights: stayDates,
    current_total: round2(toNumber(context.total_price)),
    new_total: reservationTotal,
    delta: round2(reservationTotal - round2(toNumber(context.total_price))),
  };
}

async function executeExtendAction(params: {
  supabase: SupabaseLike;
  action: RoomPlannerActionInput;
  context: ReservationContext;
  roomsById: Map<string, RoomRow>;
  businessDate: string;
  actorUserId: string;
  ratePlanNamesById: Map<string, string>;
}) {
  const { supabase, action, context, roomsById, businessDate, actorUserId, ratePlanNamesById } = params;
  const newCheckoutDate = String(action.new_checkout_date ?? "").trim();
  if (!newCheckoutDate || !isValidDateString(newCheckoutDate)) {
    throw new RoomPlannerEngineError("EXTEND requires valid new_checkout_date.", 400);
  }
  if (compareDateStrings(newCheckoutDate, context.checkout_date) <= 0) {
    throw new RoomPlannerEngineError("new_checkout_date must be after current checkout_date.", 400);
  }

  const roomId = resolveExtensionRoomId({ action, context });
  const extensionRoom = roomsById.get(roomId);
  assertTargetRoomUsable(extensionRoom, roomId);

  const extensionDates = listNightDates(context.checkout_date, newCheckoutDate);
  if (extensionDates.length === 0) {
    throw new RoomPlannerEngineError("No extension nights to add.", 409);
  }
  if (extensionDates.some((stayDate) => compareDateStrings(stayDate, businessDate) < 0)) {
    throw new RoomPlannerEngineError("Cannot extend into historical nights.", 409);
  }

  await assertRoomAvailableForDateRange(supabase as any, {
    roomId,
    checkinDate: context.checkout_date,
    checkoutDate: newCheckoutDate,
    excludeReservationId: context.id,
  });

  const priced = await computeExtendNightlyPrices({
    supabase,
    context,
    room: extensionRoom!,
    extensionDates,
    ratePlanNamesById,
  });
  const isOta = isOtaSource(context.source);
  const insertRows = extensionDates.map((stayDate) => ({
    reservation_id: context.id,
    room_id: roomId,
    room_type_id: extensionRoom!.room_type_id,
    stay_date: stayDate,
    nightly_price: round2(priced.byStayDate.get(stayDate) ?? 0),
    is_ota: isOta,
    assignment_source: "manual",
    dependency_plan_id: null,
    dependency_reason: null,
  }));
  const { error: insertError } = await supabase.from("reservation_nights").insert(insertRows);
  if (insertError) {
    throw new RoomPlannerEngineError(insertError.message ?? "Failed to insert extension nights.", 500);
  }

  const reservationTotal = await recomputeReservationTotalPrice(supabase, context.id);
  const { error: updateReservationError } = await supabase
    .from("reservations")
    .update({
      checkout_date: newCheckoutDate,
      total_price: reservationTotal,
    })
    .eq("id", context.id);
  if (updateReservationError) {
    throw new RoomPlannerEngineError(updateReservationError.message ?? "Failed to update extended reservation.", 500);
  }

  const addedTotal = round2(
    extensionDates.reduce((sum, stayDate) => sum + round2(priced.byStayDate.get(stayDate) ?? 0), 0)
  );
  await appendReservationNoteLine(
    supabase as any,
    context.id,
    `[ROOM PLANNER EXTEND ${businessDate}] ${context.checkout_date} -> ${newCheckoutDate} | +${extensionDates.length} nights | +฿${addedTotal.toLocaleString("th-TH", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
  );

  await supabase.from("audit_logs").insert({
    actor_user_id: actorUserId,
    action: "room_planner_extend",
    entity_type: "reservation",
    entity_id: context.id,
    before_json: {
      reservation_id: context.id,
      checkout_date: context.checkout_date,
      total_price: round2(toNumber(context.total_price)),
    },
    after_json: {
      reservation_id: context.id,
      checkout_date: newCheckoutDate,
      added_nights: extensionDates,
      added_total: addedTotal,
      total_price: reservationTotal,
      room_id: roomId,
      room_number: extensionRoom?.room_number ?? null,
      rate_plan_name: priced.ratePlanName ?? null,
    },
    business_date: businessDate,
    source: normalizeAuditSource("manual"),
  });

  return {
    reservation_id: context.id,
    booking_code: context.booking_code,
    action: "EXTEND",
    original_checkout: context.checkout_date,
    new_checkout: newCheckoutDate,
    nights_added: extensionDates.length,
    current_total: round2(toNumber(context.total_price)),
    new_total: reservationTotal,
    delta: round2(reservationTotal - round2(toNumber(context.total_price))),
  };
}

async function executeShortenAction(params: {
  supabase: SupabaseLike;
  action: RoomPlannerActionInput;
  context: ReservationContext;
  businessDate: string;
  actorUserId: string;
}) {
  const { supabase, action, context, businessDate, actorUserId } = params;
  const removedNights = resolveRemovedNightsForShorten({ action, context, businessDate });
  const removedDates = buildStayDatesFromNights(removedNights);
  const cancelledAt = new Date().toISOString();

  const { error: cancelError } = await supabase
    .from("reservation_nights")
    .update({ cancelled_at: cancelledAt })
    .eq("reservation_id", context.id)
    .is("cancelled_at", null)
    .in("stay_date", removedDates);
  if (cancelError) {
    throw new RoomPlannerEngineError(cancelError.message ?? "Failed to cancel shortened nights.", 500);
  }

  const nextCheckinDate = String(action.new_checkin_date ?? "").trim() || context.checkin_date;
  const nextCheckoutDate = String(action.new_checkout_date ?? "").trim() || context.checkout_date;
  const reservationTotal = await recomputeReservationTotalPrice(supabase, context.id);
  const { error: updateReservationError } = await supabase
    .from("reservations")
    .update({
      checkin_date: nextCheckinDate,
      checkout_date: nextCheckoutDate,
      total_price: reservationTotal,
    })
    .eq("id", context.id);
  if (updateReservationError) {
    throw new RoomPlannerEngineError(updateReservationError.message ?? "Failed to update shortened reservation.", 500);
  }

  const removedTotal = round2(removedNights.reduce((sum, night) => sum + round2(toNumber(night.nightly_price)), 0));
  await appendReservationNoteLine(
    supabase as any,
    context.id,
    `[ROOM PLANNER SHORTEN ${businessDate}] ${context.checkin_date}→${context.checkout_date} => ${nextCheckinDate}→${nextCheckoutDate} | -${removedDates.length} nights | -฿${removedTotal.toLocaleString("th-TH", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
  );

  await supabase.from("audit_logs").insert({
    actor_user_id: actorUserId,
    action: "room_planner_shorten",
    entity_type: "reservation",
    entity_id: context.id,
    before_json: {
      reservation_id: context.id,
      checkin_date: context.checkin_date,
      checkout_date: context.checkout_date,
      total_price: round2(toNumber(context.total_price)),
    },
    after_json: {
      reservation_id: context.id,
      checkin_date: nextCheckinDate,
      checkout_date: nextCheckoutDate,
      removed_nights: removedDates,
      removed_total: removedTotal,
      total_price: reservationTotal,
    },
    business_date: businessDate,
    source: normalizeAuditSource("manual"),
  });

  return {
    reservation_id: context.id,
    booking_code: context.booking_code,
    action: "SHORTEN",
    original_checkin: context.checkin_date,
    original_checkout: context.checkout_date,
    new_checkin: nextCheckinDate,
    new_checkout: nextCheckoutDate,
    nights_removed: removedDates.length,
    current_total: round2(toNumber(context.total_price)),
    new_total: reservationTotal,
    delta: round2(reservationTotal - round2(toNumber(context.total_price))),
  };
}

async function executeSwapPair(params: {
  supabase: SupabaseLike;
  pairId: string;
  swapActions: RoomPlannerActionInput[];
  swapContexts: ReservationContext[];
  swapTargetRooms: RoomRow[];
  roomsById: Map<string, RoomRow>;
  businessDate: string;
  actorUserId: string;
  ratePlanNamesById: Map<string, string>;
}): Promise<{ results: Record<string, unknown>[] }> {
  const {
    supabase,
    pairId,
    swapActions,
    swapContexts,
    swapTargetRooms,
    roomsById,
    businessDate,
    actorUserId,
    ratePlanNamesById,
  } = params;

  // Build per-member data
  const members: Array<{
    action: RoomPlannerActionInput;
    context: ReservationContext;
    targetRoom: RoomRow;
    affected: ReservationNightRow[];
    stayDates: string[];
    pricing: PricingComputation;
  }> = [];

  for (let i = 0; i < swapActions.length; i++) {
    const action = swapActions[i];
    const context = swapContexts[i];
    const targetRoom = swapTargetRooms[i];
    const affected = buildAffectedNights(context, businessDate);
    if (affected.length === 0) {
      throw new RoomPlannerEngineError(
        `Swap pair ${pairId}: no future nights for ${context.booking_code ?? context.id}.`,
        409
      );
    }
    const pricing = await computeMovePricing({
      supabase,
      action,
      context,
      targetRoom,
      affectedNights: affected,
      ratePlanNamesById,
    });
    members.push({
      action,
      context,
      targetRoom,
      affected,
      stayDates: buildStayDatesFromNights(affected),
      pricing,
    });
  }

  const restoreOriginalAssignments = async (): Promise<string[]> => {
    const rollbackErrors: string[] = [];
    for (const member of members) {
      for (const night of member.affected) {
        const { error } = await supabase
          .from("reservation_nights")
          .update({
            room_id: night.room_id,
            room_type_id: night.room_type_id,
            assignment_source: night.assignment_source,
            dependency_plan_id: night.dependency_plan_id,
            dependency_reason: night.dependency_reason,
          })
          .eq("reservation_id", member.context.id)
          .eq("stay_date", night.stay_date)
          .is("cancelled_at", null);
        if (error) {
          rollbackErrors.push(
            `restore ${member.context.booking_code ?? member.context.id} ${night.stay_date}: ${error.message ?? "unknown"}`
          );
        }
      }
    }
    return rollbackErrors;
  };

  try {
    // ─── 3-step swap to avoid unique constraint (uq_reservation_nights_room_date_session) ───
    // Step 1: NULL out ALL members' room_ids → frees up all rooms
    // Step 2: Assign each member to their target room (safe, all slots cleared)
    // Step 3: reprice + write logs

    // Step 1: Clear all members' room_ids
    for (const member of members) {
      const clearResult = await supabase
        .from("reservation_nights")
        .update({ room_id: null })
        .eq("reservation_id", member.context.id)
        .is("cancelled_at", null)
        .in("stay_date", member.stayDates);
      if (clearResult.error) {
        throw new RoomPlannerEngineError(
          clearResult.error.message ?? `Failed to clear swap slot for ${member.context.booking_code ?? member.context.id}.`,
          500
        );
      }
    }

    // Step 2: Assign each member to their target room
    for (const member of members) {
      const updateResult = await supabase
        .from("reservation_nights")
        .update({
          room_id: member.targetRoom.id,
          room_type_id: member.targetRoom.room_type_id,
          assignment_source: "manual",
          dependency_plan_id: null,
          dependency_reason: null,
        })
        .eq("reservation_id", member.context.id)
        .is("cancelled_at", null)
        .in("stay_date", member.stayDates);
      if (updateResult.error) {
        throw new RoomPlannerEngineError(
          updateResult.error.message ?? `Failed to apply swap for ${member.context.booking_code ?? member.context.id}.`,
          500
        );
      }
    }

    // Update nightly prices
    for (const member of members) {
      await updateNightlyPrices({
        supabase,
        reservationId: member.context.id,
        nightlyPricesByDate: member.pricing.byStayDate,
      });
    }

    // Recompute totals
    const totals = await Promise.all(
      members.map((m) => recomputeReservationTotalPrice(supabase, m.context.id))
    );

    // Notes + audit logs
    const auditRows: any[] = [];
    const otherBookingCodes = (excludeId: string) =>
      members
        .filter((m) => m.context.id !== excludeId)
        .map((m) => m.context.booking_code ?? m.context.id.slice(0, 8))
        .join(", ");

    for (let i = 0; i < members.length; i++) {
      const member = members[i];
      const sourceRoomId = String(member.action.from_room_id ?? "").trim() ||
        String(resolveActionCurrentRoomId(member.context, businessDate) ?? "");
      const sourceRoomNumber = roomsById.get(sourceRoomId)?.room_number ?? "unknown";

      await appendReservationNoteLine(
        supabase as any,
        member.context.id,
        `[ROOM PLANNER SWAP ${businessDate}] pair=${pairId} | ${sourceRoomNumber} -> ${member.targetRoom.room_number} | with ${otherBookingCodes(member.context.id)}`
      );

      auditRows.push({
        actor_user_id: actorUserId,
        action: "room_planner_swap",
        entity_type: "reservation",
        entity_id: member.context.id,
        before_json: {
          reservation_id: member.context.id,
          booking_code: member.context.booking_code,
          source_room_id: sourceRoomId || null,
          source_room_number: sourceRoomNumber,
          stay_dates: member.stayDates,
          current_total: member.pricing.currentTotal,
        },
        after_json: {
          reservation_id: member.context.id,
          target_room_id: member.targetRoom.id,
          target_room_number: member.targetRoom.room_number,
          pair_id: pairId,
          swapped_with: otherBookingCodes(member.context.id),
          stay_dates: member.stayDates,
          new_total: member.pricing.newTotal,
          delta: member.pricing.delta,
          reservation_total_price: totals[i],
        },
        business_date: businessDate,
        source: normalizeAuditSource("manual"),
      });
    }

    await supabase.from("audit_logs").insert(auditRows);

    return {
      results: members.map((member) => ({
        reservation_id: member.context.id,
        booking_code: member.context.booking_code,
        action: "MOVE_WHOLE",
        swap_pair_id: pairId,
        to_room_number: member.targetRoom.room_number,
        nights_affected: member.stayDates.length,
        current_total: member.pricing.currentTotal,
        new_total: member.pricing.newTotal,
        delta: member.pricing.delta,
      })),
    };
  } catch (error) {
    const baseMessage = error instanceof Error ? error.message : String(error);
    const rollbackErrors = await restoreOriginalAssignments();
    if (rollbackErrors.length > 0) {
      throw new RoomPlannerEngineError(
        `Swap failed; rollback failed (${rollbackErrors.join(" | ")}). Original error: ${baseMessage}`,
        500
      );
    }
    const status = error instanceof RoomPlannerEngineError ? error.status : 500;
    throw new RoomPlannerEngineError(`Swap failed and was rolled back: ${baseMessage}`, status);
  }
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

  if (action.type === "MOVE_NIGHTS") {
    const roomId = String(action.to_room_id ?? "");
    const targetRoom = roomsById.get(roomId);
    assertTargetRoomUsable(targetRoom, roomId);
    return executeMoveNightsAction({
      supabase,
      action,
      context,
      targetRoom: targetRoom!,
      businessDate,
      actorUserId,
      ratePlanNamesById,
      roomsById,
    });
  }

  if (action.type === "EXTEND") {
    return executeExtendAction({
      supabase,
      action,
      context,
      roomsById,
      businessDate,
      actorUserId,
      ratePlanNamesById,
    });
  }

  if (action.type === "SHORTEN") {
    return executeShortenAction({
      supabase,
      action,
      context,
      businessDate,
      actorUserId,
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

  const normalizedActions = dedupeActions(actions);
  const reservationIds = normalizedActions.map((action) => action.reservation_id);
  const contexts = await loadReservationContexts(supabase, reservationIds);
  const targetRoomIds = normalizedActions
    .filter((action) => action.type === "MOVE_WHOLE" || action.type === "ASSIGN" || action.type === "MOVE_NIGHTS")
    .map((action) => String(action.to_room_id ?? ""));
  // Also load from_room_ids for resolving room numbers in preview
  const fromRoomIds = normalizedActions
    .filter((action) => action.from_room_id)
    .map((action) => String(action.from_room_id ?? ""));
  // Load current room_ids from contexts' nights
  const contextRoomIds = Array.from(contexts.values())
    .flatMap((ctx) => ctx.nights.map((n) => n.room_id).filter(Boolean) as string[]);
  const roomsById = await loadRoomsByIds(supabase, [...targetRoomIds, ...fromRoomIds, ...new Set(contextRoomIds)]);
  const ratePlanIds = Array.from(contexts.values())
    .map((context) => context.rate_plan_id)
    .filter((id): id is string => Boolean(id));
  const ratePlanNamesById = await loadRatePlanNames(supabase, ratePlanIds);
  const businessDate = await resolvePlannerBusinessDate(supabase);
  const hkCache = new Map<string, string | null>();
  const { childrenByParent, linkedMembersByRoot } = await hydrateLinkedContextMaps({
    supabase,
    actions: normalizedActions,
    contexts,
  });

  for (const action of normalizedActions) {
    ensureActionBasics(action);
    const context = contexts.get(action.reservation_id);
    if (!context) throw new RoomPlannerEngineError(`Reservation ${action.reservation_id} not found.`, 404);
    ensureReservationGuards({ action, context });
    if (action.type === "MOVE_WHOLE" || action.type === "ASSIGN" || action.type === "MOVE_NIGHTS") {
      const roomId = String(action.to_room_id ?? "");
      const targetRoom = roomsById.get(roomId);
      assertTargetRoomUsable(targetRoom, roomId);
      await assertTargetRoomHousekeepingReady({
        supabase,
        action,
        context,
        targetRoom: targetRoom!,
        businessDate,
        hkCache,
      });
    }

    if (action.type === "MOVE_WHOLE" || action.type === "EXTEND" || action.type === "SHORTEN") {
      const rootId = resolveLinkedRootId({ action, context, childrenByParent });
      if (rootId) {
        const members = linkedMembersByRoot.get(rootId) ?? [];
        if (members.length > 1) {
          if (action.type === "MOVE_WHOLE") {
            computeLinkedMovableMembers({ rootId, members });
          }
          if (action.type === "EXTEND" || action.type === "SHORTEN") {
            assertLinkedResizeGuard({
              action,
              context,
              contexts,
              linkedMembersByRoot,
              childrenByParent,
            });
          }
        }
      }
    }
  }

  validateSwapPairs({
    actions: normalizedActions,
    contexts,
    roomsById,
    businessDate,
  });

  await validateDraftMergedState({
    supabase,
    actions: normalizedActions,
    contexts,
    roomsById,
    businessDate,
  });

  const previews: ActionPricingPreview[] = [];
  const warnings: string[] = [];

  for (let actionIndex = 0; actionIndex < normalizedActions.length; actionIndex += 1) {
    const action = normalizedActions[actionIndex];
    const context = contexts.get(action.reservation_id);
    if (!context) continue;

    if (action.type === "MOVE_WHOLE") {
      const affected = buildAffectedNights(context, businessDate);
      if (affected.length === 0) {
        previews.push(buildActionPreviewFallback(actionIndex, action.type, context));
        warnings.push(`Action ${actionIndex}: no future nights affected for ${context.booking_code ?? context.id}.`);
        continue;
      }
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
          roomsById,
        })
      );
      continue;
    }

    if (action.type === "MOVE_NIGHTS") {
      const affected = buildMoveNightRows({ action, context, businessDate });
      if (affected.length === 0) {
        previews.push(buildActionPreviewFallback(actionIndex, action.type, context));
        warnings.push(`Action ${actionIndex}: no nights selected for ${context.booking_code ?? context.id}.`);
        continue;
      }
      const targetRoom = roomsById.get(String(action.to_room_id ?? ""));
      assertTargetRoomUsable(targetRoom, String(action.to_room_id ?? ""));
      previews.push(
        await buildMoveNightsPreview({
          supabase,
          actionIndex,
          action,
          context,
          targetRoom: targetRoom!,
          affectedNights: affected,
          ratePlanNamesById,
          roomsById,
        })
      );
      continue;
    }

    if (action.type === "EXTEND") {
      previews.push(
        await buildExtendPreview({
          supabase,
          actionIndex,
          action,
          context,
          roomsById,
          ratePlanNamesById,
          businessDate,
        })
      );
      continue;
    }

    if (action.type === "SHORTEN") {
      previews.push(
        buildShortenPreview({
          actionIndex,
          action,
          context,
          businessDate,
        })
      );
      continue;
    }

    previews.push({
      ...buildActionPreviewFallback(actionIndex, action.type, context),
      action_type: action.type,
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

  const businessDate = await resolvePlannerBusinessDate(supabase);
  const linkedExpanded = await expandLinkedMoveActionsForCommit({
    supabase,
    actions,
    businessDate,
  });
  const preparedActions = linkedExpanded.actions;
  const contexts = linkedExpanded.contexts;
  const targetRoomIds = preparedActions
    .filter((action) => action.type === "MOVE_WHOLE" || action.type === "ASSIGN" || action.type === "MOVE_NIGHTS")
    .map((action) => String(action.to_room_id ?? ""));
  const fromRoomIds = preparedActions
    .filter((action) => action.from_room_id)
    .map((action) => String(action.from_room_id ?? ""));
  // Also load current room_ids from contexts' nights for resolving source room numbers
  const contextRoomIds = Array.from(contexts.values())
    .flatMap((ctx) => ctx.nights.map((n) => n.room_id).filter(Boolean) as string[]);
  const roomsById = await loadRoomsByIds(supabase, [...targetRoomIds, ...fromRoomIds, ...new Set(contextRoomIds)]);
  const ratePlanIds = Array.from(contexts.values())
    .map((context) => context.rate_plan_id)
    .filter((id): id is string => Boolean(id));
  const ratePlanNamesById = await loadRatePlanNames(supabase, ratePlanIds);
  const hkCache = new Map<string, string | null>();
  const { childrenByParent, linkedMembersByRoot } = await hydrateLinkedContextMaps({
    supabase,
    actions: preparedActions,
    contexts,
  });

  for (const action of preparedActions) {
    ensureActionBasics(action);
    const context = contexts.get(action.reservation_id);
    if (!context) throw new RoomPlannerEngineError(`Reservation ${action.reservation_id} not found.`, 404);
    ensureReservationGuards({ action, context });
    if (action.type === "MOVE_WHOLE" || action.type === "ASSIGN" || action.type === "MOVE_NIGHTS") {
      const roomId = String(action.to_room_id ?? "");
      const targetRoom = roomsById.get(roomId);
      assertTargetRoomUsable(targetRoom, roomId);
      await assertTargetRoomHousekeepingReady({
        supabase,
        action,
        context,
        targetRoom: targetRoom!,
        businessDate,
        hkCache,
      });
    }

    if (action.type === "MOVE_WHOLE" || action.type === "EXTEND" || action.type === "SHORTEN") {
      const rootId = resolveLinkedRootId({ action, context, childrenByParent });
      if (rootId) {
        const members = linkedMembersByRoot.get(rootId) ?? [];
        if (members.length > 1) {
          if (action.type === "MOVE_WHOLE") {
            computeLinkedMovableMembers({ rootId, members });
          }
          if (action.type === "EXTEND" || action.type === "SHORTEN") {
            assertLinkedResizeGuard({
              action,
              context,
              contexts,
              linkedMembersByRoot,
              childrenByParent,
            });
          }
        }
      }
    }
  }

  validateSwapPairs({
    actions: preparedActions,
    contexts,
    roomsById,
    businessDate,
  });

  await validateDraftMergedState({
    supabase,
    actions: preparedActions,
    contexts,
    roomsById,
    businessDate,
  });

  const executed: ExecutedActionResult[] = [];
  const failed: FailedActionResult[] = [];
  const rolledBack: number[] = [];
  const warnings: string[] = [];
  const snapshots: Array<{ actionIndex: number; snapshot: ReservationSnapshot }> = [];
  if (preparedActions.length > actions.length) {
    warnings.push(
      `Auto-expanded linked move actions: ${actions.length} -> ${preparedActions.length}.`
    );
  }

  const swapPairs = buildSwapPairIndexes(preparedActions);
  const handledSwapPairIds = new Set<string>();

  for (let actionIndex = 0; actionIndex < preparedActions.length; actionIndex += 1) {
    const action = preparedActions[actionIndex];
    const reservationId = action.reservation_id;

    if (hasSwapPairId(action)) {
      const pairId = normalizeSwapPairId(action);
      if (handledSwapPairIds.has(pairId)) {
        continue;
      }
      handledSwapPairIds.add(pairId);

      const pairIndexes = (swapPairs.get(pairId) ?? []).sort((left, right) => left - right);
      if (pairIndexes.length < 2) {
        failed.push({
          action_index: actionIndex,
          error: `Invalid swap pair ${pairId}: expected at least 2 actions, got ${pairIndexes.length}.`,
        });
        break;
      }

      // Gather all swap members
      const pairMemberActions = pairIndexes.map((i) => preparedActions[i]);
      const pairMemberContexts: ReservationContext[] = [];
      const pairMemberRooms: RoomRow[] = [];
      let missingContext = false;

      for (const pairAction of pairMemberActions) {
        const ctx = contexts.get(pairAction.reservation_id);
        if (!ctx) {
          failed.push({
            action_index: pairIndexes[0],
            error: `Reservation context missing for swap pair ${pairId}.`,
          });
          missingContext = true;
          break;
        }
        pairMemberContexts.push(ctx);
        const room = roomsById.get(String(pairAction.to_room_id ?? ""));
        assertTargetRoomUsable(room, String(pairAction.to_room_id ?? ""));
        pairMemberRooms.push(room!);
      }
      if (missingContext) break;

      try {
        // Capture snapshots for all members
        for (let pi = 0; pi < pairIndexes.length; pi++) {
          const snap = await captureReservationSnapshot(supabase, pairMemberActions[pi].reservation_id);
          snapshots.push({ actionIndex: pairIndexes[pi], snapshot: snap });
        }

        const pairResult = await executeSwapPair({
          supabase,
          pairId,
          swapActions: pairMemberActions,
          swapContexts: pairMemberContexts,
          swapTargetRooms: pairMemberRooms,
          roomsById,
          businessDate,
          actorUserId,
          ratePlanNamesById,
        });

        for (let pi = 0; pi < pairIndexes.length; pi++) {
          executed.push({
            action_index: pairIndexes[pi],
            result: pairResult.results[pi],
          });
        }

        const refreshed = await loadReservationContexts(
          supabase,
          pairMemberActions.map((a) => a.reservation_id)
        );
        for (const [id, context] of refreshed.entries()) {
          contexts.set(id, context);
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        failed.push({
          action_index: pairIndexes[0],
          error: message,
        });
        break;
      }
      continue;
    }

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
