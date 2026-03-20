import { addDays, compareDateStrings, isValidDateString } from "@/lib/dates";
import { normalizeAuditSource, toBangkokDateString } from "@/lib/audit-utils";
import {
  appendReservationNoteLine,
  assertRoomAvailableForDateRange,
  PricingPolicy,
  DiscountType,
} from "@/lib/planned-room-moves";
import { syncDynamicRoomLinksForReservation } from "@/lib/logbook-api";
import { markRoomDirtyTask } from "@/lib/hk-dirty";

type SupabaseLike = {
  from: (table: string) => any;
};

export class RoomMoveError extends Error {
  status: number;

  constructor(message: string, status = 400) {
    super(message);
    this.name = "RoomMoveError";
    this.status = status;
  }
}

function toBangkokDate(date = new Date()) {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Bangkok" }).format(date);
}

function toNumber(value: unknown): number {
  const num = typeof value === "number" ? value : Number(value);
  return Number.isFinite(num) ? num : 0;
}

function round2(value: number) {
  return Number(value.toFixed(2));
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

  if (stayDates.length === 0 || !Number.isFinite(roomTypeId) || roomTypeId <= 0) {
    return map;
  }

  const { data: rooms, error: roomsError } = await supabase
    .from("rooms")
    .select("id")
    .eq("room_type_id", roomTypeId)
    .eq("is_sellable", true);
  if (roomsError || !rooms || rooms.length === 0) {
    return map;
  }

  const roomIds = rooms.map((row: any) => row.id).filter(Boolean);
  if (roomIds.length === 0) {
    return map;
  }

  const { data: rates, error: ratesError } = await supabase
    .from("rate_templates")
    .select("stay_date, price")
    .in("room_id", roomIds)
    .in("stay_date", stayDates);
  if (ratesError || !rates) {
    return map;
  }

  const byDate = new Map<string, number[]>();
  for (const row of rates) {
    const date = String(row.stay_date ?? "");
    if (!date) continue;
    const price = toNumber((row as any).price);
    const list = byDate.get(date) ?? [];
    list.push(price);
    byDate.set(date, list);
  }

  for (const stayDate of stayDates) {
    const values = byDate.get(stayDate) ?? [];
    if (values.length === 0) continue;
    const avg = values.reduce((sum, value) => sum + value, 0) / values.length;
    map.set(stayDate, round2(avg));
  }

  return map;
}

async function resolveRoomNumberById(supabase: SupabaseLike, roomId: string | null | undefined) {
  if (!roomId) return null;
  const { data, error } = await supabase
    .from("rooms")
    .select("room_number")
    .eq("id", roomId)
    .maybeSingle();
  if (error) throw new RoomMoveError(error.message ?? "Failed to resolve room.", 500);
  return data?.room_number ? String(data.room_number) : null;
}

async function assertNoActiveDueOutOccupantForImmediateMove(params: {
  supabase: SupabaseLike;
  roomId: string;
  stayDate: string;
  excludeReservationId?: string | null;
  roomNumberForMessage?: string | null;
}) {
  const { supabase, roomId, stayDate, excludeReservationId = null, roomNumberForMessage = null } = params;

  const { data: potentialRows, error: potentialError } = await supabase
    .from("reservation_nights")
    .select("reservation_id, stay_date")
    .eq("room_id", roomId)
    .is("cancelled_at", null)
    .lte("stay_date", stayDate)
    .order("stay_date", { ascending: false });
  if (potentialError) throw new RoomMoveError(potentialError.message ?? "Failed to check active due-out occupancy.", 500);

  const reservationIds = Array.from(
    new Set(
      (potentialRows ?? [])
        .map((row: any) => String(row?.reservation_id ?? ""))
        .filter((id: string) => id && id !== excludeReservationId)
    )
  );
  if (reservationIds.length === 0) return;

  const { data: reservations, error: reservationsError } = await supabase
    .from("reservations")
    .select("id, booking_code, guest_name, status, checkout_date")
    .in("id", reservationIds)
    .eq("status", "active")
    .eq("checkout_date", stayDate);
  if (reservationsError) throw new RoomMoveError(reservationsError.message ?? "Failed to check due-out reservations.", 500);
  if (!reservations || reservations.length === 0) return;

  const activeDueOutIds = reservations.map((row: any) => String(row.id ?? "")).filter(Boolean);
  const { data: movementLogs, error: movementLogsError } = await supabase
    .from("audit_logs")
    .select("entity_id, action")
    .eq("entity_type", "reservation")
    .in("entity_id", activeDueOutIds)
    .in("action", ["checked_in", "checked_out"]);
  if (movementLogsError) throw new RoomMoveError(movementLogsError.message ?? "Failed to evaluate room occupancy logs.", 500);

  const checkedInSet = new Set<string>();
  const checkedOutSet = new Set<string>();
  for (const log of movementLogs ?? []) {
    const reservationId = String((log as any).entity_id ?? "");
    const action = String((log as any).action ?? "");
    if (!reservationId) continue;
    if (action === "checked_in") checkedInSet.add(reservationId);
    if (action === "checked_out") checkedOutSet.add(reservationId);
  }

  const stillInside = reservations.find((row: any) => {
    const reservationId = String(row.id ?? "");
    return checkedInSet.has(reservationId) && !checkedOutSet.has(reservationId);
  });

  if (stillInside) {
    const bookingCode = String(stillInside.booking_code ?? "").trim();
    const guestName = String(stillInside.guest_name ?? "").trim();
    const roomLabel = roomNumberForMessage ? `Room ${roomNumberForMessage}` : "Target room";
    throw new RoomMoveError(
      `${roomLabel} is still occupied by due-out reservation ${bookingCode || String(stillInside.id)}${guestName ? ` (${guestName})` : ""}. Check-out must be completed before move.`,
      409
    );
  }
}

export type ExecuteRoomMoveParams = {
  supabase: SupabaseLike;
  reservationId: string;
  newRoomId: string;
  reason: string;
  pricingPolicy: PricingPolicy;
  discountType: DiscountType;
  discountValue: number;
  discountReason?: string | null;
  startDate: string;
  endDate?: string | null;
  notePrefix?: string;
  noteSuffix?: string | null;
  auditAction?: string;
  auditSource?: "manual" | "system" | "api" | "night_audit";
  appendNoteLine?: boolean;
  markOldRoomDirty?: boolean;
  sourceRoomIdOverride?: string | null;
  sourceRoomNumberOverride?: string | null;
};

export type ExecuteRoomMoveResult = {
  success: true;
  from_room: string;
  to_room: string;
  nights_moved: number;
  pricing_policy: PricingPolicy;
  future_total_before: number;
  future_total_after: number;
  future_total_delta: number;
  reservation_total_price: number;
  moved_stay_dates: string[];
};

export async function executeRoomMove(params: ExecuteRoomMoveParams): Promise<ExecuteRoomMoveResult> {
  const {
    supabase,
    reservationId,
    newRoomId,
    reason,
    pricingPolicy,
    discountType,
    discountValue,
    discountReason,
    startDate,
    endDate,
    notePrefix = "Room Move",
    noteSuffix = null,
    auditAction = "room_moved",
    auditSource = "manual",
    appendNoteLine = true,
    markOldRoomDirty = true,
    sourceRoomIdOverride = null,
    sourceRoomNumberOverride = null,
  } = params;

  if (!newRoomId) throw new RoomMoveError("new_room_id is required.", 400);
  if (!reason.trim()) throw new RoomMoveError("reason is required.", 400);
  if (!isValidDateString(startDate)) throw new RoomMoveError("Invalid move start date.", 400);
  if (endDate && !isValidDateString(endDate)) throw new RoomMoveError("Invalid move end date.", 400);
  if (endDate && compareDateStrings(endDate, startDate) < 0) {
    throw new RoomMoveError("Move end date must be on or after start date.", 400);
  }
  if (pricingPolicy === "reprice_grid_discount") {
    if (!(discountValue > 0)) throw new RoomMoveError("discount_value must be greater than 0.", 400);
    if (discountType === "percent" && discountValue > 100) {
      throw new RoomMoveError("discount_value percent cannot exceed 100.", 400);
    }
    if (!String(discountReason ?? "").trim()) {
      throw new RoomMoveError("discount_reason is required for discounted move.", 400);
    }
  }

  const today = toBangkokDate();

  const { data: reservation, error: reservationError } = await supabase
    .from("reservations")
    .select("id, status, note, checkout_date")
    .eq("id", reservationId)
    .maybeSingle();
  if (reservationError) throw new RoomMoveError(reservationError.message ?? "Failed to load reservation.", 500);
  if (!reservation) throw new RoomMoveError("Reservation not found.", 404);
  if (reservation.status !== "active") throw new RoomMoveError("Reservation is not active.", 400);

  const { data: newRoom, error: newRoomError } = await supabase
    .from("rooms")
    .select("id, room_number, room_type_id, is_sellable")
    .eq("id", newRoomId)
    .maybeSingle();
  if (newRoomError) throw new RoomMoveError(newRoomError.message ?? "Failed to load target room.", 500);
  if (!newRoom) throw new RoomMoveError("New room not found.", 404);
  if (!newRoom.is_sellable) {
    throw new RoomMoveError(`Room ${String(newRoom.room_number)} is not sellable.`, 400);
  }

  let futureNightQuery = supabase
    .from("reservation_nights")
    .select("id, room_id, room_type_id, stay_date, nightly_price, is_ota")
    .eq("reservation_id", reservationId)
    .is("cancelled_at", null)
    .gte("stay_date", startDate)
    .order("stay_date", { ascending: true });

  if (endDate) {
    futureNightQuery = futureNightQuery.lte("stay_date", endDate);
  }

  const { data: nightsToMove, error: nightsError } = await futureNightQuery;
  if (nightsError) throw new RoomMoveError(nightsError.message ?? "Failed to load nights for room move.", 500);
  if (!nightsToMove || nightsToMove.length === 0) {
    throw new RoomMoveError("No reservation nights found in the selected move range.", 400);
  }

  const originalOldRoomId = String(nightsToMove[0].room_id ?? "");
  const oldRoomId = sourceRoomIdOverride ? String(sourceRoomIdOverride) : originalOldRoomId;
  const oldRoomNumber = sourceRoomNumberOverride
    ? String(sourceRoomNumberOverride)
    : await resolveRoomNumberById(supabase, oldRoomId);
  const stayDates = nightsToMove.map((n: any) => String(n.stay_date));
  const effectiveCheckout = addDays(String(stayDates[stayDates.length - 1]), 1);

  await assertRoomAvailableForDateRange(supabase, {
    roomId: newRoomId,
    checkinDate: stayDates[0],
    checkoutDate: effectiveCheckout,
    excludeReservationId: reservationId,
  });

  // Block immediate move if target room still has a due-out guest not checked out yet.
  if (stayDates.includes(today)) {
    await assertNoActiveDueOutOccupantForImmediateMove({
      supabase,
      roomId: newRoomId,
      stayDate: today,
      excludeReservationId: reservationId,
      roomNumberForMessage: String(newRoom.room_number ?? ""),
    });
  }

  const newRoomTypeId = toNumber(newRoom.room_type_id);
  const rackByDate =
    pricingPolicy === "keep_rtc"
      ? new Map<string, number>()
      : await fetchRackRateByDate({
        supabase,
        roomTypeId: newRoomTypeId,
        stayDates,
      });

  const repricedNights = nightsToMove.map((night: any) => {
    const stayDate = String(night.stay_date);
    const oldNightlyPrice = round2(toNumber(night.nightly_price));
    const rackNightlyPrice = round2(rackByDate.get(stayDate) ?? oldNightlyPrice);

    let nextNightlyPrice = oldNightlyPrice;
    if (pricingPolicy === "reprice_grid") {
      nextNightlyPrice = rackNightlyPrice;
    } else if (pricingPolicy === "reprice_grid_discount") {
      nextNightlyPrice = applyDiscount(rackNightlyPrice, discountType, discountValue);
    }

    return {
      stay_date: stayDate,
      is_ota: Boolean((night as any).is_ota),
      old_nightly_price: oldNightlyPrice,
      rack_nightly_price: rackNightlyPrice,
      new_nightly_price: round2(nextNightlyPrice),
    };
  });

  const oldFutureTotal = round2(repricedNights.reduce((sum: number, item: any) => sum + item.old_nightly_price, 0));
  const newFutureTotal = round2(repricedNights.reduce((sum: number, item: any) => sum + item.new_nightly_price, 0));
  const futureDelta = round2(newFutureTotal - oldFutureTotal);

  const cancelledAt = new Date().toISOString();
  const { error: cancelError } = await supabase
    .from("reservation_nights")
    .update({ cancelled_at: cancelledAt })
    .eq("reservation_id", reservationId)
    .is("cancelled_at", null)
    .in("stay_date", stayDates);
  if (cancelError) throw new RoomMoveError(cancelError.message ?? "Failed to cancel source nights.", 500);

  const newNights = repricedNights.map((night: any) => ({
    reservation_id: reservationId,
    room_id: newRoomId,
    room_type_id: newRoomTypeId > 0 ? newRoomTypeId : toNumber(nightsToMove[0].room_type_id) || null,
    stay_date: night.stay_date,
    nightly_price: night.new_nightly_price,
    is_ota: night.is_ota,
  }));

  const { error: insertError } = await supabase
    .from("reservation_nights")
    .insert(newNights);
  if (insertError) throw new RoomMoveError(insertError.message ?? "Failed to insert moved nights.", 500);

  if (markOldRoomDirty && oldRoomId && stayDates.includes(today)) {
    // Resolve assigned maid from existing task or daily_plans
    let resolvedAssignedMaid: string | null = null;
    const { data: existingHkTask } = await supabase
      .from("housekeeping_tasks")
      .select("assigned_maid_name")
      .eq("room_id", oldRoomId)
      .eq("stay_date", today)
      .order("task_seq", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (existingHkTask?.assigned_maid_name) {
      resolvedAssignedMaid = String(existingHkTask.assigned_maid_name);
    }

    const { data: plannedMaid } = await supabase
      .from("daily_plans")
      .select("assigned_maid")
      .eq("plan_date", today)
      .eq("room_id", oldRoomId)
      .maybeSingle();
    if (plannedMaid?.assigned_maid) {
      resolvedAssignedMaid = String(plannedMaid.assigned_maid);
    }

    // Smart dirty: preserves completed tasks — inserts new task_seq row if previous is done.
    // assignedMaidName intentionally null: unplanned re-clean should go to Pool, not inherit previous maid.
    void resolvedAssignedMaid;
    const dirtyResult = await markRoomDirtyTask(supabase, {
      roomId: oldRoomId,
      stayDate: today,
      assignedMaidName: null,
      clearDailyPlanWhenUnassigned: true,
      logNote: "Marked dirty again after room move",
    }).catch((err) => {
      throw new RoomMoveError(String(err?.message ?? err ?? "Failed to mark previous room as dirty."), 500);
    });

    void dirtyResult; // task_id + task_seq available if needed for future use
  }

  const { data: allActiveNights, error: allActiveNightsError } = await supabase
    .from("reservation_nights")
    .select("nightly_price")
    .eq("reservation_id", reservationId)
    .is("cancelled_at", null);
  if (allActiveNightsError) throw new RoomMoveError(allActiveNightsError.message ?? "Failed to recompute reservation total.", 500);

  const recomputedTotalPrice = round2(
    (allActiveNights ?? []).reduce((sum: number, item: any) => sum + toNumber(item?.nightly_price), 0)
  );

  const noteLine =
    `[${notePrefix} ${today}] ${oldRoomNumber ?? "unknown"} -> ${String(newRoom.room_number)} | ${reason.trim()} | ` +
    `${pricingPolicy === "keep_rtc"
      ? "POLICY: Keep RTC (Free Upgrade)"
      : pricingPolicy === "reprice_grid"
        ? "POLICY: Update RTC to Rate Grid"
        : `POLICY: Update RTC + Discount (${discountType}:${discountValue})`} | ` +
    `${futureDelta >= 0 ? "Δ+฿" : "Δ-฿"}${Math.abs(futureDelta).toLocaleString("th-TH", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}` +
    `${pricingPolicy === "reprice_grid_discount" ? ` | DISCOUNT REASON: ${String(discountReason ?? "").trim()}` : ""}` +
    `${noteSuffix ? ` | ${noteSuffix}` : ""}`;

  const { error: reservationUpdateError } = await supabase
    .from("reservations")
    .update({ total_price: recomputedTotalPrice })
    .eq("id", reservationId);
  if (reservationUpdateError) throw new RoomMoveError(reservationUpdateError.message ?? "Failed to update reservation totals.", 500);

  if (appendNoteLine) {
    await appendReservationNoteLine(supabase, reservationId, noteLine);
  }

  if (stayDates.includes(today)) {
    await syncDynamicRoomLinksForReservation(supabase as any, {
      reservationId,
      nextRoomCode: String(newRoom.room_number),
    });
  }

  await supabase.from("audit_logs").insert({
    action: auditAction,
    entity_type: "reservation",
    entity_id: reservationId,
    before_json: {
      room_id: oldRoomId || null,
      room_number: oldRoomNumber ?? "unknown",
      room_type_id: toNumber(nightsToMove[0].room_type_id) || null,
      moved_stay_dates: stayDates,
      future_total: oldFutureTotal,
    },
    after_json: {
      room_id: newRoomId,
      room_number: String(newRoom.room_number),
      room_type_id: newRoomTypeId || null,
      reason: reason.trim(),
      move_date: today,
      nights_moved: stayDates.length,
      moved_stay_dates: stayDates,
      pricing_policy: pricingPolicy,
      future_total: newFutureTotal,
      future_delta: futureDelta,
      discount_type: pricingPolicy === "reprice_grid_discount" ? discountType : null,
      discount_value: pricingPolicy === "reprice_grid_discount" ? discountValue : null,
      discount_reason: pricingPolicy === "reprice_grid_discount" ? String(discountReason ?? "").trim() || null : null,
    },
    business_date: toBangkokDateString(),
    source: normalizeAuditSource(auditSource),
  });

  return {
    success: true,
    from_room: oldRoomNumber ?? "unknown",
    to_room: String(newRoom.room_number),
    nights_moved: stayDates.length,
    pricing_policy: pricingPolicy,
    future_total_before: oldFutureTotal,
    future_total_after: newFutureTotal,
    future_total_delta: futureDelta,
    reservation_total_price: recomputedTotalPrice,
    moved_stay_dates: stayDates,
  };
}
