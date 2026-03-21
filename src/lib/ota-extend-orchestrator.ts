import { addDays, compareDateStrings, isValidDateString, listNights } from "@/lib/dates";
import { normalizeAuditSource, toBangkokDateString, type AuditSource } from "@/lib/audit-utils";
import {
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
import { createLinkedExtensionReservation, LinkedExtensionError } from "@/lib/linked-extension";
import { AssignedRoomLockError, assertAssignedRoomUnlockedOrOverride } from "@/lib/assigned-room-lock";
import { evaluateRoomSwapEligibility, loadReservationSwapContext, RoomSwapError } from "@/lib/room-swap";
import { OtaModificationError, shortenOtaReservationForEarlyMove } from "@/lib/ota-modification";
import { extractDepositGeneralNote, parseDepositPayloadLines } from "@/lib/deposit-ledger";

type SupabaseLike = {
  from: (table: string) => any;
  rpc: (fn: string, args?: Record<string, unknown>) => any;
};

export type OtaExtendStrategy = "same_room" | "different_room";
export type OtaMoveMode = "move_now" | "plan_move";
export type OtaModificationOption = "option_a_keep_ota" | "option_b_shorten_ota";

export type OtaExtendPreviewInput = {
  reservationId: string;
  newCheckoutDate: string;
  strategy: OtaExtendStrategy;
  moveMode?: OtaMoveMode | null;
  targetRoomId?: string | null;
  targetRoomTypeId?: number | null;
  planStartDate?: string | null;
  pricingPolicy?: unknown;
  discountType?: unknown;
  discountValue?: unknown;
  discountReason?: unknown;
  otaModificationOption?: OtaModificationOption | null;
  otaShortenCheckoutDate?: string | null;
};

export type OtaExtendCommitInput = OtaExtendPreviewInput & {
  selectedBlockerReservationId?: string | null;
  selectedBlockerTargetRoomId?: string | null;
  note?: string | null;
  copyAccompanying?: boolean;
  copyPreferences?: boolean;
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

type PlannedMoveSegment = {
  reservation_id: string;
  start_date: string;
  end_date: string;
  to_room_id: string;
  to_room_type_id: number;
  pricing_policy: PricingPolicy;
  discount_type: DiscountType;
  discount_value: number;
  discount_reason: string | null;
};

export type OtaExtendPreviewResult = {
  can_commit: boolean;
  impacted_segments: Array<Record<string, unknown>>;
  blocking_items: BlockingItem[];
  swap_candidates: SwapCandidate[];
  price_preview: {
    pricing_policy: PricingPolicy;
    estimated_delta: number | null;
    note: string;
  };
  warnings: string[];
  blocker_is_checked_in: boolean;
  current_room_number: string;
  current_room_type_name: string;
  available_target_rooms: Array<{ id: string; room_number: string; room_type_id: number; room_type_name: string | null }>;
};

export type OtaExtendCommitResult = {
  success: boolean;
  extension_reservation_id: string | null;
  executed_actions: Array<Record<string, unknown>>;
  failed_actions: Array<Record<string, unknown>>;
  pending_fix_action: string | null;
  final_price_summary: Record<string, unknown>;
  warnings: string[];
  ota_platform_update_required?: boolean;
};

export class OtaExtendOrchestratorError extends Error {
  status: number;

  constructor(message: string, status = 400) {
    super(message);
    this.name = "OtaExtendOrchestratorError";
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

function applyDiscount(rackRate: number, discountType: DiscountType, discountValue: number): number {
  if (discountType === "percent") {
    return round2(Math.max(0, rackRate * (1 - discountValue / 100)));
  }
  return round2(Math.max(0, rackRate - discountValue));
}

type DepositTransferResult = {
  transferred: boolean;
  amount: number;
  sourceBookingCode: string | null;
  targetBookingCode: string | null;
};

function mergeDepositLines(
  left: Array<{ method: string; amount: number; note?: string | null }>,
  right: Array<{ method: string; amount: number; note?: string | null }>
) {
  const merged = new Map<string, { method: string; amount: number; note: string | null }>();

  for (const line of [...left, ...right]) {
    const method = asString(line.method).toLowerCase() || "cash";
    const amount = round2(Math.max(0, toNumber(line.amount)));
    if (amount <= 0) continue;
    const existing = merged.get(method) ?? { method, amount: 0, note: null };
    existing.amount = round2(existing.amount + amount);
    if (!existing.note && asString(line.note)) existing.note = asString(line.note);
    merged.set(method, existing);
  }

  return Array.from(merged.values()).filter((line) => line.amount > 0);
}

function appendGeneralNote(current: string | null, extra: string): string {
  const normalizedCurrent = asString(current);
  if (!normalizedCurrent) return extra;
  if (normalizedCurrent.includes(extra)) return normalizedCurrent;
  return `${normalizedCurrent} | ${extra}`;
}

async function transferLinkedDepositFromOtaToExtension(params: {
  supabase: SupabaseLike;
  otaReservationId: string;
  extensionReservationId: string;
}) {
  const { supabase, otaReservationId, extensionReservationId } = params;
  const ids = [otaReservationId, extensionReservationId].filter(Boolean);
  if (ids.length !== 2) return null;

  const { data: rows, error } = await supabase
    .from("reservations")
    .select("id, booking_code, source, deposit_amount, deposit_note")
    .in("id", ids);
  if (error) {
    throw new OtaExtendOrchestratorError(error.message ?? "Failed to load reservations for deposit transfer.", 500);
  }

  const rowMap = new Map<string, any>();
  for (const row of ensureArray<any>(rows)) {
    rowMap.set(asString(row?.id), row);
  }

  const ota = rowMap.get(otaReservationId);
  const extension = rowMap.get(extensionReservationId);
  if (!ota || !extension) {
    throw new OtaExtendOrchestratorError("Deposit transfer failed: linked reservations not found.", 500);
  }

  if (asString(ota.source).toLowerCase() !== "ota") {
    return null;
  }

  const otaDepositAmount = round2(Math.max(0, toNumber(ota.deposit_amount)));
  if (otaDepositAmount <= 0) {
    return null;
  }

  const otaLines = parseDepositPayloadLines(ota.deposit_note ?? null, otaDepositAmount);
  const extensionDepositAmount = round2(Math.max(0, toNumber(extension.deposit_amount)));
  const extensionLines = parseDepositPayloadLines(extension.deposit_note ?? null, extensionDepositAmount);
  const mergedLines = mergeDepositLines(extensionLines, otaLines);

  const otaBookingCode = asString(ota.booking_code) || otaReservationId;
  const extensionBookingCode = asString(extension.booking_code) || extensionReservationId;

  const transferToExtensionNote = `Top-up from OTA ${otaBookingCode}`;
  const transferFromOtaNote = `Transferred to linked walk-in ${extensionBookingCode}`;
  const extensionGeneralNote = appendGeneralNote(
    extractDepositGeneralNote(extension.deposit_note),
    transferToExtensionNote
  );
  const otaGeneralNote = appendGeneralNote(
    extractDepositGeneralNote(ota.deposit_note),
    transferFromOtaNote
  );

  const { error: extensionDepositError } = await supabase.rpc("apply_deposit_snapshot_lines", {
    p_reservation_id: extensionReservationId,
    p_lines: mergedLines,
    p_general_note: extensionGeneralNote,
    p_cashier_name: "SYSTEM",
  });
  if (extensionDepositError) {
    throw new OtaExtendOrchestratorError(extensionDepositError.message ?? "Failed to top-up extension deposit.", 500);
  }

  const { error: otaDepositError } = await supabase.rpc("apply_deposit_snapshot_lines", {
    p_reservation_id: otaReservationId,
    p_lines: [],
    p_general_note: otaGeneralNote,
    p_cashier_name: "SYSTEM",
  });
  if (otaDepositError) {
    throw new OtaExtendOrchestratorError(otaDepositError.message ?? "Failed to refund OTA deposit.", 500);
  }

  return {
    transferred: true,
    amount: otaDepositAmount,
    sourceBookingCode: otaBookingCode || null,
    targetBookingCode: extensionBookingCode || null,
  } satisfies DepositTransferResult;
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
    throw new OtaExtendOrchestratorError(nightsError.message ?? "Failed to load nights for pricing projection.", 500);
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
      throw new OtaExtendOrchestratorError(updateNightError.message ?? "Failed to project nightly price.", 500);
    }
  }

  const { data: allActiveNights, error: totalError } = await supabase
    .from("reservation_nights")
    .select("nightly_price")
    .eq("reservation_id", reservationId)
    .is("cancelled_at", null);
  if (totalError) {
    throw new OtaExtendOrchestratorError(totalError.message ?? "Failed to recompute reservation total.", 500);
  }
  const reservationTotal = round2(
    ensureArray<any>(allActiveNights).reduce((sum, item) => sum + toNumber(item?.nightly_price), 0)
  );

  const { error: reservationUpdateError } = await supabase
    .from("reservations")
    .update({ total_price: reservationTotal })
    .eq("id", reservationId);
  if (reservationUpdateError) {
    throw new OtaExtendOrchestratorError(reservationUpdateError.message ?? "Failed to update reservation total.", 500);
  }
}

function resolveOtaModificationOption(input: OtaExtendPreviewInput): OtaModificationOption {
  return input.otaModificationOption === "option_b_shorten_ota" ? "option_b_shorten_ota" : "option_a_keep_ota";
}

function resolveOptionBShortenCheckoutDate(ctx: OrchestratorContext, input: OtaExtendPreviewInput): string {
  const candidate = asString(input.otaShortenCheckoutDate);
  return candidate && isValidDateString(candidate) ? candidate : ctx.today;
}

function validateOptionBShortenDate(params: {
  ctx: OrchestratorContext;
  shortenCheckoutDate: string;
}) {
  const { ctx, shortenCheckoutDate } = params;
  if (!isValidDateString(shortenCheckoutDate)) {
    throw new OtaExtendOrchestratorError("ota_shorten_checkout_date is invalid.", 400);
  }
  if (compareDateStrings(shortenCheckoutDate, ctx.reservation.checkin_date) <= 0) {
    throw new OtaExtendOrchestratorError("OTA shorten checkout date must be after check-in date.", 400);
  }
  if (compareDateStrings(shortenCheckoutDate, ctx.reservation.checkout_date) >= 0) {
    throw new OtaExtendOrchestratorError("OTA shorten checkout date must be earlier than OTA checkout date.", 400);
  }
  if (compareDateStrings(ctx.extensionCheckoutDate, shortenCheckoutDate) <= 0) {
    throw new OtaExtendOrchestratorError("new_checkout_date must be after ota_shorten_checkout_date.", 400);
  }
}

async function resolveRoomTypeNameById(supabase: SupabaseLike, roomTypeId: number): Promise<string> {
  const { data, error } = await supabase
    .from("room_types")
    .select("name_en")
    .eq("id", roomTypeId)
    .maybeSingle();
  if (error) throw new OtaExtendOrchestratorError(error.message ?? "Failed to load room type.", 500);
  return asString(data?.name_en) || `Room Type #${roomTypeId}`;
}

async function loadOrchestratorContext(supabase: SupabaseLike, input: OtaExtendPreviewInput): Promise<OrchestratorContext> {
  const { reservationId, newCheckoutDate } = input;

  if (!isValidDateString(newCheckoutDate)) {
    throw new OtaExtendOrchestratorError("Invalid new_checkout_date.", 400);
  }

  const { data: reservation, error: reservationError } = await supabase
    .from("reservations")
    .select("id, booking_code, guest_name, status, source, checkin_date, checkout_date")
    .eq("id", reservationId)
    .maybeSingle();
  if (reservationError) throw new OtaExtendOrchestratorError(reservationError.message ?? "Failed to load reservation.", 500);
  if (!reservation) throw new OtaExtendOrchestratorError("Reservation not found.", 404);
  if (String(reservation.status) !== "active") {
    throw new OtaExtendOrchestratorError("Only active reservations can use OTA extend orchestrator.", 400);
  }
  const extensionCheckinDate = String(reservation.checkout_date);
  if (compareDateStrings(newCheckoutDate, extensionCheckinDate) <= 0) {
    throw new OtaExtendOrchestratorError("new_checkout_date must be after current checkout date.", 400);
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
    throw new OtaExtendOrchestratorError(lastAssignedNightError.message ?? "Failed to resolve current room lock.", 500);
  }

  const lockedRoomId = asString(lastAssignedNight?.room_id);
  const lockedRoomTypeId = Number(lastAssignedNight?.room_type_id ?? 0);
  const lockedRoomNumber = asString((lastAssignedNight as any)?.rooms?.room_number) || null;

  if (!lockedRoomId) {
    throw new OtaExtendOrchestratorError("Cannot extend stay: current assigned room is missing.", 409);
  }
  if (!Number.isFinite(lockedRoomTypeId) || lockedRoomTypeId <= 0) {
    throw new OtaExtendOrchestratorError("Cannot extend stay: current room type is missing.", 409);
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
  if (error) throw new OtaExtendOrchestratorError(error.message ?? "Failed to load reservation room meta.", 500);
  return {
    room_id: asString(row?.room_id) || null,
    room_type_id: Number(row?.room_type_id ?? 0) || null,
    room_number: asString((row as any)?.rooms?.room_number) || null,
  };
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
  if (error) throw new OtaExtendOrchestratorError(error.message ?? "Failed to load blocking reservations.", 500);
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
  if (reservationsError) throw new OtaExtendOrchestratorError(reservationsError.message ?? "Failed to load blocker reservations.", 500);

  const sourceSwapContext = await loadReservationSwapContext(supabase as any, ctx.reservation.id).catch(() => null);

  const items: BlockingItem[] = [];
  for (const reservation of ensureArray<any>(reservations)) {
    const reservationId = String(reservation.id);
    const roomMeta = await loadReservationRoomMeta(supabase, reservationId);
    const swapContext = await loadReservationSwapContext(supabase as any, reservationId).catch(() => null);
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
      room_type_name: roomMeta.room_type_id ? await resolveRoomTypeNameById(supabase, roomMeta.room_type_id) : null,
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

  for (const blocker of blockers) {
    if (!blocker.room_type_id) continue;
    const moveStartDate = deriveMoveStartDate({ today, checkinDate: blocker.checkin_date });
    if (compareDateStrings(blocker.checkout_date, moveStartDate) <= 0) continue;

    const { data: rooms, error: roomsError } = await supabase
      .from("rooms")
      .select("id, room_number, room_type_id, is_sellable, is_dayuse")
      .eq("room_type_id", blocker.room_type_id)
      .eq("is_sellable", true)
      .neq("id", currentRoomId);
    if (roomsError) {
      throw new OtaExtendOrchestratorError(roomsError.message ?? "Failed to load blocker target rooms.", 500);
    }

    for (const room of ensureArray<any>(rooms)) {
      const candidateRoomId = String(room.id ?? "");
      const candidateRoomNumber = asString(room.room_number);
      if (!candidateRoomId || !candidateRoomNumber) continue;
      if (Boolean(room.is_dayuse)) continue;

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
  input: OtaExtendPreviewInput;
}) {
  const { supabase, ctx, input } = params;
  if (input.strategy !== "different_room") return [];

  const targetRoomTypeId = Number(input.targetRoomTypeId ?? 0) || ctx.lockedRoomTypeId;
  const { data: rooms, error: roomsError } = await supabase
    .from("rooms")
    .select("id, room_number, room_type_id, is_sellable, is_dayuse")
    .eq("room_type_id", targetRoomTypeId)
    .eq("is_sellable", true);
  if (roomsError) throw new OtaExtendOrchestratorError(roomsError.message ?? "Failed to load target rooms.", 500);

  const roomTypeName = await resolveRoomTypeNameById(supabase, targetRoomTypeId);
  const available: Array<{ id: string; room_number: string; room_type_id: number; room_type_name: string | null }> = [];

  for (const room of ensureArray<any>(rooms)) {
    if (Boolean(room.is_dayuse)) continue;
    const roomId = String(room.id ?? "");
    const roomNumber = asString(room.room_number);
    if (!roomId || !roomNumber) continue;
    try {
      if (input.moveMode === "move_now") {
        const combinedStart = compareDateStrings(ctx.reservation.checkout_date, ctx.today) > 0 ? ctx.today : ctx.extensionCheckinDate;
        await assertRoomAvailableForDateRange(supabase as any, {
          roomId,
          checkinDate: combinedStart,
          checkoutDate: ctx.extensionCheckoutDate,
          excludeReservationId: ctx.reservation.id,
        });
      } else {
        const planStartDate = input.planStartDate && isValidDateString(input.planStartDate) ? input.planStartDate : ctx.extensionCheckinDate;
        await assertRoomAvailableForDateRange(supabase as any, {
          roomId,
          checkinDate: planStartDate,
          checkoutDate: ctx.extensionCheckoutDate,
          excludeReservationId: ctx.reservation.id,
        });
      }
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

async function listAvailableTargetRoomsForOptionB(params: {
  supabase: SupabaseLike;
  ctx: OrchestratorContext;
  input: OtaExtendPreviewInput;
  shortenCheckoutDate: string;
}) {
  const { supabase, ctx, input, shortenCheckoutDate } = params;
  if (input.strategy !== "different_room") return [];

  const targetRoomTypeId = Number(input.targetRoomTypeId ?? 0) || ctx.lockedRoomTypeId;
  const { data: rooms, error: roomsError } = await supabase
    .from("rooms")
    .select("id, room_number, room_type_id, is_sellable, is_dayuse")
    .eq("room_type_id", targetRoomTypeId)
    .eq("is_sellable", true);
  if (roomsError) throw new OtaExtendOrchestratorError(roomsError.message ?? "Failed to load target rooms.", 500);

  const roomTypeName = await resolveRoomTypeNameById(supabase, targetRoomTypeId);
  const available: Array<{ id: string; room_number: string; room_type_id: number; room_type_name: string | null }> = [];

  for (const room of ensureArray<any>(rooms)) {
    if (Boolean(room.is_dayuse)) continue;
    const roomId = String(room.id ?? "");
    const roomNumber = asString(room.room_number);
    if (!roomId || !roomNumber) continue;
    try {
      await assertRoomAvailableForDateRange(supabase as any, {
        roomId,
        checkinDate: shortenCheckoutDate,
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

function buildImpactedSegmentsOptionB(params: {
  ctx: OrchestratorContext;
  input: OtaExtendPreviewInput;
  shortenCheckoutDate: string;
}) {
  const { ctx, input, shortenCheckoutDate } = params;
  const segments: Array<Record<string, unknown>> = [
    {
      reservation_id: ctx.reservation.id,
      booking_code: ctx.reservation.booking_code,
      segment_type: "ota_shorten",
      old_checkout_date: ctx.reservation.checkout_date,
      new_checkout_date: shortenCheckoutDate,
    },
    {
      reservation_id: "linked_extension_pending",
      booking_code: "linked_extension_pending",
      segment_type: "linked_extension_create",
      checkin_date: shortenCheckoutDate,
      checkout_date: ctx.extensionCheckoutDate,
      room_number: ctx.lockedRoomNumber,
    },
  ];

  if (input.strategy === "different_room" && input.moveMode === "move_now") {
    segments.push({
      reservation_id: "linked_extension_pending",
      booking_code: "linked_extension_pending",
      segment_type: "move_now_extension",
      start_date: shortenCheckoutDate,
      checkout_date: ctx.extensionCheckoutDate,
    });
  }

  return segments;
}

async function buildPricePreview(params: {
  supabase: SupabaseLike;
  ctx: OrchestratorContext;
  input: OtaExtendPreviewInput;
}) {
  const { supabase, ctx, input } = params;

  if (input.strategy !== "different_room" || input.moveMode !== "move_now" || !input.targetRoomId) {
    return {
      pricing_policy: ctx.pricingPolicy,
      estimated_delta: null,
      note: "OTA segment keeps original OTA rates (keep_rtc). Extension segment uses selected pricing policy.",
    };
  }

  const { data: nights, error: nightsError } = await supabase
    .from("reservation_nights")
    .select("nightly_price")
    .eq("reservation_id", ctx.reservation.id)
    .is("cancelled_at", null)
    .gte("stay_date", ctx.today)
    .order("stay_date", { ascending: true });
  if (nightsError) {
    throw new OtaExtendOrchestratorError(nightsError.message ?? "Failed to calculate price preview.", 500);
  }
  const oldTotal = ensureArray<any>(nights).reduce((sum, row) => sum + Number(row?.nightly_price ?? 0), 0);
  return {
    pricing_policy: ctx.pricingPolicy,
    estimated_delta: ctx.pricingPolicy === "keep_rtc" ? 0 : null,
    note: ctx.pricingPolicy === "keep_rtc"
      ? "OTA segment remains keep_rtc, and extension segment also uses keep_rtc. Estimated delta is 0."
      : "OTA segment remains keep_rtc. Estimated delta applies to extension segment based on target room grid/policy.",
  };
}

function buildImpactedSegments(ctx: OrchestratorContext, input: OtaExtendPreviewInput, blockers: BlockingItem[]) {
  const segments: Array<Record<string, unknown>> = [
    {
      reservation_id: ctx.reservation.id,
      booking_code: ctx.reservation.booking_code,
      segment_type: "linked_extension_create",
      checkin_date: ctx.extensionCheckinDate,
      checkout_date: ctx.extensionCheckoutDate,
      room_number: ctx.lockedRoomNumber,
    },
  ];

  if (input.strategy === "different_room" && input.moveMode === "move_now") {
    segments.push({
      reservation_id: ctx.reservation.id,
      booking_code: ctx.reservation.booking_code,
      segment_type: "move_now_original_remaining",
      start_date: ctx.today,
      checkout_date: ctx.reservation.checkout_date,
    });
    segments.push({
      reservation_id: "linked_extension_pending",
      booking_code: "linked_extension_pending",
      segment_type: "move_now_extension",
      start_date: ctx.extensionCheckinDate,
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

async function previewOptionBShortenFlow(params: {
  supabase: SupabaseLike;
  ctx: OrchestratorContext;
  input: OtaExtendPreviewInput;
}): Promise<OtaExtendPreviewResult> {
  const { supabase, ctx, input } = params;
  const warnings: string[] = ["Option B selected: You must update the OTA platform manually after commit."];
  const shortenCheckoutDate = resolveOptionBShortenCheckoutDate(ctx, input);
  validateOptionBShortenDate({ ctx, shortenCheckoutDate });

  let canCommit = true;
  if (input.strategy !== "different_room") {
    canCommit = false;
    warnings.push("Option B supports strategy=different_room only.");
  }
  if (input.moveMode !== "move_now") {
    canCommit = false;
    warnings.push("Option B supports move_mode=move_now only.");
  }

  await assertRoomAvailableForDateRange(supabase as any, {
    roomId: ctx.lockedRoomId,
    checkinDate: shortenCheckoutDate,
    checkoutDate: ctx.extensionCheckoutDate,
    excludeReservationId: ctx.reservation.id,
  }).catch((error) => {
    canCommit = false;
    warnings.push(error instanceof Error ? error.message : "Current room is not available for extension range.");
  });

  const availableTargetRooms = await listAvailableTargetRoomsForOptionB({
    supabase,
    ctx,
    input,
    shortenCheckoutDate,
  });

  if (!input.targetRoomId) {
    canCommit = false;
    warnings.push("target_room_id is required for Option B.");
  } else if (!availableTargetRooms.some((room) => room.id === input.targetRoomId)) {
    canCommit = false;
    warnings.push("Selected target room is not available for Option B impacted dates.");
  }

  const impactedSegments = buildImpactedSegmentsOptionB({ ctx, input, shortenCheckoutDate });
  return {
    can_commit: canCommit,
    impacted_segments: impactedSegments,
    blocking_items: [],
    swap_candidates: [],
    price_preview: {
      pricing_policy: ctx.pricingPolicy,
      estimated_delta: null,
      note: "Option B shortens OTA first, then creates a new Walk-in segment at selected checkout date.",
    },
    warnings,
    blocker_is_checked_in: false,
    current_room_number: ctx.lockedRoomNumber ?? "",
    current_room_type_name: ctx.lockedRoomTypeName,
    available_target_rooms: availableTargetRooms,
  };
}

export async function previewOtaExtendOrchestrator(params: {
  supabase: SupabaseLike;
  input: OtaExtendPreviewInput;
}): Promise<OtaExtendPreviewResult> {
  const { supabase, input } = params;
  const ctx = await loadOrchestratorContext(supabase, input);
  const otaModificationOption = resolveOtaModificationOption(input);

  if (otaModificationOption === "option_b_shorten_ota") {
    return previewOptionBShortenFlow({ supabase, ctx, input });
  }

  const warnings: string[] = [];
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

  if (input.strategy === "different_room") {
    await assertRoomAvailableForDateRange(supabase as any, {
      roomId: ctx.lockedRoomId,
      checkinDate: ctx.extensionCheckinDate,
      checkoutDate: ctx.extensionCheckoutDate,
    }).catch((error) => {
      warnings.push(error instanceof Error ? error.message : "Current room is not available for extension range.");
    });
  }

  let canCommit = true;
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
      }
    }
  }

  const impactedSegments = buildImpactedSegments(ctx, input, blockers);
  const pricePreview = await buildPricePreview({ supabase, ctx, input });

  return {
    can_commit: canCommit,
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
  if (reservationError) throw new OtaExtendOrchestratorError(reservationError.message ?? "Failed to load reservation for plan move.", 500);
  if (!reservation) throw new OtaExtendOrchestratorError("Reservation not found for plan move.", 404);
  if (String(reservation.status) !== "active") {
    throw new OtaExtendOrchestratorError("Only active reservations can be planned for room moves.", 400);
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
  if (insertError) throw new OtaExtendOrchestratorError(insertError.message ?? "Failed to create planned move segment.", 500);

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

async function writeOrchestratorAudit(params: {
  supabase: SupabaseLike;
  reservationId: string;
  payload: Record<string, unknown>;
  auditSource?: AuditSource;
}) {
  const { supabase, reservationId, payload, auditSource } = params;
  await supabase.from("audit_logs").insert({
    action: "ota_extend_orchestrator_commit",
    entity_type: "reservation",
    entity_id: reservationId,
    before_json: null,
    after_json: payload,
    business_date: toBangkokDateString(),
    source: normalizeAuditSource(auditSource ?? "manual"),
  });
}

async function commitOptionBShortenFlow(params: {
  supabase: SupabaseLike;
  ctx: OrchestratorContext;
  input: OtaExtendCommitInput;
  preview: OtaExtendPreviewResult;
}): Promise<OtaExtendCommitResult> {
  const { supabase, ctx, input, preview } = params;
  const executedActions: Array<Record<string, unknown>> = [];
  const failedActions: Array<Record<string, unknown>> = [];
  const warnings = [...preview.warnings];
  let pendingFixAction: string | null = null;
  let extensionReservationId: string | null = null;
  const auditSource = normalizeAuditSource(input.auditSource ?? "manual");

  const shortenCheckoutDate = resolveOptionBShortenCheckoutDate(ctx, input);
  validateOptionBShortenDate({ ctx, shortenCheckoutDate });

  if (input.strategy !== "different_room" || input.moveMode !== "move_now") {
    throw new OtaExtendOrchestratorError("Option B requires strategy=different_room and move_mode=move_now.", 409);
  }

  const targetRoomId = asString(input.targetRoomId);
  if (!targetRoomId) {
    throw new OtaExtendOrchestratorError("target_room_id is required for Option B.", 400);
  }

  const shortenResult = await shortenOtaReservationForEarlyMove({
    supabase: supabase as any,
    reservationId: ctx.reservation.id,
    newCheckoutDate: shortenCheckoutDate,
    reason: "OTA early room-change Option B",
    auditSource,
  });
  executedActions.push({
    action: "shorten_ota",
    reservation_id: ctx.reservation.id,
    old_checkout_date: shortenResult.old_checkout_date,
    new_checkout_date: shortenResult.new_checkout_date,
    cancelled_stay_dates: shortenResult.cancelled_stay_dates,
    original_checkout_date_saved: shortenResult.original_checkout_date_saved,
  });

  try {
    const extensionCreate = await createLinkedExtensionReservation({
      supabase: supabase as any,
      originalReservationId: ctx.reservation.id,
      payload: {
        checkin_date: shortenCheckoutDate,
        checkout_date: ctx.extensionCheckoutDate,
        source: "walkin",
        room_type_id: ctx.lockedRoomTypeId,
        room_id: ctx.lockedRoomId,
        copy_accompanying: input.copyAccompanying ?? true,
        copy_preferences: input.copyPreferences ?? true,
        note: asString(input.note) || "Option B: shortened OTA segment; update OTA platform manually.",
        rate_plan_id: null,
      },
      auditSource,
    });
    extensionReservationId = extensionCreate.reservation_id;
    executedActions.push({
      action: "create_linked_extension",
      extension_reservation_id: extensionReservationId,
      room_number: extensionCreate.locked_room_number,
      checkin_date: shortenCheckoutDate,
      checkout_date: ctx.extensionCheckoutDate,
    });

    try {
      const transferResult = await transferLinkedDepositFromOtaToExtension({
        supabase,
        otaReservationId: ctx.reservation.id,
        extensionReservationId,
      });
      if (transferResult?.transferred) {
        executedActions.push({
          action: "transfer_deposit_ota_to_walkin",
          amount: transferResult.amount,
          from_booking_code: transferResult.sourceBookingCode,
          to_booking_code: transferResult.targetBookingCode,
        });
      }
    } catch (transferError) {
      failedActions.push({
        action: "transfer_deposit_ota_to_walkin",
        error: transferError instanceof Error ? transferError.message : String(transferError),
      });
      if (!pendingFixAction) {
        pendingFixAction = "Refund remaining OTA deposit and top-up Walk-in deposit manually.";
      }
      warnings.push("Linked stay created but deposit transfer failed. Please refund OTA deposit and top-up Walk-in deposit manually.");
    }
  } catch (error) {
    failedActions.push({
      action: "create_linked_extension",
      error: error instanceof Error ? error.message : String(error),
    });
    pendingFixAction = `OTA reservation already shortened. Create linked walk-in extension from ${shortenCheckoutDate} to ${ctx.extensionCheckoutDate} manually.`;
    await writeOrchestratorAudit({
      supabase,
      reservationId: ctx.reservation.id,
      auditSource,
      payload: {
        strategy: input.strategy,
        move_mode: input.moveMode,
        ota_modification_option: "option_b_shorten_ota",
        ota_shorten_checkout_date: shortenCheckoutDate,
        executed_actions: executedActions,
        failed_actions: failedActions,
        extension_reservation_id: extensionReservationId,
        pending_fix_action: pendingFixAction,
      },
    });
    return {
      success: false,
      extension_reservation_id: extensionReservationId,
      executed_actions: executedActions,
      failed_actions: failedActions,
      pending_fix_action: pendingFixAction,
      final_price_summary: {
        ota_old_total: shortenResult.old_total_price,
        ota_new_total: shortenResult.new_total_price,
      },
      warnings,
      ota_platform_update_required: true,
    };
  }

  try {
    await assertAssignedRoomUnlockedOrOverride({
      supabase: supabase as any,
      reservationId: extensionReservationId,
      action: "move_room",
      overrideNote: "",
    });

    const extensionMove = await executeRoomMove({
      supabase: supabase as any,
      reservationId: extensionReservationId,
      newRoomId: targetRoomId,
      reason: "OTA early room-change Option B (new walk-in move-now)",
      pricingPolicy: ctx.pricingPolicy,
      discountType: ctx.discountType,
      discountValue: ctx.discountValue,
      discountReason: ctx.discountReason ?? undefined,
      startDate: shortenCheckoutDate,
      endDate: null,
      notePrefix: "OTA Option B",
      auditAction: "ota_option_b_extension_moved",
      appendNoteLine: true,
      auditSource,
    });
    executedActions.push({
      action: "move_extension",
      reservation_id: extensionReservationId,
      to_room: extensionMove.to_room,
      moved_stay_dates: extensionMove.moved_stay_dates,
      delta: extensionMove.future_total_delta,
    });
  } catch (error) {
    failedActions.push({
      action: "move_extension",
      error: error instanceof Error ? error.message : String(error),
    });
    const target = preview.available_target_rooms.find((row) => row.id === targetRoomId);
    pendingFixAction = `Move extension reservation ${extensionReservationId} to room ${target?.room_number ?? "selected room"}`;
    await writeOrchestratorAudit({
      supabase,
      reservationId: ctx.reservation.id,
      auditSource,
      payload: {
        strategy: input.strategy,
        move_mode: input.moveMode,
        ota_modification_option: "option_b_shorten_ota",
        ota_shorten_checkout_date: shortenCheckoutDate,
        executed_actions: executedActions,
        failed_actions: failedActions,
        extension_reservation_id: extensionReservationId,
        pending_fix_action: pendingFixAction,
      },
    });
    return {
      success: false,
      extension_reservation_id: extensionReservationId,
      executed_actions: executedActions,
      failed_actions: failedActions,
      pending_fix_action: pendingFixAction,
      final_price_summary: {
        ota_old_total: shortenResult.old_total_price,
        ota_new_total: shortenResult.new_total_price,
      },
      warnings,
      ota_platform_update_required: true,
    };
  }

  await writeOrchestratorAudit({
    supabase,
    reservationId: ctx.reservation.id,
    auditSource,
    payload: {
      strategy: input.strategy,
      move_mode: input.moveMode,
      ota_modification_option: "option_b_shorten_ota",
      ota_shorten_checkout_date: shortenCheckoutDate,
      target_room_id: input.targetRoomId ?? null,
      executed_actions: executedActions,
      failed_actions: failedActions,
      extension_reservation_id: extensionReservationId,
      pending_fix_action: pendingFixAction,
    },
  });

  return {
    success: failedActions.length === 0,
    extension_reservation_id: extensionReservationId,
    executed_actions: executedActions,
    failed_actions: failedActions,
    pending_fix_action: pendingFixAction,
    final_price_summary: {
      pricing_policy: ctx.pricingPolicy,
      ota_old_total: shortenResult.old_total_price,
      ota_new_total: shortenResult.new_total_price,
      ota_old_checkout_date: shortenResult.old_checkout_date,
      ota_new_checkout_date: shortenResult.new_checkout_date,
    },
    warnings,
    ota_platform_update_required: true,
  };
}

export async function commitOtaExtendOrchestrator(params: {
  supabase: SupabaseLike;
  input: OtaExtendCommitInput;
}): Promise<OtaExtendCommitResult> {
  const { supabase, input } = params;
  const ctx = await loadOrchestratorContext(supabase, input);
  const otaModificationOption = resolveOtaModificationOption(input);
  const preview = await previewOtaExtendOrchestrator({ supabase, input });
  const auditSource = normalizeAuditSource(input.auditSource ?? "manual");

  if (!preview.can_commit) {
    throw new OtaExtendOrchestratorError(preview.warnings[0] ?? "Precheck failed.", 409);
  }

  if (otaModificationOption === "option_b_shorten_ota") {
    return commitOptionBShortenFlow({
      supabase,
      ctx,
      input,
      preview,
    });
  }

  const executedActions: Array<Record<string, unknown>> = [];
  const failedActions: Array<Record<string, unknown>> = [];
  const warnings = [...preview.warnings];
  let pendingFixAction: string | null = null;
  let extensionReservationId: string | null = null;

  if (input.strategy === "same_room" && preview.blocking_items.length > 0) {
    const selectedBlockerReservationId = asString(input.selectedBlockerReservationId);
    const selectedBlockerTargetRoomId = asString(input.selectedBlockerTargetRoomId);
    if (!selectedBlockerReservationId || !selectedBlockerTargetRoomId) {
      throw new OtaExtendOrchestratorError("selected_blocker_reservation_id and selected_blocker_target_room_id are required for blocker assist.", 409);
    }

    const blocker = preview.blocking_items.find((row) => row.reservation_id === selectedBlockerReservationId);
    if (!blocker) throw new OtaExtendOrchestratorError("Selected blocker reservation is not valid.", 409);

    const candidate = preview.swap_candidates.find((row) =>
      row.blocker_reservation_id === selectedBlockerReservationId && row.candidate_room_id === selectedBlockerTargetRoomId
    );
    if (!candidate) throw new OtaExtendOrchestratorError("Selected blocker target room is not valid.", 409);

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
      reason: "OTA extension blocker assist",
      pricingPolicy: "keep_rtc",
      discountType: "percent",
      discountValue: 0,
      startDate: candidate.move_start_date,
      endDate: addDays(candidate.move_checkout_date, -1),
      notePrefix: "OTA Extend Assist",
      auditAction: "ota_extend_blocker_moved",
    });

    executedActions.push({
      action: "move_blocker",
      reservation_id: selectedBlockerReservationId,
      to_room: blockerMove.to_room,
      moved_stay_dates: blockerMove.moved_stay_dates,
    });
  }

  const extensionCreate = await createLinkedExtensionReservation({
    supabase: supabase as any,
    originalReservationId: ctx.reservation.id,
    payload: {
      checkin_date: ctx.extensionCheckinDate,
      checkout_date: ctx.extensionCheckoutDate,
      source: "walkin",
      room_type_id: ctx.lockedRoomTypeId,
      room_id: ctx.lockedRoomId,
      copy_accompanying: input.copyAccompanying ?? true,
      copy_preferences: input.copyPreferences ?? true,
      note: asString(input.note) || null,
      rate_plan_id: null,
    },
    auditSource,
  });
  extensionReservationId = extensionCreate.reservation_id;
  executedActions.push({
    action: "create_linked_extension",
    extension_reservation_id: extensionReservationId,
    room_number: extensionCreate.locked_room_number,
  });

  try {
    const transferResult = await transferLinkedDepositFromOtaToExtension({
      supabase,
      otaReservationId: ctx.reservation.id,
      extensionReservationId,
    });
    if (transferResult?.transferred) {
      executedActions.push({
        action: "transfer_deposit_ota_to_walkin",
        amount: transferResult.amount,
        from_booking_code: transferResult.sourceBookingCode,
        to_booking_code: transferResult.targetBookingCode,
      });
    }
  } catch (transferError) {
    failedActions.push({
      action: "transfer_deposit_ota_to_walkin",
      error: transferError instanceof Error ? transferError.message : String(transferError),
    });
    if (!pendingFixAction) {
      pendingFixAction = "Refund remaining OTA deposit and top-up Walk-in deposit manually.";
    }
    warnings.push("Linked stay created but deposit transfer failed. Please refund OTA deposit and top-up Walk-in deposit manually.");
  }

  if (input.strategy === "different_room" && input.moveMode === "move_now") {
    const targetRoomId = asString(input.targetRoomId);
    if (!targetRoomId) throw new OtaExtendOrchestratorError("target_room_id is required.", 400);

    try {
      await assertAssignedRoomUnlockedOrOverride({
        supabase: supabase as any,
        reservationId: ctx.reservation.id,
        action: "move_room",
        overrideNote: "",
      });

      const originalMove = await executeRoomMove({
        supabase: supabase as any,
        reservationId: ctx.reservation.id,
        newRoomId: targetRoomId,
        reason: "OTA extend orchestrator move-now (original remaining)",
        // OTA segment must keep OTA contracted nightly rates.
        pricingPolicy: "keep_rtc",
        discountType: "percent",
        discountValue: 0,
        discountReason: undefined,
        startDate: ctx.today,
        endDate: null,
        notePrefix: "OTA Extend Orchestrator",
        auditAction: "ota_extend_original_moved",
        appendNoteLine: true,
        auditSource,
      });
      executedActions.push({
        action: "move_original",
        reservation_id: ctx.reservation.id,
        to_room: originalMove.to_room,
        moved_stay_dates: originalMove.moved_stay_dates,
        delta: originalMove.future_total_delta,
      });
    } catch (error) {
      failedActions.push({
        action: "move_original",
        error: error instanceof Error ? error.message : String(error),
      });
      pendingFixAction = "Move original reservation to selected target room manually.";
      await writeOrchestratorAudit({
        supabase,
        reservationId: ctx.reservation.id,
        auditSource,
        payload: {
          strategy: input.strategy,
          move_mode: input.moveMode,
          ota_modification_option: otaModificationOption,
          ota_shorten_checkout_date: input.otaShortenCheckoutDate ?? null,
          executed_actions: executedActions,
          failed_actions: failedActions,
          extension_reservation_id: extensionReservationId,
          pending_fix_action: pendingFixAction,
        },
      });
      return {
        success: false,
        extension_reservation_id: extensionReservationId,
        executed_actions: executedActions,
        failed_actions: failedActions,
        pending_fix_action: pendingFixAction,
        final_price_summary: {},
        warnings,
      };
    }

    try {
      const extensionMove = await executeRoomMove({
        supabase: supabase as any,
        reservationId: extensionReservationId,
        newRoomId: targetRoomId,
        reason: "OTA extend orchestrator move-now (linked extension)",
        pricingPolicy: ctx.pricingPolicy,
        discountType: ctx.discountType,
        discountValue: ctx.discountValue,
        discountReason: ctx.discountReason ?? undefined,
        startDate: ctx.extensionCheckinDate,
        endDate: null,
        notePrefix: "OTA Extend Orchestrator",
        auditAction: "ota_extend_extension_moved",
        appendNoteLine: true,
        auditSource,
      });
      executedActions.push({
        action: "move_extension",
        reservation_id: extensionReservationId,
        to_room: extensionMove.to_room,
        moved_stay_dates: extensionMove.moved_stay_dates,
        delta: extensionMove.future_total_delta,
      });
    } catch (error) {
      failedActions.push({
        action: "move_extension",
        error: error instanceof Error ? error.message : String(error),
      });
      const target = preview.available_target_rooms.find((row) => row.id === targetRoomId);
      pendingFixAction = `Move extension reservation ${extensionReservationId} to room ${target?.room_number ?? "selected room"}`;
      await writeOrchestratorAudit({
        supabase,
        reservationId: ctx.reservation.id,
        auditSource,
        payload: {
          strategy: input.strategy,
          move_mode: input.moveMode,
          ota_modification_option: otaModificationOption,
          ota_shorten_checkout_date: input.otaShortenCheckoutDate ?? null,
          executed_actions: executedActions,
          failed_actions: failedActions,
          extension_reservation_id: extensionReservationId,
          pending_fix_action: pendingFixAction,
        },
      });
      return {
        success: false,
        extension_reservation_id: extensionReservationId,
        executed_actions: executedActions,
        failed_actions: failedActions,
        pending_fix_action: pendingFixAction,
        final_price_summary: {},
        warnings,
      };
    }
  }

  if (input.strategy === "different_room" && input.moveMode === "plan_move") {
    const targetRoomId = asString(input.targetRoomId);
    const targetRoomTypeId = Number(input.targetRoomTypeId ?? 0);
    const planStartDate = asString(input.planStartDate);
    if (!targetRoomId || !targetRoomTypeId || !planStartDate) {
      throw new OtaExtendOrchestratorError("target_room_id, target_room_type_id and plan_start_date are required for plan_move.", 400);
    }

    const targetPlanSegments: PlannedMoveSegment[] = [];
    const originalStart = compareDateStrings(planStartDate, ctx.today) < 0 ? ctx.today : planStartDate;
    if (compareDateStrings(ctx.reservation.checkout_date, originalStart) > 0) {
      targetPlanSegments.push({
        reservation_id: ctx.reservation.id,
        start_date: originalStart,
        end_date: ctx.reservation.checkout_date,
        to_room_id: targetRoomId,
        to_room_type_id: targetRoomTypeId,
        pricing_policy: "keep_rtc",
        discount_type: "percent",
        discount_value: 0,
        discount_reason: null,
      });
    }
    const extensionStart = compareDateStrings(planStartDate, ctx.extensionCheckinDate) < 0 ? ctx.extensionCheckinDate : planStartDate;
    if (compareDateStrings(ctx.extensionCheckoutDate, extensionStart) > 0) {
      targetPlanSegments.push({
        reservation_id: extensionReservationId,
        start_date: extensionStart,
        end_date: ctx.extensionCheckoutDate,
        to_room_id: targetRoomId,
        to_room_type_id: targetRoomTypeId,
        pricing_policy: ctx.pricingPolicy,
        discount_type: ctx.discountType,
        discount_value: ctx.discountValue,
        discount_reason: ctx.discountReason,
      });
    }

    for (const segment of targetPlanSegments) {
      await assertAssignedRoomUnlockedOrOverride({
        supabase: supabase as any,
        reservationId: segment.reservation_id,
        action: "planned_move",
        overrideNote: "",
      });
      await assertRoomAvailableForDateRange(supabase as any, {
        roomId: segment.to_room_id,
        checkinDate: segment.start_date,
        checkoutDate: segment.end_date,
        excludeReservationId: segment.reservation_id,
      });
    }

    for (const segment of targetPlanSegments) {
      const inserted = await insertPlannedMove({
        supabase,
        reservationId: segment.reservation_id,
        startDate: segment.start_date,
        endDate: segment.end_date,
        targetRoomId: segment.to_room_id,
        targetRoomTypeId: segment.to_room_type_id,
        moveReason: "OTA extend orchestrator plan_move",
        pricingPolicy: segment.pricing_policy,
        discountType: segment.discount_type,
        discountValue: segment.discount_value,
        discountReason: segment.discount_reason,
        today: ctx.today,
      });
      executedActions.push({
        action: "create_plan_segment",
        plan_id: inserted?.id ?? null,
        reservation_id: segment.reservation_id,
        start_date: segment.start_date,
        end_date: segment.end_date,
        pricing_policy: segment.pricing_policy,
      });
    }
  }

  await writeOrchestratorAudit({
    supabase,
    reservationId: ctx.reservation.id,
    auditSource,
    payload: {
      strategy: input.strategy,
      move_mode: input.moveMode ?? null,
      ota_modification_option: otaModificationOption,
      ota_shorten_checkout_date: input.otaShortenCheckoutDate ?? null,
      target_room_id: input.targetRoomId ?? null,
      executed_actions: executedActions,
      failed_actions: failedActions,
      extension_reservation_id: extensionReservationId,
      pending_fix_action: pendingFixAction,
    },
  });

  return {
    success: failedActions.length === 0,
    extension_reservation_id: extensionReservationId,
    executed_actions: executedActions,
    failed_actions: failedActions,
    pending_fix_action: pendingFixAction,
    final_price_summary: {
      pricing_policy: ctx.pricingPolicy,
      discount_type: ctx.pricingPolicy === "reprice_grid_discount" ? ctx.discountType : null,
      discount_value: ctx.pricingPolicy === "reprice_grid_discount" ? ctx.discountValue : null,
    },
    warnings,
  };
}

export function isKnownOtaOrchestratorError(
  error: unknown
): error is OtaExtendOrchestratorError | LinkedExtensionError | RoomMoveError | PlannedRoomMoveError | AssignedRoomLockError | RoomSwapError | OtaModificationError {
  return (
    error instanceof OtaExtendOrchestratorError ||
    error instanceof LinkedExtensionError ||
    error instanceof RoomMoveError ||
    error instanceof PlannedRoomMoveError ||
    error instanceof AssignedRoomLockError ||
    error instanceof RoomSwapError ||
    error instanceof OtaModificationError
  );
}
