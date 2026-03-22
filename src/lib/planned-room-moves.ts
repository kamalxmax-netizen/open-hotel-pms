import { addDays, compareDateStrings, isValidDateString, listNights } from "@/lib/dates";
import { normalizeAuditSource, toBangkokDateString } from "@/lib/audit-utils";

export type PlannedMoveStatus = "planned" | "executed" | "cancelled";
export type PricingPolicy = "keep_rtc" | "reprice_grid" | "reprice_grid_discount";
export type DiscountType = "percent" | "fixed";

export type PlannedRoomMoveRow = {
  id: string;
  reservation_id: string;
  start_date: string;
  end_date: string;
  from_room_id_snapshot: string | null;
  to_room_type_id: number;
  to_room_id: string;
  move_reason: string;
  pricing_policy: PricingPolicy;
  discount_type: DiscountType | null;
  discount_value: number | null;
  discount_reason: string | null;
  do_not_move: boolean;
  do_not_move_note: string | null;
  status: PlannedMoveStatus;
  executed_at: string | null;
  cancelled_at: string | null;
  created_at: string;
  updated_at: string;
};

export type PlanDependentAssignment = {
  reservation_id: string;
  booking_code: string | null;
  guest_name: string | null;
  stay_dates: string[];
  room_id: string | null;
  room_number: string | null;
  source?: "dependency" | "overlap_fallback";
};

type SupabaseLike = {
  from: (table: string) => any;
};

export class PlannedRoomMoveError extends Error {
  status: number;

  constructor(message: string, status = 400) {
    super(message);
    this.name = "PlannedRoomMoveError";
    this.status = status;
  }
}

export function getBangkokDateString(date = new Date()) {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Bangkok" }).format(date);
}

export function normalizePricingPolicy(raw: unknown): PricingPolicy {
  if (raw === "reprice_grid" || raw === "reprice_grid_discount") return raw;
  return "keep_rtc";
}

export function normalizeDiscountType(raw: unknown): DiscountType {
  return raw === "fixed" ? "fixed" : "percent";
}

export function clampDiscountValue(value: unknown): number {
  const parsed = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(parsed)) return 0;
  return Math.max(0, Number(parsed.toFixed(2)));
}

export function overlapsNightlyRangeInclusive(params: {
  startDate: string;
  endDate: string;
  checkinDate: string;
  checkoutDate: string;
}) {
  const { startDate, endDate, checkinDate, checkoutDate } = params;
  return startDate < checkoutDate && endDate > checkinDate;
}

export function validatePlannedMoveDateRange(params: {
  startDate: string;
  endDate: string;
  today?: string;
  reservationCheckinDate: string;
  reservationCheckoutDate: string;
}) {
  const { startDate, endDate, today = getBangkokDateString(), reservationCheckinDate, reservationCheckoutDate } = params;

  if (!isValidDateString(startDate) || !isValidDateString(endDate)) {
    throw new PlannedRoomMoveError("Invalid planned move date range.", 400);
  }
  if (compareDateStrings(endDate, startDate) <= 0) {
    throw new PlannedRoomMoveError("Plan end date must be after start date.", 400);
  }
  const tomorrow = addDays(today, 1);
  if (compareDateStrings(startDate, tomorrow) < 0) {
    throw new PlannedRoomMoveError("Planned move must start from tomorrow onward.", 400);
  }
  if (compareDateStrings(startDate, reservationCheckinDate) < 0 || compareDateStrings(endDate, reservationCheckoutDate) > 0) {
    throw new PlannedRoomMoveError("Planned move range must stay within the reservation stay dates.", 400);
  }
}

export async function listReservationPlannedMoves(
  supabase: SupabaseLike,
  reservationId: string
): Promise<PlannedRoomMoveRow[]> {
  const { data, error } = await supabase
    .from("reservation_room_plans")
    .select("id, reservation_id, start_date, end_date, from_room_id_snapshot, to_room_type_id, to_room_id, move_reason, pricing_policy, discount_type, discount_value, discount_reason, do_not_move, do_not_move_note, status, executed_at, cancelled_at, created_at, updated_at")
    .eq("reservation_id", reservationId)
    .order("start_date", { ascending: true })
    .order("created_at", { ascending: true });

  if (error) {
    throw new PlannedRoomMoveError(error.message ?? "Failed to load planned room moves.", 500);
  }

  return (data ?? []) as PlannedRoomMoveRow[];
}

export async function listOverlappingPlannedRoomHolds(
  supabase: SupabaseLike,
  params: {
    checkinDate: string;
    checkoutDate: string;
    roomIds?: string[];
    excludePlanId?: string | null;
    excludeReservationId?: string | null;
  }
): Promise<PlannedRoomMoveRow[]> {
  const { checkinDate, checkoutDate, roomIds, excludePlanId, excludeReservationId } = params;
  if (!isValidDateString(checkinDate) || !isValidDateString(checkoutDate) || compareDateStrings(checkoutDate, checkinDate) <= 0) {
    throw new PlannedRoomMoveError("Invalid planned hold query date range.", 400);
  }

  let query = supabase
    .from("reservation_room_plans")
    .select("id, reservation_id, start_date, end_date, from_room_id_snapshot, to_room_type_id, to_room_id, move_reason, pricing_policy, discount_type, discount_value, discount_reason, do_not_move, do_not_move_note, status, executed_at, cancelled_at, created_at, updated_at, reservations!inner(id, status)")
    .eq("status", "planned")
    .eq("reservations.status", "active")
    .lt("start_date", checkoutDate)
    .gt("end_date", checkinDate);

  if (roomIds && roomIds.length > 0) {
    query = query.in("to_room_id", roomIds);
  }
  if (excludePlanId) {
    query = query.neq("id", excludePlanId);
  }
  if (excludeReservationId) {
    query = query.neq("reservation_id", excludeReservationId);
  }

  const { data, error } = await query;
  if (error) {
    throw new PlannedRoomMoveError(error.message ?? "Failed to check planned room holds.", 500);
  }
  return (data ?? []) as PlannedRoomMoveRow[];
}

export async function assertNoPlannedHoldConflict(
  supabase: SupabaseLike,
  params: {
    roomId: string;
    checkinDate: string;
    checkoutDate: string;
    excludePlanId?: string | null;
    excludeReservationId?: string | null;
  }
) {
  const rows = await listOverlappingPlannedRoomHolds(supabase, {
    checkinDate: params.checkinDate,
    checkoutDate: params.checkoutDate,
    roomIds: [params.roomId],
    excludePlanId: params.excludePlanId ?? null,
    excludeReservationId: params.excludeReservationId ?? null,
  });

  if (rows.length === 0) return null;
  const conflict = rows[0];
  throw new PlannedRoomMoveError(
    `Room is held by planned move for reservation ${conflict.reservation_id} (${conflict.start_date} → ${conflict.end_date}).`,
    409
  );
}

export function buildDoNotMoveNoteLine(params: {
  action: "create" | "update" | "cancel" | "override";
  startDate: string;
  endDate: string;
  roomNumber: string;
  note: string;
}) {
  const prefix =
    params.action === "create" ? "[DO NOT MOVE]" :
    params.action === "update" ? "[DO NOT MOVE UPDATE]" :
    params.action === "cancel" ? "[DO NOT MOVE CANCEL]" :
    "[DO NOT MOVE OVERRIDE]";

  return `${prefix}[${params.startDate} → ${params.endDate}][Room ${params.roomNumber}] ${params.note.trim()}`;
}

function normalizeReservationNoteLine(line: string) {
  const trimmed = line.replace(/\r\n/g, "\n").trim();
  if (!trimmed) return "";

  const lines = trimmed
    .split("\n")
    .map((entry) => entry.trim())
    .filter(Boolean);
  if (lines.length === 0) return "";

  // Preserve already-bulleted content as-is.
  if (/^[-*•]\s/u.test(lines[0])) {
    return lines.join("\n");
  }

  const parts = lines
    .flatMap((entry) => entry.split("|"))
    .map((entry) => entry.trim())
    .filter(Boolean);
  if (parts.length === 0) return "";
  if (parts.length === 1) return `- ${parts[0]}`;

  return [
    `- ${parts[0]}`,
    ...parts.slice(1).map((part) => `  • ${part}`),
  ].join("\n");
}

export async function appendReservationNoteLine(
  supabase: SupabaseLike,
  reservationId: string,
  line: string
) {
  const { data: reservation, error: reservationError } = await supabase
    .from("reservations")
    .select("id, note")
    .eq("id", reservationId)
    .maybeSingle();

  if (reservationError) {
    throw new PlannedRoomMoveError(reservationError.message ?? "Failed to load reservation note.", 500);
  }
  if (!reservation) {
    throw new PlannedRoomMoveError("Reservation not found.", 404);
  }

  const current = typeof reservation.note === "string" ? reservation.note.trimEnd() : "";
  const formattedLine = normalizeReservationNoteLine(line);
  if (!formattedLine) return;
  const nextNote = current ? `${current}\n${formattedLine}` : formattedLine;
  const { error: updateError } = await supabase
    .from("reservations")
    .update({ note: nextNote })
    .eq("id", reservationId);

  if (updateError) {
    throw new PlannedRoomMoveError(updateError.message ?? "Failed to update reservation note.", 500);
  }
}

export function expandPlannedMoveNights(row: Pick<PlannedRoomMoveRow, "start_date" | "end_date">) {
  return listNights(row.start_date, row.end_date);
}

export function assertNoOverlapWithinReservation(
  existingPlans: PlannedRoomMoveRow[],
  params: {
    startDate: string;
    endDate: string;
    excludePlanId?: string | null;
  }
) {
  const { startDate, endDate, excludePlanId } = params;
  const conflict = existingPlans.find((row) => {
    if (row.status !== "planned") return false;
    if (excludePlanId && row.id === excludePlanId) return false;
    return startDate < row.end_date && endDate > row.start_date;
  });

  if (conflict) {
    throw new PlannedRoomMoveError(
      `Planned move overlaps existing segment ${conflict.start_date} → ${conflict.end_date}.`,
      409
    );
  }
}

export async function assertNoReservationNightConflict(
  supabase: SupabaseLike,
  params: {
    roomId: string;
    checkinDate: string;
    checkoutDate: string;
    excludeReservationId?: string | null;
  }
) {
  const { roomId, checkinDate, checkoutDate, excludeReservationId } = params;
  let query = supabase
    .from("reservation_nights")
    .select("reservation_id, stay_date")
    .eq("room_id", roomId)
    .gte("stay_date", checkinDate)
    .lt("stay_date", checkoutDate)
    .is("cancelled_at", null)
    .limit(1);

  if (excludeReservationId) {
    query = query.neq("reservation_id", excludeReservationId);
  }

  const { data, error } = await query;
  if (error) {
    throw new PlannedRoomMoveError(error.message ?? "Failed to check active room nights.", 500);
  }

  if ((data ?? []).length > 0) {
    const conflict = data[0];
    throw new PlannedRoomMoveError(
      `Room is occupied on ${String(conflict.stay_date)} by reservation ${String(conflict.reservation_id)}.`,
      409
    );
  }
}

export async function assertNoRoomBlockConflict(
  supabase: SupabaseLike,
  params: {
    roomId: string;
    checkinDate: string;
    checkoutDate: string;
  }
) {
  const { roomId, checkinDate, checkoutDate } = params;
  const { data, error } = await supabase
    .from("room_blocks")
    .select("id, block_type, start_date, end_date, reason")
    .eq("room_id", roomId)
    .in("block_type", ["OOO", "OOS"])
    .lt("start_date", checkoutDate)
    .gt("end_date", checkinDate)
    .limit(1);

  if (error) {
    throw new PlannedRoomMoveError(error.message ?? "Failed to check room blocks.", 500);
  }

  if ((data ?? []).length > 0) {
    const conflict = data[0];
    throw new PlannedRoomMoveError(
      `Room has ${String(conflict.block_type)} block from ${String(conflict.start_date)} to ${String(conflict.end_date)}.`,
      409
    );
  }
}

export async function assertRoomAvailableForDateRange(
  supabase: SupabaseLike,
  params: {
    roomId: string;
    checkinDate: string;
    checkoutDate: string;
    excludeReservationId?: string | null;
    excludePlanId?: string | null;
  }
) {
  await assertNoReservationNightConflict(supabase, {
    roomId: params.roomId,
    checkinDate: params.checkinDate,
    checkoutDate: params.checkoutDate,
    excludeReservationId: params.excludeReservationId ?? null,
  });

  await assertNoRoomBlockConflict(supabase, {
    roomId: params.roomId,
    checkinDate: params.checkinDate,
    checkoutDate: params.checkoutDate,
  });

  await assertNoPlannedHoldConflict(supabase, {
    roomId: params.roomId,
    checkinDate: params.checkinDate,
    checkoutDate: params.checkoutDate,
    excludePlanId: params.excludePlanId ?? null,
    excludeReservationId: params.excludeReservationId ?? null,
  });
}

export async function findPlannedMoveEffectiveOnDate(
  supabase: SupabaseLike,
  reservationId: string,
  targetDate: string
): Promise<PlannedRoomMoveRow | null> {
  const { data, error } = await supabase
    .from("reservation_room_plans")
    .select("id, reservation_id, start_date, end_date, from_room_id_snapshot, to_room_type_id, to_room_id, move_reason, pricing_policy, discount_type, discount_value, discount_reason, do_not_move, do_not_move_note, status, executed_at, cancelled_at, created_at, updated_at")
    .eq("reservation_id", reservationId)
    .eq("status", "planned")
    .lte("start_date", targetDate)
    .gt("end_date", targetDate)
    .order("start_date", { ascending: true })
    .limit(1)
    .maybeSingle();

  if (error) {
    throw new PlannedRoomMoveError(error.message ?? "Failed to load effective planned move.", 500);
  }

  return (data as PlannedRoomMoveRow | null) ?? null;
}

export async function resolvePlannedMoveSourceSnapshotId(
  supabase: SupabaseLike,
  params: {
    reservationId: string;
    startDate: string;
    reservationCheckinDate: string;
  }
) {
  const { reservationId, startDate, reservationCheckinDate } = params;
  const previousNight = addDays(startDate, -1);
  const lookupDate = compareDateStrings(previousNight, reservationCheckinDate) >= 0 ? previousNight : reservationCheckinDate;

  const { data, error } = await supabase
    .from("reservation_nights")
    .select("room_id")
    .eq("reservation_id", reservationId)
    .eq("stay_date", lookupDate)
    .is("cancelled_at", null)
    .maybeSingle();

  if (error) {
    throw new PlannedRoomMoveError(error.message ?? "Failed to resolve planned move source room.", 500);
  }

  return data?.room_id ? String(data.room_id) : null;
}

async function loadRoomTypeMapForRoomIds(supabase: SupabaseLike, roomIds: string[]) {
  const uniqueRoomIds = Array.from(new Set(roomIds.filter(Boolean)));
  if (uniqueRoomIds.length === 0) {
    return new Map<string, number>();
  }

  const { data, error } = await supabase
    .from("rooms")
    .select("id, room_type_id")
    .in("id", uniqueRoomIds);

  if (error) {
    throw new PlannedRoomMoveError(error.message ?? "Failed to load room types for planned moves.", 500);
  }

  const map = new Map<string, number>();
  for (const row of data ?? []) {
    const roomId = row?.id ? String(row.id) : "";
    const roomTypeId = Number((row as any)?.room_type_id ?? 0);
    if (roomId && Number.isFinite(roomTypeId) && roomTypeId > 0) {
      map.set(roomId, roomTypeId);
    }
  }
  return map;
}

export async function rebuildReservationFutureRoomPath(
  supabase: SupabaseLike,
  params: {
    reservationId: string;
    startDateOverride?: string | null;
    fallbackSourceRoomId?: string | null;
  }
) {
  const { reservationId, startDateOverride = null, fallbackSourceRoomId = null } = params;

  const { data: reservation, error: reservationError } = await supabase
    .from("reservations")
    .select("id, checkin_date, checkout_date")
    .eq("id", reservationId)
    .maybeSingle();

  if (reservationError) {
    throw new PlannedRoomMoveError(reservationError.message ?? "Failed to load reservation for planned path rebuild.", 500);
  }
  if (!reservation) {
    throw new PlannedRoomMoveError("Reservation not found.", 404);
  }

  const plans = (await listReservationPlannedMoves(supabase, reservationId))
    .filter((row) => row.status === "planned")
    .sort((left, right) => left.start_date.localeCompare(right.start_date) || left.created_at.localeCompare(right.created_at));

  if (plans.length === 0 && !startDateOverride) {
    return { rebuilt: false, stay_dates: [] as string[] };
  }

  const earliestStartDate =
    startDateOverride && isValidDateString(startDateOverride)
      ? startDateOverride
      : plans[0].start_date;
  const stayDates = listNights(earliestStartDate, String(reservation.checkout_date));
  if (stayDates.length === 0) {
    return { rebuilt: false, stay_dates: [] as string[] };
  }

  const lookupDate = addDays(earliestStartDate, -1);
  const { data: baseNight, error: baseNightError } = await supabase
    .from("reservation_nights")
    .select("room_id")
    .eq("reservation_id", reservationId)
    .eq("stay_date", lookupDate)
    .is("cancelled_at", null)
    .maybeSingle();

  if (baseNightError) {
    throw new PlannedRoomMoveError(baseNightError.message ?? "Failed to load base room for planned path rebuild.", 500);
  }

  let currentRoomId =
    fallbackSourceRoomId
      ? String(fallbackSourceRoomId)
      : baseNight?.room_id
        ? String(baseNight.room_id)
        : plans[0]?.from_room_id_snapshot
          ? String(plans[0].from_room_id_snapshot)
          : null;
  if (!currentRoomId) {
    throw new PlannedRoomMoveError("Could not resolve source room for planned path rebuild.", 409);
  }

  const roomTypeMap = await loadRoomTypeMapForRoomIds(
    supabase,
    [currentRoomId, ...plans.map((row) => String(row.to_room_id)).filter(Boolean)].filter(Boolean) as string[]
  );

  const planByStartDate = new Map<string, PlannedRoomMoveRow>();
  for (const plan of plans) {
    planByStartDate.set(plan.start_date, plan);
  }

  for (const stayDate of stayDates) {
    const startingPlan = planByStartDate.get(stayDate);
    if (startingPlan) {
      currentRoomId = String(startingPlan.to_room_id);
    }
    const roomTypeId = roomTypeMap.get(currentRoomId) ?? null;
    const { error: updateError } = await supabase
      .from("reservation_nights")
      .update({
        room_id: currentRoomId,
        room_type_id: roomTypeId,
        assignment_source: null,
        dependency_plan_id: null,
        dependency_reason: null,
      })
      .eq("reservation_id", reservationId)
      .eq("stay_date", stayDate)
      .is("cancelled_at", null);

    if (updateError) {
      throw new PlannedRoomMoveError(updateError.message ?? "Failed to rebuild reservation path for planned move.", 500);
    }
  }

  return { rebuilt: true, stay_dates: stayDates };
}

export async function syncReservationNightDependencyMetadata(
  supabase: SupabaseLike,
  params: {
    reservationId: string;
  }
) {
  const { reservationId } = params;
  const { data: nights, error: nightsError } = await supabase
    .from("reservation_nights")
    .select("id, room_id, stay_date")
    .eq("reservation_id", reservationId)
    .is("cancelled_at", null)
    .order("stay_date", { ascending: true });

  if (nightsError) {
    throw new PlannedRoomMoveError(nightsError.message ?? "Failed to load reservation nights for dependency sync.", 500);
  }

  if (!nights || nights.length === 0) {
    return;
  }

  const activeNights = nights.map((row: any) => ({
    id: String(row.id),
    room_id: row.room_id ? String(row.room_id) : null,
    stay_date: String(row.stay_date),
  }));

  const roomIds = Array.from(new Set(activeNights.map((row: { room_id: string | null }) => row.room_id).filter(Boolean))) as string[];
  const firstStayDate = activeNights[0]?.stay_date;
  const lastStayDate = activeNights[activeNights.length - 1]?.stay_date;
  const checkoutDate = addDays(lastStayDate, 1);

  let planRows: PlannedRoomMoveRow[] = [];
  if (roomIds.length > 0) {
    const { data: plans, error: plansError } = await supabase
      .from("reservation_room_plans")
      .select("id, reservation_id, start_date, end_date, from_room_id_snapshot, to_room_type_id, to_room_id, move_reason, pricing_policy, discount_type, discount_value, discount_reason, do_not_move, do_not_move_note, status, executed_at, cancelled_at, created_at, updated_at")
      .eq("status", "planned")
      .in("from_room_id_snapshot", roomIds)
      .lt("start_date", checkoutDate)
      .gt("end_date", firstStayDate)
      .neq("reservation_id", reservationId);

    if (plansError) {
      throw new PlannedRoomMoveError(plansError.message ?? "Failed to load planned move dependencies.", 500);
    }
    planRows = (plans ?? []) as PlannedRoomMoveRow[];
  }

  const { error: clearError } = await supabase
    .from("reservation_nights")
    .update({
      assignment_source: null,
      dependency_plan_id: null,
      dependency_reason: null,
    })
    .eq("reservation_id", reservationId)
    .is("cancelled_at", null);

  if (clearError) {
    throw new PlannedRoomMoveError(clearError.message ?? "Failed to clear room dependency metadata.", 500);
  }

  for (const night of activeNights) {
    if (!night.room_id) continue;

    const matchingPlan = planRows.find((plan) => {
      if (!plan.from_room_id_snapshot || String(plan.from_room_id_snapshot) !== night.room_id) return false;
      return night.stay_date >= plan.start_date && night.stay_date < plan.end_date;
    });

    if (!matchingPlan) continue;

    const { error: updateError } = await supabase
      .from("reservation_nights")
      .update({
        assignment_source: "planned_move_release",
        dependency_plan_id: matchingPlan.id,
        dependency_reason: `Released by planned move ${matchingPlan.start_date} -> ${matchingPlan.end_date}`,
      })
      .eq("id", night.id);

    if (updateError) {
      throw new PlannedRoomMoveError(updateError.message ?? "Failed to write room dependency metadata.", 500);
    }
  }
}

export async function listPlanDependentAssignments(
  supabase: SupabaseLike,
  params: {
    planId: string;
    excludeReservationId?: string | null;
  }
): Promise<PlanDependentAssignment[]> {
  const { planId, excludeReservationId } = params;
  let query = supabase
    .from("reservation_nights")
    .select(`
      reservation_id,
      room_id,
      stay_date,
      reservations!reservation_nights_reservation_id_fkey(
        booking_code,
        guest_name
      )
    `)
    .eq("dependency_plan_id", planId)
    .is("cancelled_at", null)
    .not("room_id", "is", null)
    .order("stay_date", { ascending: true });

  if (excludeReservationId) {
    query = query.neq("reservation_id", excludeReservationId);
  }

  const { data, error } = await query;
  if (error) {
    throw new PlannedRoomMoveError(error.message ?? "Failed to load plan-dependent assignments.", 500);
  }

  const roomIds = Array.from(new Set((data ?? []).map((row: any) => row.room_id ? String(row.room_id) : "").filter(Boolean)));
  const roomNumberMap = new Map<string, string>();
  if (roomIds.length > 0) {
    const { data: rooms, error: roomsError } = await supabase
      .from("rooms")
      .select("id, room_number")
      .in("id", roomIds);
    if (roomsError) {
      throw new PlannedRoomMoveError(roomsError.message ?? "Failed to resolve dependent assignment rooms.", 500);
    }
    for (const row of rooms ?? []) {
      if (row?.id) roomNumberMap.set(String(row.id), String((row as any).room_number ?? ""));
    }
  }

  const grouped = new Map<string, PlanDependentAssignment>();
  for (const row of data ?? []) {
    const reservationId = row?.reservation_id ? String(row.reservation_id) : "";
    if (!reservationId) continue;
    const reservationRef = Array.isArray((row as any).reservations) ? (row as any).reservations[0] : (row as any).reservations;
    const existing = grouped.get(reservationId);
    if (existing) {
      existing.stay_dates.push(String((row as any).stay_date));
      continue;
    }
    const roomId = row?.room_id ? String(row.room_id) : null;
    grouped.set(reservationId, {
      reservation_id: reservationId,
      booking_code: reservationRef?.booking_code ?? null,
      guest_name: reservationRef?.guest_name ?? null,
      stay_dates: [String((row as any).stay_date)],
      room_id: roomId,
      room_number: roomId ? roomNumberMap.get(roomId) ?? null : null,
      source: "dependency",
    });
  }

  return Array.from(grouped.values()).map((entry) => ({
    ...entry,
    stay_dates: Array.from(new Set(entry.stay_dates)).sort(),
  }));
}

async function listPlanOverlapFallbackAssignments(
  supabase: SupabaseLike,
  params: {
    sourceRoomId: string | null;
    startDate: string;
    endDate: string;
    excludeReservationId?: string | null;
  }
): Promise<PlanDependentAssignment[]> {
  const { sourceRoomId, startDate, endDate, excludeReservationId } = params;
  if (!sourceRoomId || !isValidDateString(startDate) || !isValidDateString(endDate) || compareDateStrings(endDate, startDate) <= 0) {
    return [];
  }

  let query = supabase
    .from("reservation_nights")
    .select(`
      reservation_id,
      room_id,
      stay_date,
      reservations!reservation_nights_reservation_id_fkey(
        booking_code,
        guest_name
      )
    `)
    .eq("room_id", sourceRoomId)
    .gte("stay_date", startDate)
    .lt("stay_date", endDate)
    .is("cancelled_at", null)
    .order("stay_date", { ascending: true });

  if (excludeReservationId) {
    query = query.neq("reservation_id", excludeReservationId);
  }

  const { data, error } = await query;
  if (error) {
    throw new PlannedRoomMoveError(error.message ?? "Failed to load overlap assignments for planned move.", 500);
  }
  if (!data || data.length === 0) return [];

  let roomNumber: string | null = null;
  const { data: roomRow, error: roomError } = await supabase
    .from("rooms")
    .select("room_number")
    .eq("id", sourceRoomId)
    .maybeSingle();
  if (roomError) {
    throw new PlannedRoomMoveError(roomError.message ?? "Failed to resolve overlap assignment room number.", 500);
  }
  if (roomRow?.room_number) {
    roomNumber = String(roomRow.room_number);
  }

  const grouped = new Map<string, PlanDependentAssignment>();
  for (const row of data ?? []) {
    const reservationId = row?.reservation_id ? String(row.reservation_id) : "";
    if (!reservationId) continue;
    const reservationRef = Array.isArray((row as any).reservations) ? (row as any).reservations[0] : (row as any).reservations;
    const existing = grouped.get(reservationId);
    if (existing) {
      existing.stay_dates.push(String((row as any).stay_date));
      continue;
    }
    grouped.set(reservationId, {
      reservation_id: reservationId,
      booking_code: reservationRef?.booking_code ?? null,
      guest_name: reservationRef?.guest_name ?? null,
      stay_dates: [String((row as any).stay_date)],
      room_id: sourceRoomId,
      room_number: roomNumber,
      source: "overlap_fallback",
    });
  }

  return Array.from(grouped.values()).map((entry) => ({
    ...entry,
    stay_dates: Array.from(new Set(entry.stay_dates)).sort(),
  }));
}

function mergePlanAssignmentLists(
  dependencyRows: PlanDependentAssignment[],
  overlapRows: PlanDependentAssignment[]
): PlanDependentAssignment[] {
  const merged = new Map<string, PlanDependentAssignment>();

  for (const row of dependencyRows) {
    merged.set(row.reservation_id, {
      ...row,
      stay_dates: Array.from(new Set(row.stay_dates)).sort(),
      source: "dependency",
    });
  }

  for (const row of overlapRows) {
    const existing = merged.get(row.reservation_id);
    if (!existing) {
      merged.set(row.reservation_id, {
        ...row,
        stay_dates: Array.from(new Set(row.stay_dates)).sort(),
        source: row.source ?? "overlap_fallback",
      });
      continue;
    }

    existing.stay_dates = Array.from(new Set([...existing.stay_dates, ...row.stay_dates])).sort();
    if (existing.source !== "dependency") {
      existing.source = row.source ?? "overlap_fallback";
    }
    if (!existing.room_number && row.room_number) {
      existing.room_number = row.room_number;
    }
    if (!existing.room_id && row.room_id) {
      existing.room_id = row.room_id;
    }
  }

  return Array.from(merged.values());
}

export async function listPlanImpactAssignments(
  supabase: SupabaseLike,
  params: {
    planId: string;
    sourceRoomId: string | null;
    startDate: string;
    endDate: string;
    excludeReservationId?: string | null;
  }
): Promise<PlanDependentAssignment[]> {
  const dependencyRows = await listPlanDependentAssignments(supabase, {
    planId: params.planId,
    excludeReservationId: params.excludeReservationId,
  });
  const overlapRows = await listPlanOverlapFallbackAssignments(supabase, {
    sourceRoomId: params.sourceRoomId,
    startDate: params.startDate,
    endDate: params.endDate,
    excludeReservationId: params.excludeReservationId,
  });
  return mergePlanAssignmentLists(dependencyRows, overlapRows);
}

export async function floatPlanDependentAssignments(
  supabase: SupabaseLike,
  params: {
    planId: string;
    excludeReservationId?: string | null;
    auditSource?: "manual" | "system" | "api" | "night_audit";
  }
) {
  const dependentAssignments = await listPlanDependentAssignments(supabase, params);
  if (dependentAssignments.length === 0) {
    return { affected: [] as PlanDependentAssignment[] };
  }

  for (const entry of dependentAssignments) {
    const { error: updateError } = await supabase
      .from("reservation_nights")
      .update({
        room_id: null,
        assignment_source: null,
        dependency_plan_id: null,
        dependency_reason: null,
      })
      .eq("reservation_id", entry.reservation_id)
      .eq("dependency_plan_id", params.planId)
      .is("cancelled_at", null);

    if (updateError) {
      throw new PlannedRoomMoveError(updateError.message ?? "Failed to float dependent reservation.", 500);
    }

    await supabase.from("audit_logs").insert({
      action: "planned_move_dependency_floated",
      entity_type: "reservation",
      entity_id: entry.reservation_id,
      before_json: {
        dependency_plan_id: params.planId,
        room_id: entry.room_id,
        room_number: entry.room_number,
        stay_dates: entry.stay_dates,
      },
      after_json: {
        room_id: null,
        room_number: null,
        note: "Auto-unassigned because planned move dependency was removed.",
      },
      business_date: toBangkokDateString(),
      source: normalizeAuditSource(params.auditSource ?? "manual"),
    });
  }

  return { affected: dependentAssignments };
}

export async function floatPlanImpactAssignments(
  supabase: SupabaseLike,
  params: {
    planId: string;
    sourceRoomId: string | null;
    startDate: string;
    endDate: string;
    excludeReservationId?: string | null;
    auditSource?: "manual" | "system" | "api" | "night_audit";
  }
) {
  const impactedAssignments = await listPlanImpactAssignments(supabase, params);
  if (impactedAssignments.length === 0) {
    return { affected: [] as PlanDependentAssignment[] };
  }

  for (const entry of impactedAssignments) {
    let updateQuery = supabase
      .from("reservation_nights")
      .update({
        room_id: null,
        assignment_source: null,
        dependency_plan_id: null,
        dependency_reason: null,
      })
      .eq("reservation_id", entry.reservation_id)
      .is("cancelled_at", null);

    if (entry.source === "dependency") {
      updateQuery = updateQuery.eq("dependency_plan_id", params.planId);
    } else {
      if (!params.sourceRoomId) continue;
      updateQuery = updateQuery
        .eq("room_id", params.sourceRoomId)
        .gte("stay_date", params.startDate)
        .lt("stay_date", params.endDate);
    }

    const { error: updateError } = await updateQuery;
    if (updateError) {
      throw new PlannedRoomMoveError(updateError.message ?? "Failed to float impacted reservation.", 500);
    }

    await supabase.from("audit_logs").insert({
      action: "planned_move_dependency_floated",
      entity_type: "reservation",
      entity_id: entry.reservation_id,
      before_json: {
        dependency_plan_id: params.planId,
        room_id: entry.room_id,
        room_number: entry.room_number,
        stay_dates: entry.stay_dates,
        source: entry.source ?? "overlap_fallback",
      },
      after_json: {
        room_id: null,
        room_number: null,
        note: "Auto-unassigned because planned move dependency was removed.",
      },
      business_date: toBangkokDateString(),
      source: normalizeAuditSource(params.auditSource ?? "manual"),
    });
  }

  return { affected: impactedAssignments };
}
