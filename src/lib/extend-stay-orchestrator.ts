import { addDays, compareDateStrings, isValidDateString, listNights } from "@/lib/dates";
import { normalizeAuditSource, toBangkokDateString, type AuditSource } from "@/lib/audit-utils";
import {
  appendReservationNoteLine,
  assertNoOverlapWithinReservation,
  assertRoomAvailableForDateRange,
  clampDiscountValue,
  DiscountType,
  listReservationPlannedMoves,
  normalizeDiscountType,
  normalizePricingPolicy,
  PlannedRoomMoveError,
  PricingPolicy,
  rebuildReservationFutureRoomPath,
  resolvePlannedMoveSourceSnapshotId,
  validatePlannedMoveDateRange,
} from "@/lib/planned-room-moves";
import { executeRoomMove, RoomMoveError } from "@/lib/room-move";
import { AssignedRoomLockError, assertAssignedRoomUnlockedOrOverride } from "@/lib/assigned-room-lock";
import { evaluateRoomSwapEligibility, loadReservationSwapContext, RoomSwapError } from "@/lib/room-swap";

type SupabaseLike = {
  from: (table: string) => any;
  rpc: (fn: string, args?: Record<string, unknown>) => any;
};

export type ExtendStayStrategy = "same_room" | "different_room";
export type ExtendStayMoveMode = "move_now" | "plan_move";

export type ExtendStayPreviewInput = {
  reservationId: string;
  newCheckoutDate: string;
  strategy: ExtendStayStrategy;
  moveMode?: ExtendStayMoveMode | null;
  targetRoomId?: string | null;
  targetRoomTypeId?: number | null;
  planStartDate?: string | null;
  pricingPolicy?: unknown;
  discountType?: unknown;
  discountValue?: unknown;
  discountReason?: unknown;
};

export type ExtendStayCommitInput = ExtendStayPreviewInput & {
  selectedBlockerReservationId?: string | null;
  selectedBlockerTargetRoomId?: string | null;
  note?: string | null;
  auditSource?: AuditSource;
};

type OrchestratorContext = {
  reservation: {
    id: string;
    booking_code: string;
    guest_name: string;
    status: string;
    source: string;
    checkin_date: string;
    checkout_date: string;
  };
  extensionCheckinDate: string;
  extensionCheckoutDate: string;
  lockedRoomId: string;
  lockedRoomTypeId: number;
  lockedRoomNumber: string | null;
  lockedRoomTypeName: string;
  today: string;
  pricingPolicy: PricingPolicy;
  discountType: DiscountType;
  discountValue: number;
  discountReason: string | null;
};

type BlockingItem = {
  reservation_id: string;
  booking_code: string;
  guest_name: string;
  room_number: string | null;
  room_type_id: number | null;
  room_type_name: string | null;
  checkin_date: string;
  checkout_date: string;
  conflict_stay_dates: string[];
  checked_in: boolean;
  swap_diagnostic: { can_swap: boolean; reason_code: string | null; reason: string | null } | null;
};

type SwapCandidate = {
  blocker_reservation_id: string;
  blocker_booking_code: string;
  blocker_guest_name: string;
  candidate_room_id: string;
  candidate_room_number: string;
  candidate_room_type_id: number;
  move_start_date: string;
  move_checkout_date: string;
};

type ReservationRoomMeta = {
  room_id: string | null;
  room_type_id: number | null;
  room_number: string | null;
};

export type ExtendStayPreviewResult = {
  can_commit: boolean;
  source: string;
  mode: "extend_inplace";
  extra_nights: number;
  extension_dates: string[];
  impacted_segments: Array<Record<string, unknown>>;
  blocking_items: BlockingItem[];
  swap_candidates: SwapCandidate[];
  price_preview: {
    pricing_policy: PricingPolicy;
    estimated_delta: number | null;
    note: string;
    total_additional: number;
  };
  warnings: string[];
  blocker_is_checked_in: boolean;
  current_room_number: string;
  current_room_type_name: string;
  available_target_rooms: Array<{ id: string; room_number: string; room_type_id: number; room_type_name: string | null }>;
};

export type ExtendStayCommitResult = {
  success: boolean;
  reservation_id: string;
  extension_reservation_id: null;
  mode: "extend_inplace";
  executed_actions: Array<Record<string, unknown>>;
  failed_actions: Array<Record<string, unknown>>;
  pending_fix_action: string | null;
  warnings: string[];
};

export class ExtendStayOrchestratorError extends Error {
  status: number;

  constructor(message: string, status = 400) {
    super(message);
    this.name = "ExtendStayOrchestratorError";
    this.status = status;
  }
}

function toBangkokDate(date = new Date()) {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Bangkok" }).format(date);
}

function asString(value: unknown): string {
  return String(value ?? "").trim();
}

function ensureArray<T>(value: T[] | null | undefined): T[] {
  return Array.isArray(value) ? value : [];
}

function toNumber(value: unknown): number {
  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function round2(value: number): number {
  return Number(value.toFixed(2));
}

function summarizeExecutedActions(actions: Array<Record<string, unknown>>): string {
  const labels = actions
    .map((action) => asString(action.action).replaceAll("_", " "))
    .filter(Boolean);
  return labels.length > 0 ? labels.join(", ") : "none";
}

async function appendExtendSummaryNote(params: {
  supabase: SupabaseLike;
  reservationId: string;
  today: string;
  oldCheckoutDate: string;
  newCheckoutDate: string;
  strategy: ExtendStayStrategy;
  moveMode: ExtendStayMoveMode | null;
  targetRoomNumber: string | null;
  executedActions: Array<Record<string, unknown>>;
  pendingFixAction: string | null;
}) {
  const {
    supabase,
    reservationId,
    today,
    oldCheckoutDate,
    newCheckoutDate,
    strategy,
    moveMode,
    targetRoomNumber,
    executedActions,
    pendingFixAction,
  } = params;

  const noteParts = [
    `[EXTEND STAY ${today}] ${oldCheckoutDate} -> ${newCheckoutDate}`,
    `STRATEGY: ${strategy}`,
    `MOVE: ${moveMode ?? "n/a"}`,
    targetRoomNumber ? `TARGET ROOM: ${targetRoomNumber}` : null,
    `ACTIONS: ${summarizeExecutedActions(executedActions)}`,
    pendingFixAction ? `PENDING FIX: ${pendingFixAction}` : null,
  ].filter(Boolean);

  await appendReservationNoteLine(supabase as any, reservationId, noteParts.join(" | "));
}

function applyDiscount(rackRate: number, discountType: DiscountType, discountValue: number): number {
  if (discountType === "percent") {
    return round2(Math.max(0, rackRate * (1 - discountValue / 100)));
  }
  return round2(Math.max(0, rackRate - discountValue));
}

async function fetchRackRateByDate(params: {
  supabase: SupabaseLike;
  roomTypeId: number;
  stayDates: string[];
}): Promise<Map<string, number>> {
  const { supabase, roomTypeId, stayDates } = params;
  const map = new Map<string, number>();
  if (!Number.isFinite(roomTypeId) || roomTypeId <= 0 || stayDates.length === 0) {
    return map;
  }

  const { data: rooms, error: roomsError } = await supabase
    .from("rooms")
    .select("id")
    .eq("room_type_id", roomTypeId)
    .eq("is_sellable", true);
  if (roomsError || !rooms || rooms.length === 0) return map;

  const roomIds = rooms.map((row: any) => String(row?.id ?? "")).filter(Boolean);
  if (roomIds.length === 0) return map;

  const { data: rates, error: ratesError } = await supabase
    .from("rate_templates")
    .select("stay_date, price")
    .in("room_id", roomIds)
    .in("stay_date", stayDates);
  if (ratesError || !rates) return map;

  const grouped = new Map<string, number[]>();
  for (const row of rates) {
    const stayDate = String((row as any)?.stay_date ?? "");
    if (!stayDate) continue;
    const list = grouped.get(stayDate) ?? [];
    list.push(toNumber((row as any)?.price));
    grouped.set(stayDate, list);
  }

  for (const stayDate of stayDates) {
    const prices = grouped.get(stayDate) ?? [];
    if (prices.length === 0) continue;
    const avg = prices.reduce((sum, price) => sum + price, 0) / prices.length;
    map.set(stayDate, round2(avg));
  }

  return map;
}

async function resolveRoomTypeNameById(supabase: SupabaseLike, roomTypeId: number): Promise<string> {
  const { data, error } = await supabase
    .from("room_types")
    .select("name_en")
    .eq("id", roomTypeId)
    .maybeSingle();
  if (error) throw new ExtendStayOrchestratorError(error.message ?? "Failed to load room type.", 500);
  return asString(data?.name_en) || `Room Type #${roomTypeId}`;
}

async function resolveRoomTypeNamesByIds(supabase: SupabaseLike, roomTypeIds: number[]): Promise<Map<number, string>> {
  const ids = Array.from(new Set(roomTypeIds.filter((id) => Number.isFinite(id) && id > 0)));
  const map = new Map<number, string>();
  if (ids.length === 0) return map;

  const { data, error } = await supabase
    .from("room_types")
    .select("id, name_en")
    .in("id", ids);
  if (error) throw new ExtendStayOrchestratorError(error.message ?? "Failed to load room types.", 500);

  for (const row of ensureArray<any>(data)) {
    const roomTypeId = Number(row?.id ?? 0);
    if (!Number.isFinite(roomTypeId) || roomTypeId <= 0) continue;
    map.set(roomTypeId, asString(row?.name_en) || `Room Type #${roomTypeId}`);
  }

  for (const roomTypeId of ids) {
    if (!map.has(roomTypeId)) {
      map.set(roomTypeId, `Room Type #${roomTypeId}`);
    }
  }

  return map;
}

async function loadOrchestratorContext(
  supabase: SupabaseLike,
  input: ExtendStayPreviewInput
): Promise<OrchestratorContext> {
  const { reservationId, newCheckoutDate } = input;

  if (!isValidDateString(newCheckoutDate)) {
    throw new ExtendStayOrchestratorError("Invalid new_checkout_date.", 400);
  }

  const { data: reservation, error: reservationError } = await supabase
    .from("reservations")
    .select("id, booking_code, guest_name, status, source, checkin_date, checkout_date")
    .eq("id", reservationId)
    .maybeSingle();
  if (reservationError) throw new ExtendStayOrchestratorError(reservationError.message ?? "Failed to load reservation.", 500);
  if (!reservation) throw new ExtendStayOrchestratorError("Reservation not found.", 404);
  if (String(reservation.status) !== "active") {
    throw new ExtendStayOrchestratorError("Only active reservations can extend stay.", 400);
  }

  const extensionCheckinDate = String(reservation.checkout_date);
  if (compareDateStrings(newCheckoutDate, extensionCheckinDate) <= 0) {
    throw new ExtendStayOrchestratorError("new_checkout_date must be after current checkout date.", 400);
  }

  const previousStayDate = addDays(extensionCheckinDate, -1);
  const { data: lastAssignedNight, error: lastAssignedNightError } = await supabase
    .from("reservation_nights")
    .select("room_id, room_type_id, rooms(room_number)")
    .eq("reservation_id", reservationId)
    .is("cancelled_at", null)
    .lte("stay_date", previousStayDate)
    .order("stay_date", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (lastAssignedNightError) {
    throw new ExtendStayOrchestratorError(lastAssignedNightError.message ?? "Failed to resolve current room lock.", 500);
  }

  const lockedRoomId = asString(lastAssignedNight?.room_id);
  const lockedRoomTypeId = Number(lastAssignedNight?.room_type_id ?? 0);
  const lockedRoomNumber = asString((lastAssignedNight as any)?.rooms?.room_number) || null;

  if (!lockedRoomId) {
    throw new ExtendStayOrchestratorError("Cannot extend stay: current assigned room is missing.", 409);
  }
  if (!Number.isFinite(lockedRoomTypeId) || lockedRoomTypeId <= 0) {
    throw new ExtendStayOrchestratorError("Cannot extend stay: current room type is missing.", 409);
  }

  return {
    reservation: {
      id: String(reservation.id),
      booking_code: asString(reservation.booking_code) || String(reservation.id),
      guest_name: asString(reservation.guest_name) || "Guest",
      status: String(reservation.status),
      source: String(reservation.source),
      checkin_date: String(reservation.checkin_date),
      checkout_date: String(reservation.checkout_date),
    },
    extensionCheckinDate,
    extensionCheckoutDate: newCheckoutDate,
    lockedRoomId,
    lockedRoomTypeId,
    lockedRoomNumber,
    lockedRoomTypeName: await resolveRoomTypeNameById(supabase, lockedRoomTypeId),
    today: toBangkokDate(),
    pricingPolicy: normalizePricingPolicy(input.pricingPolicy),
    discountType: normalizeDiscountType(input.discountType),
    discountValue: clampDiscountValue(input.discountValue),
    discountReason: asString(input.discountReason) || null,
  };
}

async function loadReservationRoomMeta(supabase: SupabaseLike, reservationId: string) {
  const { data: row, error } = await supabase
    .from("reservation_nights")
    .select("room_id, room_type_id, rooms(room_number)")
    .eq("reservation_id", reservationId)
    .is("cancelled_at", null)
    .order("stay_date", { ascending: true })
    .limit(1)
    .maybeSingle();
  if (error) throw new ExtendStayOrchestratorError(error.message ?? "Failed to load reservation room meta.", 500);
  return {
    room_id: asString(row?.room_id) || null,
    room_type_id: Number(row?.room_type_id ?? 0) || null,
    room_number: asString((row as any)?.rooms?.room_number) || null,
  };
}

async function loadReservationRoomMetaBatch(
  supabase: SupabaseLike,
  reservationIds: string[]
): Promise<Map<string, ReservationRoomMeta>> {
  const ids = Array.from(new Set(reservationIds.map((value) => asString(value)).filter(Boolean)));
  const map = new Map<string, ReservationRoomMeta>();
  if (ids.length === 0) return map;

  const { data, error } = await supabase
    .from("reservation_nights")
    .select("reservation_id, room_id, room_type_id, stay_date, rooms(room_number)")
    .in("reservation_id", ids)
    .is("cancelled_at", null)
    .order("stay_date", { ascending: true });
  if (error) throw new ExtendStayOrchestratorError(error.message ?? "Failed to load reservation room meta.", 500);

  for (const row of ensureArray<any>(data)) {
    const reservationId = asString(row?.reservation_id);
    if (!reservationId || map.has(reservationId)) continue;
    map.set(reservationId, {
      room_id: asString(row?.room_id) || null,
      room_type_id: Number(row?.room_type_id ?? 0) || null,
      room_number: asString((row as any)?.rooms?.room_number) || null,
    });
  }

  return map;
}

async function loadCandidateRoomsByTypeIds(
  supabase: SupabaseLike,
  roomTypeIds: number[],
  currentRoomId: string
): Promise<Map<number, Array<{ id: string; room_number: string; room_type_id: number }>>> {
  const ids = Array.from(new Set(roomTypeIds.filter((id) => Number.isFinite(id) && id > 0)));
  const result = new Map<number, Array<{ id: string; room_number: string; room_type_id: number }>>();
  if (ids.length === 0) return result;

  const { data: rooms, error: roomsError } = await supabase
    .from("rooms")
    .select("id, room_number, room_type_id, is_sellable, is_dayuse")
    .in("room_type_id", ids)
    .eq("is_sellable", true)
    .neq("id", currentRoomId);
  if (roomsError) {
    throw new ExtendStayOrchestratorError(roomsError.message ?? "Failed to load blocker target rooms.", 500);
  }

  for (const room of ensureArray<any>(rooms)) {
    if (Boolean(room?.is_dayuse)) continue;
    const roomTypeId = Number(room?.room_type_id ?? 0);
    const roomId = asString(room?.id);
    const roomNumber = asString(room?.room_number);
    if (!roomId || !roomNumber || !Number.isFinite(roomTypeId) || roomTypeId <= 0) continue;
    const list = result.get(roomTypeId) ?? [];
    list.push({ id: roomId, room_number: roomNumber, room_type_id: roomTypeId });
    result.set(roomTypeId, list);
  }

  return result;
}

async function listBlockingReservationNights(params: {
  supabase: SupabaseLike;
  roomId: string;
  checkinDate: string;
  checkoutDate: string;
  excludeReservationId: string;
}) {
  const { supabase, roomId, checkinDate, checkoutDate, excludeReservationId } = params;
  const { data, error } = await supabase
    .from("reservation_nights")
    .select("reservation_id, stay_date")
    .eq("room_id", roomId)
    .gte("stay_date", checkinDate)
    .lt("stay_date", checkoutDate)
    .is("cancelled_at", null)
    .neq("reservation_id", excludeReservationId)
    .order("stay_date", { ascending: true });
  if (error) throw new ExtendStayOrchestratorError(error.message ?? "Failed to load blocking reservations.", 500);
  return ensureArray<any>(data);
}

async function listBlockingItems(params: {
  supabase: SupabaseLike;
  ctx: OrchestratorContext;
}): Promise<BlockingItem[]> {
  const { supabase, ctx } = params;
  const blockingNights = await listBlockingReservationNights({
    supabase,
    roomId: ctx.lockedRoomId,
    checkinDate: ctx.extensionCheckinDate,
    checkoutDate: ctx.extensionCheckoutDate,
    excludeReservationId: ctx.reservation.id,
  });

  const byReservation = new Map<string, string[]>();
  for (const row of blockingNights) {
    const reservationId = asString(row.reservation_id);
    if (!reservationId) continue;
    const list = byReservation.get(reservationId) ?? [];
    list.push(String(row.stay_date));
    byReservation.set(reservationId, list);
  }
  const ids = Array.from(byReservation.keys());
  if (ids.length === 0) return [];

  const { data: reservations, error: reservationsError } = await supabase
    .from("reservations")
    .select("id, booking_code, guest_name, checkin_date, checkout_date, checked_in_at")
    .in("id", ids);
  if (reservationsError) {
    throw new ExtendStayOrchestratorError(reservationsError.message ?? "Failed to load blocker reservations.", 500);
  }

  const sourceSwapContext = await loadReservationSwapContext(supabase as any, ctx.reservation.id).catch(() => null);
  const blockerReservationIds = ensureArray<any>(reservations).map((reservation) => String(reservation.id));
  const [roomMetaByReservationId, blockerSwapContexts] = await Promise.all([
    loadReservationRoomMetaBatch(supabase, blockerReservationIds),
    Promise.all(blockerReservationIds.map((reservationId) => loadReservationSwapContext(supabase as any, reservationId).catch(() => null))),
  ]);
  const blockerSwapContextByReservationId = new Map<string, any>();
  blockerSwapContexts.forEach((context, index) => {
    const reservationId = blockerReservationIds[index];
    if (context && reservationId) {
      blockerSwapContextByReservationId.set(reservationId, context);
    }
  });
  const roomTypeNameById = await resolveRoomTypeNamesByIds(
    supabase,
    Array.from(
      new Set(
        blockerReservationIds
          .map((reservationId) => roomMetaByReservationId.get(reservationId)?.room_type_id ?? 0)
          .filter((roomTypeId) => Number.isFinite(roomTypeId) && roomTypeId > 0)
      )
    )
  );

  const items: BlockingItem[] = [];
  for (const reservation of ensureArray<any>(reservations)) {
    const reservationId = String(reservation.id);
    const roomMeta = roomMetaByReservationId.get(reservationId) ?? { room_id: null, room_type_id: null, room_number: null };
    const swapContext = blockerSwapContextByReservationId.get(reservationId) ?? null;
    let swapDiagnostic: BlockingItem["swap_diagnostic"] = null;
    if (sourceSwapContext && swapContext) {
      try {
        const evalResult = await evaluateRoomSwapEligibility(supabase as any, sourceSwapContext as any, swapContext as any);
        swapDiagnostic = {
          can_swap: Boolean(evalResult.can_swap),
          reason_code: evalResult.reason_code ?? null,
          reason: evalResult.reason ?? null,
        };
      } catch {
        swapDiagnostic = null;
      }
    }

    items.push({
      reservation_id: reservationId,
      booking_code: asString(reservation.booking_code) || reservationId,
      guest_name: asString(reservation.guest_name) || "Guest",
      room_number: roomMeta.room_number,
      room_type_id: roomMeta.room_type_id,
      room_type_name: roomMeta.room_type_id ? roomTypeNameById.get(roomMeta.room_type_id) ?? `Room Type #${roomMeta.room_type_id}` : null,
      checkin_date: String(reservation.checkin_date),
      checkout_date: String(reservation.checkout_date),
      conflict_stay_dates: byReservation.get(reservationId) ?? [],
      checked_in: Boolean(reservation.checked_in_at),
      swap_diagnostic: swapDiagnostic,
    });
  }

  return items.sort((left, right) => {
    if (left.checked_in !== right.checked_in) return left.checked_in ? -1 : 1;
    return left.booking_code.localeCompare(right.booking_code);
  });
}

function deriveMoveStartDate(params: { today: string; checkinDate: string }) {
  const { today, checkinDate } = params;
  return compareDateStrings(today, checkinDate) > 0 ? today : checkinDate;
}

async function listSwapAssistCandidates(params: {
  supabase: SupabaseLike;
  blockers: BlockingItem[];
  currentRoomId: string;
  today: string;
}) {
  const { supabase, blockers, currentRoomId, today } = params;
  const candidates: SwapCandidate[] = [];
  const candidateRoomsByTypeId = await loadCandidateRoomsByTypeIds(
    supabase,
    blockers.map((blocker) => Number(blocker.room_type_id ?? 0)),
    currentRoomId
  );

  for (const blocker of blockers) {
    if (!blocker.room_type_id) continue;
    const moveStartDate = deriveMoveStartDate({ today, checkinDate: blocker.checkin_date });
    if (compareDateStrings(blocker.checkout_date, moveStartDate) <= 0) continue;

    const rooms = candidateRoomsByTypeId.get(blocker.room_type_id) ?? [];
    for (const room of rooms) {
      const candidateRoomId = String(room.id ?? "");
      const candidateRoomNumber = asString(room.room_number);
      if (!candidateRoomId || !candidateRoomNumber) continue;

      try {
        await assertRoomAvailableForDateRange(supabase as any, {
          roomId: candidateRoomId,
          checkinDate: moveStartDate,
          checkoutDate: blocker.checkout_date,
          excludeReservationId: blocker.reservation_id,
        });
        candidates.push({
          blocker_reservation_id: blocker.reservation_id,
          blocker_booking_code: blocker.booking_code,
          blocker_guest_name: blocker.guest_name,
          candidate_room_id: candidateRoomId,
          candidate_room_number: candidateRoomNumber,
          candidate_room_type_id: Number(room.room_type_id ?? blocker.room_type_id),
          move_start_date: moveStartDate,
          move_checkout_date: blocker.checkout_date,
        });
      } catch {
        // candidate unavailable, ignore
      }
    }
  }

  return candidates.sort((left, right) => {
    if (left.blocker_booking_code !== right.blocker_booking_code) {
      return left.blocker_booking_code.localeCompare(right.blocker_booking_code);
    }
    return left.candidate_room_number.localeCompare(right.candidate_room_number);
  });
}

async function listAvailableTargetRooms(params: {
  supabase: SupabaseLike;
  ctx: OrchestratorContext;
  input: ExtendStayPreviewInput;
}) {
  const { supabase, ctx, input } = params;
  if (input.strategy !== "different_room") return [];

  const targetRoomTypeId = Number(input.targetRoomTypeId ?? 0) || ctx.lockedRoomTypeId;
  const { data: rooms, error: roomsError } = await supabase
    .from("rooms")
    .select("id, room_number, room_type_id, is_sellable, is_dayuse")
    .eq("room_type_id", targetRoomTypeId)
    .eq("is_sellable", true);
  if (roomsError) throw new ExtendStayOrchestratorError(roomsError.message ?? "Failed to load target rooms.", 500);

  const roomTypeName = await resolveRoomTypeNameById(supabase, targetRoomTypeId);
  const available: Array<{ id: string; room_number: string; room_type_id: number; room_type_name: string | null }> = [];

  for (const room of ensureArray<any>(rooms)) {
    if (Boolean(room.is_dayuse)) continue;
    const roomId = String(room.id ?? "");
    const roomNumber = asString(room.room_number);
    if (!roomId || !roomNumber || roomId === ctx.lockedRoomId) continue;

    const moveMode = input.moveMode ?? null;
    const rangeStart =
      moveMode === "plan_move" && input.planStartDate && isValidDateString(input.planStartDate)
        ? input.planStartDate
        : ctx.extensionCheckinDate;

    try {
      await assertRoomAvailableForDateRange(supabase as any, {
        roomId,
        checkinDate: rangeStart,
        checkoutDate: ctx.extensionCheckoutDate,
        excludeReservationId: ctx.reservation.id,
      });
      available.push({
        id: roomId,
        room_number: roomNumber,
        room_type_id: Number(room.room_type_id ?? targetRoomTypeId),
        room_type_name: roomTypeName,
      });
    } catch {
      // unavailable target room, skip
    }
  }

  return available.sort((left, right) => left.room_number.localeCompare(right.room_number));
}

async function resolveLastNightlyRate(params: {
  supabase: SupabaseLike;
  reservationId: string;
}): Promise<number> {
  const { supabase, reservationId } = params;
  const { data: lastNight, error } = await supabase
    .from("reservation_nights")
    .select("nightly_price")
    .eq("reservation_id", reservationId)
    .is("cancelled_at", null)
    .order("stay_date", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw new ExtendStayOrchestratorError(error.message ?? "Failed to load last nightly price.", 500);
  return round2(Math.max(0, toNumber(lastNight?.nightly_price)));
}

async function buildPricePreview(params: {
  supabase: SupabaseLike;
  ctx: OrchestratorContext;
  input: ExtendStayPreviewInput;
  extensionDates: string[];
}) {
  const { supabase, ctx, input, extensionDates } = params;
  if (extensionDates.length === 0) {
    return {
      pricing_policy: ctx.pricingPolicy,
      estimated_delta: 0,
      note: "No additional nights.",
      total_additional: 0,
    };
  }

  const pricingRoomTypeId =
    input.strategy === "different_room"
      ? Number(input.targetRoomTypeId ?? 0) || ctx.lockedRoomTypeId
      : ctx.lockedRoomTypeId;

  const lastNightlyRate = await resolveLastNightlyRate({ supabase, reservationId: ctx.reservation.id });

  let totalAdditional = 0;
  if (ctx.pricingPolicy === "keep_rtc") {
    totalAdditional = round2(lastNightlyRate * extensionDates.length);
  } else {
    const rackByDate = await fetchRackRateByDate({
      supabase,
      roomTypeId: pricingRoomTypeId,
      stayDates: extensionDates,
    });
    totalAdditional = round2(
      extensionDates.reduce((sum, stayDate) => {
        const rack = round2(rackByDate.get(stayDate) ?? lastNightlyRate);
        const nightly =
          ctx.pricingPolicy === "reprice_grid_discount"
            ? applyDiscount(rack, ctx.discountType, ctx.discountValue)
            : rack;
        return sum + nightly;
      }, 0)
    );
  }

  return {
    pricing_policy: ctx.pricingPolicy,
    estimated_delta: totalAdditional,
    note:
      ctx.pricingPolicy === "keep_rtc"
        ? "Additional nights use current nightly rate (keep_rtc)."
        : ctx.pricingPolicy === "reprice_grid"
          ? "Additional nights use rack/grid rate for selected room type."
          : "Additional nights use rack/grid rate with discount policy.",
    total_additional: totalAdditional,
  };
}

function buildImpactedSegments(params: {
  ctx: OrchestratorContext;
  input: ExtendStayPreviewInput;
  blockers: BlockingItem[];
}) {
  const { ctx, input, blockers } = params;
  const segments: Array<Record<string, unknown>> = [
    {
      reservation_id: ctx.reservation.id,
      booking_code: ctx.reservation.booking_code,
      segment_type: "extend_inplace",
      checkin_date: ctx.extensionCheckinDate,
      checkout_date: ctx.extensionCheckoutDate,
      room_number: ctx.lockedRoomNumber,
    },
  ];

  if (input.strategy === "different_room" && input.moveMode === "move_now") {
    segments.push({
      reservation_id: ctx.reservation.id,
      booking_code: ctx.reservation.booking_code,
      segment_type: "move_extension",
      start_date: ctx.extensionCheckinDate,
      checkout_date: ctx.extensionCheckoutDate,
    });
  }

  if (input.strategy === "different_room" && input.moveMode === "plan_move" && input.planStartDate) {
    segments.push({
      reservation_id: ctx.reservation.id,
      booking_code: ctx.reservation.booking_code,
      segment_type: "plan_move_extension",
      start_date: input.planStartDate,
      checkout_date: ctx.extensionCheckoutDate,
    });
  }

  if (input.strategy === "same_room" && blockers.length > 0) {
    segments.push({
      reservation_id: "blocker_pending",
      segment_type: "blocker_move_assist",
      blockers: blockers.map((blocker) => ({
        reservation_id: blocker.reservation_id,
        booking_code: blocker.booking_code,
        guest_name: blocker.guest_name,
      })),
    });
  }

  return segments;
}

async function recomputeReservationTotalPrice(params: {
  supabase: SupabaseLike;
  reservationId: string;
}) {
  const { supabase, reservationId } = params;
  const { data: allActiveNights, error: totalError } = await supabase
    .from("reservation_nights")
    .select("nightly_price")
    .eq("reservation_id", reservationId)
    .is("cancelled_at", null);
  if (totalError) {
    throw new ExtendStayOrchestratorError(totalError.message ?? "Failed to recompute reservation total.", 500);
  }
  return round2(ensureArray<any>(allActiveNights).reduce((sum, item) => sum + toNumber(item?.nightly_price), 0));
}

async function applySegmentPricingProjection(params: {
  supabase: SupabaseLike;
  reservationId: string;
  startDate: string;
  endDate: string;
  targetRoomTypeId: number;
  pricingPolicy: PricingPolicy;
  discountType: DiscountType;
  discountValue: number;
}) {
  const {
    supabase,
    reservationId,
    startDate,
    endDate,
    targetRoomTypeId,
    pricingPolicy,
    discountType,
    discountValue,
  } = params;

  if (pricingPolicy === "keep_rtc") return;

  const { data: nights, error: nightsError } = await supabase
    .from("reservation_nights")
    .select("id, stay_date, nightly_price")
    .eq("reservation_id", reservationId)
    .is("cancelled_at", null)
    .gte("stay_date", startDate)
    .lt("stay_date", endDate)
    .order("stay_date", { ascending: true });
  if (nightsError) {
    throw new ExtendStayOrchestratorError(nightsError.message ?? "Failed to load nights for pricing projection.", 500);
  }
  const stayDates = ensureArray<any>(nights).map((row) => String(row?.stay_date ?? "")).filter(Boolean);
  if (stayDates.length === 0) return;

  const rackByDate = await fetchRackRateByDate({
    supabase,
    roomTypeId: targetRoomTypeId,
    stayDates,
  });

  for (const row of ensureArray<any>(nights)) {
    const nightId = asString(row?.id);
    const stayDate = asString(row?.stay_date);
    if (!nightId || !stayDate) continue;
    const currentNightlyPrice = round2(toNumber(row?.nightly_price));
    const rackNightlyPrice = round2(rackByDate.get(stayDate) ?? currentNightlyPrice);
    const projectedNightlyPrice =
      pricingPolicy === "reprice_grid_discount"
        ? applyDiscount(rackNightlyPrice, discountType, discountValue)
        : rackNightlyPrice;

    const { error: updateNightError } = await supabase
      .from("reservation_nights")
      .update({ nightly_price: projectedNightlyPrice })
      .eq("id", nightId);
    if (updateNightError) {
      throw new ExtendStayOrchestratorError(updateNightError.message ?? "Failed to project nightly price.", 500);
    }
  }

  const reservationTotal = await recomputeReservationTotalPrice({ supabase, reservationId });
  const { error: reservationUpdateError } = await supabase
    .from("reservations")
    .update({ total_price: reservationTotal })
    .eq("id", reservationId);
  if (reservationUpdateError) {
    throw new ExtendStayOrchestratorError(reservationUpdateError.message ?? "Failed to update reservation total.", 500);
  }
}

async function insertPlannedMove(params: {
  supabase: SupabaseLike;
  reservationId: string;
  startDate: string;
  endDate: string;
  targetRoomId: string;
  targetRoomTypeId: number;
  moveReason: string;
  pricingPolicy: PricingPolicy;
  discountType: DiscountType;
  discountValue: number;
  discountReason: string | null;
  today: string;
}) {
  const {
    supabase,
    reservationId,
    startDate,
    endDate,
    targetRoomId,
    targetRoomTypeId,
    moveReason,
    pricingPolicy,
    discountType,
    discountValue,
    discountReason,
    today,
  } = params;

  const { data: reservation, error: reservationError } = await supabase
    .from("reservations")
    .select("id, status, checkin_date, checkout_date")
    .eq("id", reservationId)
    .maybeSingle();
  if (reservationError) {
    throw new ExtendStayOrchestratorError(reservationError.message ?? "Failed to load reservation for plan move.", 500);
  }
  if (!reservation) throw new ExtendStayOrchestratorError("Reservation not found for plan move.", 404);
  if (String(reservation.status) !== "active") {
    throw new ExtendStayOrchestratorError("Only active reservations can be planned for room moves.", 400);
  }

  validatePlannedMoveDateRange({
    startDate,
    endDate,
    today,
    reservationCheckinDate: String(reservation.checkin_date),
    reservationCheckoutDate: String(reservation.checkout_date),
  });

  const existingPlans = await listReservationPlannedMoves(supabase as any, reservationId);
  assertNoOverlapWithinReservation(existingPlans, { startDate, endDate });

  const fromRoomIdSnapshot = await resolvePlannedMoveSourceSnapshotId(supabase as any, {
    reservationId,
    startDate,
    reservationCheckinDate: String(reservation.checkin_date),
  });

  const { data: inserted, error: insertError } = await supabase
    .from("reservation_room_plans")
    .insert({
      reservation_id: reservationId,
      start_date: startDate,
      end_date: endDate,
      from_room_id_snapshot: fromRoomIdSnapshot,
      to_room_type_id: targetRoomTypeId,
      to_room_id: targetRoomId,
      move_reason: moveReason,
      pricing_policy: pricingPolicy,
      discount_type: pricingPolicy === "reprice_grid_discount" ? discountType : null,
      discount_value: pricingPolicy === "reprice_grid_discount" ? discountValue : null,
      discount_reason: pricingPolicy === "reprice_grid_discount" ? discountReason : null,
      do_not_move: false,
      do_not_move_note: null,
      status: "planned",
      created_by: null,
      updated_by: null,
    })
    .select("id, reservation_id, start_date, end_date")
    .maybeSingle();
  if (insertError) {
    throw new ExtendStayOrchestratorError(insertError.message ?? "Failed to create planned move segment.", 500);
  }

  const roomIds = [fromRoomIdSnapshot, targetRoomId].filter(Boolean) as string[];
  const roomNumberById = new Map<string, string>();
  if (roomIds.length > 0) {
    const { data: roomRows, error: roomRowsError } = await supabase
      .from("rooms")
      .select("id, room_number")
      .in("id", roomIds);
    if (roomRowsError) {
      throw new ExtendStayOrchestratorError(roomRowsError.message ?? "Failed to resolve room numbers for plan note.", 500);
    }
    for (const row of ensureArray<any>(roomRows)) {
      const roomId = asString(row?.id);
      const roomNumber = asString(row?.room_number);
      if (!roomId || !roomNumber) continue;
      roomNumberById.set(roomId, roomNumber);
    }
  }

  const sourceRoomNumber = fromRoomIdSnapshot
    ? roomNumberById.get(String(fromRoomIdSnapshot)) ?? "unknown"
    : "unknown";
  const targetRoomNumber = roomNumberById.get(String(targetRoomId)) ?? "unknown";
  const policyLabel =
    pricingPolicy === "keep_rtc"
      ? "POLICY: Keep RTC"
      : pricingPolicy === "reprice_grid"
        ? "POLICY: Reprice Grid"
        : `POLICY: Reprice Grid + Discount (${discountType}:${discountValue})${discountReason ? ` [${discountReason}]` : ""}`;

  await appendReservationNoteLine(
    supabase as any,
    reservationId,
    `[PLANNED MOVE CREATE ${today}] ${sourceRoomNumber} -> ${targetRoomNumber} | DATES: ${startDate} -> ${endDate} | REASON: ${moveReason} | ${policyLabel}`
  );

  await rebuildReservationFutureRoomPath(supabase as any, { reservationId });
  await applySegmentPricingProjection({
    supabase,
    reservationId,
    startDate,
    endDate,
    targetRoomTypeId,
    pricingPolicy,
    discountType,
    discountValue,
  });
  return inserted;
}

async function writeExtendAudit(params: {
  supabase: SupabaseLike;
  reservationId: string;
  payload: Record<string, unknown>;
  auditSource?: AuditSource;
}) {
  const { supabase, reservationId, payload, auditSource } = params;
  await supabase.from("audit_logs").insert({
    action: "extend_stay",
    entity_type: "reservation",
    entity_id: reservationId,
    before_json: null,
    after_json: payload,
    business_date: toBangkokDateString(),
    source: normalizeAuditSource(auditSource ?? "manual"),
  });
}

async function resolveTargetRoomMeta(params: {
  supabase: SupabaseLike;
  targetRoomId: string;
}) {
  const { supabase, targetRoomId } = params;
  const { data: targetRoom, error } = await supabase
    .from("rooms")
    .select("id, room_number, room_type_id, is_sellable, is_dayuse")
    .eq("id", targetRoomId)
    .maybeSingle();
  if (error) throw new ExtendStayOrchestratorError(error.message ?? "Failed to load target room.", 500);
  if (!targetRoom) throw new ExtendStayOrchestratorError("Selected target room not found.", 404);
  if (!Boolean(targetRoom.is_sellable) || Boolean(targetRoom.is_dayuse)) {
    throw new ExtendStayOrchestratorError("Selected target room is not available for stay extension.", 409);
  }
  return {
    id: String(targetRoom.id),
    room_number: asString(targetRoom.room_number),
    room_type_id: Number(targetRoom.room_type_id ?? 0),
  };
}

async function insertExtensionNights(params: {
  supabase: SupabaseLike;
  reservationId: string;
  roomId: string;
  roomTypeId: number;
  extensionDates: string[];
  pricingPolicy: PricingPolicy;
  discountType: DiscountType;
  discountValue: number;
  baselineNightlyRate: number;
}) {
  const {
    supabase,
    reservationId,
    roomId,
    roomTypeId,
    extensionDates,
    pricingPolicy,
    discountType,
    discountValue,
    baselineNightlyRate,
  } = params;

  if (extensionDates.length === 0) {
    return {
      inserted_nights: 0,
      inserted_total: 0,
    };
  }

  let nightlyMap = new Map<string, number>();
  if (pricingPolicy === "keep_rtc") {
    for (const stayDate of extensionDates) {
      nightlyMap.set(stayDate, baselineNightlyRate);
    }
  } else {
    const rackByDate = await fetchRackRateByDate({
      supabase,
      roomTypeId,
      stayDates: extensionDates,
    });
    for (const stayDate of extensionDates) {
      const rack = round2(rackByDate.get(stayDate) ?? baselineNightlyRate);
      const nightly =
        pricingPolicy === "reprice_grid_discount"
          ? applyDiscount(rack, discountType, discountValue)
          : rack;
      nightlyMap.set(stayDate, nightly);
    }
  }

  const insertRows = extensionDates.map((stayDate) => ({
    reservation_id: reservationId,
    room_id: roomId,
    room_type_id: roomTypeId,
    stay_date: stayDate,
    nightly_price: round2(nightlyMap.get(stayDate) ?? baselineNightlyRate),
    is_ota: false,
  }));

  const { error: insertError } = await supabase.from("reservation_nights").insert(insertRows);
  if (insertError) {
    throw new ExtendStayOrchestratorError(insertError.message ?? "Failed to insert extension nights.", 500);
  }

  const insertedTotal = round2(
    extensionDates.reduce((sum, stayDate) => sum + round2(nightlyMap.get(stayDate) ?? baselineNightlyRate), 0)
  );

  return {
    inserted_nights: extensionDates.length,
    inserted_total: insertedTotal,
  };
}

async function updateReservationCheckoutAndTotal(params: {
  supabase: SupabaseLike;
  reservationId: string;
  newCheckoutDate: string;
}) {
  const { supabase, reservationId, newCheckoutDate } = params;
  const reservationTotal = await recomputeReservationTotalPrice({ supabase, reservationId });

  const { error: reservationUpdateError } = await supabase
    .from("reservations")
    .update({ checkout_date: newCheckoutDate, total_price: reservationTotal })
    .eq("id", reservationId);
  if (reservationUpdateError) {
    throw new ExtendStayOrchestratorError(reservationUpdateError.message ?? "Failed to update reservation totals.", 500);
  }

  return reservationTotal;
}

export async function previewExtendStay(params: {
  supabase: SupabaseLike;
  input: ExtendStayPreviewInput;
}): Promise<ExtendStayPreviewResult> {
  const { supabase, input } = params;
  const ctx = await loadOrchestratorContext(supabase, input);

  const warnings: string[] = [];
  const extensionDates = listNights(ctx.extensionCheckinDate, ctx.extensionCheckoutDate);

  const blockers = input.strategy === "same_room" ? await listBlockingItems({ supabase, ctx }) : [];
  const blockerIsCheckedIn = blockers.some((row) => row.checked_in);
  const checkedInBlocker = blockers.find((row) => row.checked_in);

  if (blockerIsCheckedIn && (checkedInBlocker?.room_number ?? "").trim()) {
    warnings.push(`แขกห้อง ${checkedInBlocker?.room_number} check-in อยู่ ย้ายจะต้องแจ้งแขก`);
  } else if (blockerIsCheckedIn) {
    warnings.push("แขก blocker check-in อยู่ ย้ายจะต้องแจ้งแขก");
  }

  const swapCandidates = input.strategy === "same_room"
    ? await listSwapAssistCandidates({
      supabase,
      blockers,
      currentRoomId: ctx.lockedRoomId,
      today: ctx.today,
    })
    : [];

  let canCommit = true;
  let sameRoomAvailabilityBlocked = false;
  if (input.strategy === "same_room") {
    await assertRoomAvailableForDateRange(supabase as any, {
      roomId: ctx.lockedRoomId,
      checkinDate: ctx.extensionCheckinDate,
      checkoutDate: ctx.extensionCheckoutDate,
      excludeReservationId: ctx.reservation.id,
    }).catch((error) => {
      const message = error instanceof Error ? error.message : "Current room is not available for extension range.";
      if (!warnings.includes(message)) warnings.push(message);
      sameRoomAvailabilityBlocked = true;
    });
  }

  if (sameRoomAvailabilityBlocked && blockers.length === 0) {
    canCommit = false;
  }

  if (input.strategy === "same_room" && blockers.length > 0 && swapCandidates.length === 0) {
    canCommit = false;
    warnings.push("ไม่มีห้องว่างสำหรับย้าย blocker — ให้เลือก strategy Different Room แทน");
  }

  const availableTargetRooms = await listAvailableTargetRooms({ supabase, ctx, input });
  if (input.strategy === "different_room") {
    if (!input.moveMode) {
      canCommit = false;
      warnings.push("move_mode is required for different_room strategy.");
    }
    if (!input.targetRoomId) {
      canCommit = false;
      warnings.push("target_room_id is required for different_room strategy.");
    } else {
      const roomExists = availableTargetRooms.some((room) => room.id === input.targetRoomId);
      if (!roomExists) {
        canCommit = false;
        warnings.push("Selected target room is not available for the impacted dates.");
      }
    }
    if (input.moveMode === "plan_move") {
      if (!input.planStartDate || !isValidDateString(input.planStartDate)) {
        canCommit = false;
        warnings.push("plan_start_date is required for plan_move strategy.");
      } else if (compareDateStrings(input.planStartDate, ctx.extensionCheckinDate) < 0) {
        canCommit = false;
        warnings.push("plan_start_date must be on or after extension check-in date.");
      } else if (compareDateStrings(input.planStartDate, ctx.extensionCheckoutDate) >= 0) {
        canCommit = false;
        warnings.push("plan_start_date must be before new_checkout_date.");
      }

      await assertRoomAvailableForDateRange(supabase as any, {
        roomId: ctx.lockedRoomId,
        checkinDate: ctx.extensionCheckinDate,
        checkoutDate: ctx.extensionCheckoutDate,
        excludeReservationId: ctx.reservation.id,
      }).catch((error) => {
        canCommit = false;
        const message = error instanceof Error ? error.message : "Current room is not available for extension range.";
        if (!warnings.includes(message)) warnings.push(message);
      });
    }
  }

  const impactedSegments = buildImpactedSegments({ ctx, input, blockers });
  const pricePreview = await buildPricePreview({
    supabase,
    ctx,
    input,
    extensionDates,
  });

  return {
    can_commit: canCommit,
    source: ctx.reservation.source,
    mode: "extend_inplace",
    extra_nights: extensionDates.length,
    extension_dates: extensionDates,
    impacted_segments: impactedSegments,
    blocking_items: blockers,
    swap_candidates: swapCandidates,
    price_preview: pricePreview,
    warnings,
    blocker_is_checked_in: blockerIsCheckedIn,
    current_room_number: ctx.lockedRoomNumber ?? "",
    current_room_type_name: ctx.lockedRoomTypeName,
    available_target_rooms: availableTargetRooms,
  };
}

export async function commitExtendStay(params: {
  supabase: SupabaseLike;
  input: ExtendStayCommitInput;
}): Promise<ExtendStayCommitResult> {
  const { supabase, input } = params;
  const ctx = await loadOrchestratorContext(supabase, input);
  const preview = await previewExtendStay({ supabase, input });
  const auditSource = normalizeAuditSource(input.auditSource ?? "manual");

  if (!preview.can_commit) {
    throw new ExtendStayOrchestratorError(preview.warnings[0] ?? "Precheck failed.", 409);
  }

  const executedActions: Array<Record<string, unknown>> = [];
  const failedActions: Array<Record<string, unknown>> = [];
  const warnings = [...preview.warnings];
  let pendingFixAction: string | null = null;

  if (input.strategy === "same_room" && preview.blocking_items.length > 0) {
    const selectedBlockerReservationId = asString(input.selectedBlockerReservationId);
    const selectedBlockerTargetRoomId = asString(input.selectedBlockerTargetRoomId);
    if (!selectedBlockerReservationId || !selectedBlockerTargetRoomId) {
      throw new ExtendStayOrchestratorError(
        "selected_blocker_reservation_id and selected_blocker_target_room_id are required for blocker assist.",
        409
      );
    }

    const blocker = preview.blocking_items.find((row) => row.reservation_id === selectedBlockerReservationId);
    if (!blocker) throw new ExtendStayOrchestratorError("Selected blocker reservation is not valid.", 409);

    const candidate = preview.swap_candidates.find((row) =>
      row.blocker_reservation_id === selectedBlockerReservationId && row.candidate_room_id === selectedBlockerTargetRoomId
    );
    if (!candidate) throw new ExtendStayOrchestratorError("Selected blocker target room is not valid.", 409);

    try {
      await assertAssignedRoomUnlockedOrOverride({
        supabase: supabase as any,
        reservationId: selectedBlockerReservationId,
        action: "move_room",
        overrideNote: "",
      });

      const blockerMove = await executeRoomMove({
        supabase: supabase as any,
        reservationId: selectedBlockerReservationId,
        newRoomId: selectedBlockerTargetRoomId,
        reason: "Extend stay blocker assist",
        pricingPolicy: "keep_rtc",
        discountType: "percent",
        discountValue: 0,
        startDate: candidate.move_start_date,
        endDate: addDays(candidate.move_checkout_date, -1),
        notePrefix: "Extend Stay Assist",
        auditAction: "extend_stay_blocker_moved",
        auditSource,
      });

      executedActions.push({
        action: "move_blocker",
        reservation_id: selectedBlockerReservationId,
        to_room: blockerMove.to_room,
        moved_stay_dates: blockerMove.moved_stay_dates,
      });
    } catch (error) {
      failedActions.push({
        action: "move_blocker",
        error: error instanceof Error ? error.message : String(error),
      });
      pendingFixAction = `Move blocker reservation ${selectedBlockerReservationId} to room ${candidate.candidate_room_number}`;
      await writeExtendAudit({
        supabase,
        reservationId: ctx.reservation.id,
        auditSource,
        payload: {
          strategy: input.strategy,
          move_mode: input.moveMode ?? null,
          target_room_id: input.targetRoomId ?? null,
          selected_blocker_reservation_id: selectedBlockerReservationId,
          selected_blocker_target_room_id: selectedBlockerTargetRoomId,
          executed_actions: executedActions,
          failed_actions: failedActions,
          pending_fix_action: pendingFixAction,
        },
      });
      return {
        success: false,
        reservation_id: ctx.reservation.id,
        extension_reservation_id: null,
        mode: "extend_inplace",
        executed_actions: executedActions,
        failed_actions: failedActions,
        pending_fix_action: pendingFixAction,
        warnings,
      };
    }
  }

  const extensionDates = listNights(ctx.extensionCheckinDate, ctx.extensionCheckoutDate);
  const baselineNightlyRate = await resolveLastNightlyRate({
    supabase,
    reservationId: ctx.reservation.id,
  });

  if (input.strategy === "same_room") {
    await assertRoomAvailableForDateRange(supabase as any, {
      roomId: ctx.lockedRoomId,
      checkinDate: ctx.extensionCheckinDate,
      checkoutDate: ctx.extensionCheckoutDate,
      excludeReservationId: ctx.reservation.id,
    });

    const inserted = await insertExtensionNights({
      supabase,
      reservationId: ctx.reservation.id,
      roomId: ctx.lockedRoomId,
      roomTypeId: ctx.lockedRoomTypeId,
      extensionDates,
      pricingPolicy: "keep_rtc",
      discountType: ctx.discountType,
      discountValue: ctx.discountValue,
      baselineNightlyRate,
    });
    const reservationTotalAfterInsert = await updateReservationCheckoutAndTotal({
      supabase,
      reservationId: ctx.reservation.id,
      newCheckoutDate: ctx.extensionCheckoutDate,
    });

    executedActions.push({
      action: "extend_inplace",
      reservation_id: ctx.reservation.id,
      inserted_nights: inserted.inserted_nights,
      extension_dates: extensionDates,
      room_number: ctx.lockedRoomNumber,
      reservation_total_price: reservationTotalAfterInsert,
    });

    if (ctx.pricingPolicy !== "keep_rtc") {
      await applySegmentPricingProjection({
        supabase,
        reservationId: ctx.reservation.id,
        startDate: ctx.extensionCheckinDate,
        endDate: ctx.extensionCheckoutDate,
        targetRoomTypeId: ctx.lockedRoomTypeId,
        pricingPolicy: ctx.pricingPolicy,
        discountType: ctx.discountType,
        discountValue: ctx.discountValue,
      });
      executedActions.push({
        action: "reprice_extension_nights",
        reservation_id: ctx.reservation.id,
        pricing_policy: ctx.pricingPolicy,
      });
    }
  } else {
    const targetRoomId = asString(input.targetRoomId);
    if (!targetRoomId) {
      throw new ExtendStayOrchestratorError("target_room_id is required for different_room strategy.", 400);
    }
    const targetRoom = await resolveTargetRoomMeta({ supabase, targetRoomId });
    const moveMode = input.moveMode ?? null;

    if (!moveMode) {
      throw new ExtendStayOrchestratorError("move_mode is required for different_room strategy.", 400);
    }

    if (moveMode === "move_now") {
      let insertedOnCurrentRoom = true;
      try {
        await assertRoomAvailableForDateRange(supabase as any, {
          roomId: ctx.lockedRoomId,
          checkinDate: ctx.extensionCheckinDate,
          checkoutDate: ctx.extensionCheckoutDate,
          excludeReservationId: ctx.reservation.id,
        });
      } catch {
        insertedOnCurrentRoom = false;
      }

      if (insertedOnCurrentRoom) {
        const inserted = await insertExtensionNights({
          supabase,
          reservationId: ctx.reservation.id,
          roomId: ctx.lockedRoomId,
          roomTypeId: ctx.lockedRoomTypeId,
          extensionDates,
          pricingPolicy: "keep_rtc",
          discountType: ctx.discountType,
          discountValue: ctx.discountValue,
          baselineNightlyRate,
        });
        const reservationTotalAfterInsert = await updateReservationCheckoutAndTotal({
          supabase,
          reservationId: ctx.reservation.id,
          newCheckoutDate: ctx.extensionCheckoutDate,
        });

        executedActions.push({
          action: "extend_inplace",
          reservation_id: ctx.reservation.id,
          inserted_nights: inserted.inserted_nights,
          extension_dates: extensionDates,
          room_number: ctx.lockedRoomNumber,
          reservation_total_price: reservationTotalAfterInsert,
        });

        try {
          await assertAssignedRoomUnlockedOrOverride({
            supabase: supabase as any,
            reservationId: ctx.reservation.id,
            action: "move_room",
            overrideNote: "",
          });

          const extensionMove = await executeRoomMove({
            supabase: supabase as any,
            reservationId: ctx.reservation.id,
            newRoomId: targetRoom.id,
            reason: "Extend stay move-now (extension nights)",
            pricingPolicy: ctx.pricingPolicy,
            discountType: ctx.discountType,
            discountValue: ctx.discountValue,
            discountReason: ctx.discountReason ?? undefined,
            startDate: ctx.extensionCheckinDate,
            endDate: addDays(ctx.extensionCheckoutDate, -1),
            notePrefix: "Extend Stay Orchestrator",
            auditAction: "extend_stay_extension_moved",
            appendNoteLine: true,
            auditSource,
          });

          executedActions.push({
            action: "move_extension",
            reservation_id: ctx.reservation.id,
            to_room: extensionMove.to_room,
            moved_stay_dates: extensionMove.moved_stay_dates,
            delta: extensionMove.future_total_delta,
          });
        } catch (error) {
          failedActions.push({
            action: "move_extension",
            error: error instanceof Error ? error.message : String(error),
          });
          pendingFixAction = `Move extension nights of reservation ${ctx.reservation.booking_code} to room ${targetRoom.room_number}`;
          await writeExtendAudit({
            supabase,
            reservationId: ctx.reservation.id,
            auditSource,
            payload: {
              strategy: input.strategy,
              move_mode: moveMode,
              target_room_id: targetRoom.id,
              executed_actions: executedActions,
              failed_actions: failedActions,
              pending_fix_action: pendingFixAction,
            },
          });
          return {
            success: false,
            reservation_id: ctx.reservation.id,
            extension_reservation_id: null,
            mode: "extend_inplace",
            executed_actions: executedActions,
            failed_actions: failedActions,
            pending_fix_action: pendingFixAction,
            warnings,
          };
        }
      } else {
        warnings.push(
          "Current room is not available for the extension range; extension nights were assigned directly to the selected target room."
        );
        const inserted = await insertExtensionNights({
          supabase,
          reservationId: ctx.reservation.id,
          roomId: targetRoom.id,
          roomTypeId: targetRoom.room_type_id,
          extensionDates,
          pricingPolicy: ctx.pricingPolicy,
          discountType: ctx.discountType,
          discountValue: ctx.discountValue,
          baselineNightlyRate,
        });
        const reservationTotalAfterInsert = await updateReservationCheckoutAndTotal({
          supabase,
          reservationId: ctx.reservation.id,
          newCheckoutDate: ctx.extensionCheckoutDate,
        });

        executedActions.push({
          action: "extend_direct_to_target",
          reservation_id: ctx.reservation.id,
          inserted_nights: inserted.inserted_nights,
          extension_dates: extensionDates,
          room_number: targetRoom.room_number,
          reservation_total_price: reservationTotalAfterInsert,
        });
      }
    } else {
      const planStartDate = asString(input.planStartDate);
      if (!planStartDate || !isValidDateString(planStartDate)) {
        throw new ExtendStayOrchestratorError("plan_start_date is required for plan_move strategy.", 400);
      }
      if (compareDateStrings(planStartDate, ctx.extensionCheckinDate) < 0) {
        throw new ExtendStayOrchestratorError("plan_start_date must be on or after extension check-in date.", 400);
      }
      if (compareDateStrings(planStartDate, ctx.extensionCheckoutDate) >= 0) {
        throw new ExtendStayOrchestratorError("plan_start_date must be before new_checkout_date.", 400);
      }

      await assertRoomAvailableForDateRange(supabase as any, {
        roomId: ctx.lockedRoomId,
        checkinDate: ctx.extensionCheckinDate,
        checkoutDate: ctx.extensionCheckoutDate,
        excludeReservationId: ctx.reservation.id,
      });

      const inserted = await insertExtensionNights({
        supabase,
        reservationId: ctx.reservation.id,
        roomId: ctx.lockedRoomId,
        roomTypeId: ctx.lockedRoomTypeId,
        extensionDates,
        pricingPolicy: "keep_rtc",
        discountType: ctx.discountType,
        discountValue: ctx.discountValue,
        baselineNightlyRate,
      });
      const reservationTotalAfterInsert = await updateReservationCheckoutAndTotal({
        supabase,
        reservationId: ctx.reservation.id,
        newCheckoutDate: ctx.extensionCheckoutDate,
      });
      executedActions.push({
        action: "extend_inplace",
        reservation_id: ctx.reservation.id,
        inserted_nights: inserted.inserted_nights,
        extension_dates: extensionDates,
        room_number: ctx.lockedRoomNumber,
        reservation_total_price: reservationTotalAfterInsert,
      });

      try {
        await assertAssignedRoomUnlockedOrOverride({
          supabase: supabase as any,
          reservationId: ctx.reservation.id,
          action: "planned_move",
          overrideNote: "",
        });
        await assertRoomAvailableForDateRange(supabase as any, {
          roomId: targetRoom.id,
          checkinDate: planStartDate,
          checkoutDate: ctx.extensionCheckoutDate,
          excludeReservationId: ctx.reservation.id,
        });

        const insertedPlan = await insertPlannedMove({
          supabase,
          reservationId: ctx.reservation.id,
          startDate: planStartDate,
          endDate: ctx.extensionCheckoutDate,
          targetRoomId: targetRoom.id,
          targetRoomTypeId: targetRoom.room_type_id,
          moveReason: "Extend stay orchestrator plan_move",
          pricingPolicy: ctx.pricingPolicy,
          discountType: ctx.discountType,
          discountValue: ctx.discountValue,
          discountReason: ctx.discountReason,
          today: ctx.today,
        });
        executedActions.push({
          action: "create_plan_segment",
          plan_id: insertedPlan?.id ?? null,
          reservation_id: ctx.reservation.id,
          start_date: planStartDate,
          end_date: ctx.extensionCheckoutDate,
          target_room_id: targetRoom.id,
          target_room_number: targetRoom.room_number,
          pricing_policy: ctx.pricingPolicy,
        });
      } catch (error) {
        failedActions.push({
          action: "create_plan_segment",
          error: error instanceof Error ? error.message : String(error),
        });
        pendingFixAction = `Create planned move for reservation ${ctx.reservation.booking_code} from ${planStartDate} to room ${targetRoom.room_number}`;
        await writeExtendAudit({
          supabase,
          reservationId: ctx.reservation.id,
          auditSource,
          payload: {
            strategy: input.strategy,
            move_mode: moveMode,
            target_room_id: targetRoom.id,
            plan_start_date: planStartDate,
            executed_actions: executedActions,
            failed_actions: failedActions,
            pending_fix_action: pendingFixAction,
          },
        });
        return {
          success: false,
          reservation_id: ctx.reservation.id,
          extension_reservation_id: null,
          mode: "extend_inplace",
          executed_actions: executedActions,
          failed_actions: failedActions,
          pending_fix_action: pendingFixAction,
          warnings,
        };
      }
    }
  }

  const summaryTargetRoomNumber =
    input.strategy === "different_room"
      ? preview.available_target_rooms.find((room) => room.id === asString(input.targetRoomId))?.room_number ?? null
      : ctx.lockedRoomNumber;

  try {
    await appendExtendSummaryNote({
      supabase,
      reservationId: ctx.reservation.id,
      today: ctx.today,
      oldCheckoutDate: ctx.reservation.checkout_date,
      newCheckoutDate: ctx.extensionCheckoutDate,
      strategy: input.strategy,
      moveMode: input.moveMode ?? null,
      targetRoomNumber: summaryTargetRoomNumber,
      executedActions,
      pendingFixAction,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    warnings.push(`Could not write extend summary note: ${message}`);
  }

  await writeExtendAudit({
    supabase,
    reservationId: ctx.reservation.id,
    auditSource,
    payload: {
      strategy: input.strategy,
      move_mode: input.moveMode ?? null,
      target_room_id: input.targetRoomId ?? null,
      plan_start_date: input.planStartDate ?? null,
      pricing_policy: ctx.pricingPolicy,
      discount_type: ctx.pricingPolicy === "reprice_grid_discount" ? ctx.discountType : null,
      discount_value: ctx.pricingPolicy === "reprice_grid_discount" ? ctx.discountValue : null,
      note: asString(input.note) || null,
      old_checkout_date: ctx.reservation.checkout_date,
      new_checkout_date: ctx.extensionCheckoutDate,
      extra_nights: extensionDates.length,
      executed_actions: executedActions,
      failed_actions: failedActions,
      pending_fix_action: pendingFixAction,
    },
  });

  return {
    success: failedActions.length === 0,
    reservation_id: ctx.reservation.id,
    extension_reservation_id: null,
    mode: "extend_inplace",
    executed_actions: executedActions,
    failed_actions: failedActions,
    pending_fix_action: pendingFixAction,
    warnings,
  };
}

export function isKnownExtendStayOrchestratorError(
  error: unknown
): error is ExtendStayOrchestratorError | PlannedRoomMoveError | AssignedRoomLockError | RoomMoveError | RoomSwapError {
  return (
    error instanceof ExtendStayOrchestratorError ||
    error instanceof PlannedRoomMoveError ||
    error instanceof AssignedRoomLockError ||
    error instanceof RoomMoveError ||
    error instanceof RoomSwapError
  );
}
