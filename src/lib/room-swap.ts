import { compareDateStrings } from "@/lib/dates";
import {
  appendReservationNoteLine,
  listReservationPlannedMoves,
  syncReservationNightDependencyMetadata,
} from "@/lib/planned-room-moves";
import { normalizeAuditSource } from "@/lib/audit-utils";
import { resolveBusinessDate, toLocalDate } from "@/lib/folio-fees";
import { syncDynamicRoomLinksForReservation } from "@/lib/logbook-api";

type SupabaseLike = {
  from: (table: string) => any;
};

async function resolveRoomSwapBusinessDate(supabase: SupabaseLike): Promise<string> {
  return resolveBusinessDate(supabase as any, toLocalDate(new Date(), "Asia/Bangkok"));
}

export type RoomSwapReasonCode =
  | "reservation_not_found"
  | "reservation_not_active"
  | "already_checked_in"
  | "room_not_assigned"
  | "target_outside_source_window"
  | "multiple_room_segments"
  | "planned_move_active"
  | "room_type_mismatch"
  | "same_room"
  | "dayuse_room"
  | "target_checkout_exceeds_source"
  | "source_room_conflict"
  | "target_room_conflict";

type ReservationSwapNight = {
  id: string;
  stay_date: string;
  room_id: string;
  room_number: string | null;
  room_type_id: number | null;
  room_is_dayuse: boolean;
  dayuse_session: number;
};

export type ReservationSwapContext = {
  reservation_id: string;
  booking_code: string;
  guest_name: string;
  checkin_date: string;
  checkout_date: string;
  status: string;
  checked_in_at: string | null;
  room_type_id: number | null;
  room_type_name: string | null;
  current_room_id: string | null;
  current_room_number: string | null;
  room_path_label: string | null;
  current_room_is_dayuse: boolean;
  has_multiple_room_segments: boolean;
  has_active_planned_move: boolean;
  do_not_move_assigned_room: boolean;
  do_not_move_reason: string | null;
  active_nights: ReservationSwapNight[];
};

export type SwapCandidate = {
  reservation_id: string;
  booking_code: string;
  guest_name: string;
  room_id: string | null;
  room_number: string | null;
  checkin_date: string;
  checkout_date: string;
  nights: number;
  can_swap: boolean;
  reason_code: RoomSwapReasonCode | null;
  reason: string | null;
  do_not_move_assigned_room: boolean;
  do_not_move_reason: string | null;
};

export class RoomSwapError extends Error {
  status: number;
  reasonCode: RoomSwapReasonCode | null;

  constructor(message: string, status = 400, reasonCode: RoomSwapReasonCode | null = null) {
    super(message);
    this.name = "RoomSwapError";
    this.status = status;
    this.reasonCode = reasonCode;
  }
}

function roomStayNights(checkinDate: string, checkoutDate: string) {
  const diff = Math.round(
    (new Date(`${checkoutDate}T00:00:00Z`).getTime() - new Date(`${checkinDate}T00:00:00Z`).getTime()) / 86400000
  );
  return diff > 0 ? diff : 0;
}

function buildRoomPathLabel(nights: ReservationSwapNight[]): string | null {
  const labels: string[] = [];
  for (const night of nights) {
    const roomNumber = String(night.room_number ?? "").trim();
    if (!roomNumber) continue;
    if (labels[labels.length - 1] !== roomNumber) {
      labels.push(roomNumber);
    }
  }
  if (labels.length === 0) return null;
  return labels.join(" → ");
}

function buildNightMap(nights: ReservationSwapNight[]): Map<string, ReservationSwapNight> {
  return new Map(nights.map((night) => [night.stay_date, night]));
}

function resolveDynamicRoomCode(context: ReservationSwapContext | null): string | null {
  if (!context || context.has_multiple_room_segments) return null;
  return context.active_nights[0]?.room_number ?? null;
}

async function loadRoomsByIds(supabase: SupabaseLike, roomIds: string[]) {
  const ids = Array.from(new Set(roomIds.filter(Boolean)));
  if (ids.length === 0) return new Map<string, any>();

  const { data, error } = await supabase
    .from("rooms")
    .select("id, room_number, room_type_id, is_dayuse")
    .in("id", ids);

  if (error) {
    throw new RoomSwapError(error.message ?? "Failed to load room details.", 500);
  }

  return new Map((data ?? []).map((row: any) => [String(row.id), row]));
}

export async function loadReservationSwapContext(
  supabase: SupabaseLike,
  reservationId: string
): Promise<ReservationSwapContext | null> {
  const { data: reservation, error: reservationError } = await supabase
    .from("reservations")
    .select("id, booking_code, guest_name, checkin_date, checkout_date, status, checked_in_at, do_not_move_assigned_room, do_not_move_reason")
    .eq("id", reservationId)
    .maybeSingle();

  if (reservationError) {
    throw new RoomSwapError(reservationError.message ?? "Failed to load reservation.", 500);
  }
  if (!reservation) return null;

  const { data: nights, error: nightsError } = await supabase
    .from("reservation_nights")
    .select("id, room_id, room_type_id, stay_date, dayuse_session")
    .eq("reservation_id", reservationId)
    .is("cancelled_at", null)
    .order("stay_date", { ascending: true });

  if (nightsError) {
    throw new RoomSwapError(nightsError.message ?? "Failed to load reservation nights.", 500);
  }

  const activeNightsRaw = nights ?? [];
  const roomIds: string[] = Array.from(
    new Set(activeNightsRaw.map((row: any) => String(row.room_id ?? "")).filter((value: string) => Boolean(value)))
  );
  const roomTypeIds: number[] = Array.from(
    new Set(
      activeNightsRaw
        .map((row: any) => Number(row.room_type_id ?? 0))
        .filter((value: number) => Number.isFinite(value) && value > 0)
    )
  );
  const roomsById = await loadRoomsByIds(supabase, roomIds);
  const activeNights: ReservationSwapNight[] = activeNightsRaw
    .map((row: any) => {
      const roomId = String(row.room_id ?? "").trim();
      if (!roomId) return null;
      const room = roomsById.get(roomId);
      return {
        id: String(row.id),
        stay_date: String(row.stay_date),
        room_id: roomId,
        room_number: room?.room_number ? String(room.room_number) : null,
        room_type_id: Number(row.room_type_id ?? 0) || null,
        room_is_dayuse: Boolean(room?.is_dayuse),
        dayuse_session: Number(row.dayuse_session ?? 0),
      } satisfies ReservationSwapNight;
    })
    .filter(Boolean) as ReservationSwapNight[];
  const currentRoom = activeNights[0] ? roomsById.get(activeNights[0].room_id) : null;
  const roomPathLabel = buildRoomPathLabel(activeNights);
  const uniqueRoomIds = Array.from(new Set(activeNights.map((night) => night.room_id)));

  const plannedMoves = (await listReservationPlannedMoves(supabase as any, reservationId)).filter((row) => row.status === "planned");

  return {
    reservation_id: String(reservation.id),
    booking_code: String(reservation.booking_code ?? reservation.id),
    guest_name: String(reservation.guest_name ?? "Guest"),
    checkin_date: String(reservation.checkin_date),
    checkout_date: String(reservation.checkout_date),
    status: String(reservation.status ?? ""),
    checked_in_at: reservation.checked_in_at ? String(reservation.checked_in_at) : null,
    room_type_id: roomTypeIds[0] ?? null,
    room_type_name: null,
    current_room_id: activeNights[0]?.room_id ?? null,
    current_room_number: roomPathLabel ?? (currentRoom?.room_number ? String(currentRoom.room_number) : null),
    room_path_label: roomPathLabel,
    current_room_is_dayuse: activeNights.some((night) => night.room_is_dayuse),
    has_multiple_room_segments: uniqueRoomIds.length > 1,
    has_active_planned_move: plannedMoves.length > 0,
    do_not_move_assigned_room: Boolean(reservation.do_not_move_assigned_room),
    do_not_move_reason: reservation.do_not_move_reason ? String(reservation.do_not_move_reason) : null,
    active_nights: activeNights,
  };
}

export async function evaluateRoomSwapEligibility(
  supabase: SupabaseLike,
  source: ReservationSwapContext,
  target: ReservationSwapContext
): Promise<{ can_swap: boolean; reason_code: RoomSwapReasonCode | null; reason: string | null }> {
  void supabase;
  if (source.status !== "active" || target.status !== "active") {
    return { can_swap: false, reason_code: "reservation_not_active", reason: "Swap unavailable: reservation is not active." };
  }
  if (source.checked_in_at || target.checked_in_at) {
    return { can_swap: false, reason_code: "already_checked_in", reason: "Swap unavailable: target reservation already checked in." };
  }
  if (source.active_nights.length === 0 || target.active_nights.length === 0) {
    return { can_swap: false, reason_code: "room_not_assigned", reason: "Swap unavailable: both reservations must already have assigned rooms." };
  }
  if (source.has_active_planned_move || target.has_active_planned_move) {
    return { can_swap: false, reason_code: "planned_move_active", reason: "Swap unavailable: target reservation has active planned move." };
  }
  if (source.current_room_is_dayuse || target.current_room_is_dayuse) {
    return { can_swap: false, reason_code: "dayuse_room", reason: "Swap unavailable: day-use room cannot be used in this flow." };
  }
  if (!source.room_type_id || !target.room_type_id || source.room_type_id !== target.room_type_id) {
    return { can_swap: false, reason_code: "room_type_mismatch", reason: "Swap unavailable: room type differs." };
  }
  if (
    compareDateStrings(target.checkin_date, source.checkin_date) < 0 ||
    compareDateStrings(target.checkout_date, source.checkout_date) > 0
  ) {
    return {
      can_swap: false,
      reason_code: "target_outside_source_window",
      reason: `Swap unavailable: ${target.booking_code} must fit fully inside ${source.booking_code}'s stay window.`,
    };
  }

  const sourceNightByDate = buildNightMap(source.active_nights);
  let samePath = true;
  for (const targetNight of target.active_nights) {
    const sourceNight = sourceNightByDate.get(targetNight.stay_date);
    if (!sourceNight || !sourceNight.room_id || !targetNight.room_id) {
      return {
        can_swap: false,
        reason_code: "room_not_assigned",
        reason: "Swap unavailable: one of the bookings has unassigned nights in the selected window.",
      };
    }
    if (sourceNight.room_id !== targetNight.room_id) {
      samePath = false;
    }
  }

  if (samePath) {
    return {
      can_swap: false,
      reason_code: "same_room",
      reason: "Swap unavailable: both bookings already use the same room path in that window.",
    };
  }

  return { can_swap: true, reason_code: null, reason: null };
}

export async function listSwapCandidatesForReservation(
  supabase: SupabaseLike,
  reservationId: string
): Promise<SwapCandidate[]> {
  const source = await loadReservationSwapContext(supabase, reservationId);
  if (!source || !source.room_type_id || source.active_nights.length === 0 || source.checked_in_at) return [];

  const { data: reservations, error } = await supabase
    .from("reservations")
    .select("id, booking_code, guest_name, checkin_date, checkout_date, status, checked_in_at")
    .eq("status", "active")
    .is("checked_in_at", null)
    .neq("id", reservationId)
    .order("checkin_date", { ascending: true })
    .order("booking_code", { ascending: true });

  if (error) {
    throw new RoomSwapError(error.message ?? "Failed to load swap candidates.", 500);
  }

  const contexts = await Promise.all((reservations ?? []).map(async (row: any) => loadReservationSwapContext(supabase, String(row.id))));

  const results: SwapCandidate[] = [];
  for (const context of contexts) {
    if (!context || context.checked_in_at) continue;

    const evaluation = await evaluateRoomSwapEligibility(supabase, source, context);
    results.push({
      reservation_id: context.reservation_id,
      booking_code: context.booking_code,
      guest_name: context.guest_name,
      room_id: context.current_room_id,
      room_number: context.current_room_number,
      checkin_date: context.checkin_date,
      checkout_date: context.checkout_date,
      nights: roomStayNights(context.checkin_date, context.checkout_date),
      can_swap: evaluation.can_swap,
      reason_code: evaluation.reason_code,
      reason: evaluation.reason,
      do_not_move_assigned_room: context.do_not_move_assigned_room,
      do_not_move_reason: context.do_not_move_reason,
    });
  }

  return results.sort((left, right) => {
    if (left.can_swap !== right.can_swap) return left.can_swap ? -1 : 1;
    return left.booking_code.localeCompare(right.booking_code);
  });
}

type SwapWindowNightPair = {
  stay_date: string;
  source_night: ReservationSwapNight;
  target_night: ReservationSwapNight;
};

function buildSwapWindowNightPairs(
  source: ReservationSwapContext,
  target: ReservationSwapContext
): SwapWindowNightPair[] {
  const sourceNightByDate = buildNightMap(source.active_nights);
  return target.active_nights
    .map((targetNight) => {
      const sourceNight = sourceNightByDate.get(targetNight.stay_date);
      if (!sourceNight) {
        throw new RoomSwapError(
          `Swap unavailable: ${source.booking_code} has no assigned room on ${targetNight.stay_date}.`,
          409,
          "room_not_assigned"
        );
      }
      return {
        stay_date: targetNight.stay_date,
        source_night: sourceNight,
        target_night: targetNight,
      } satisfies SwapWindowNightPair;
    })
    .sort((left, right) => left.stay_date.localeCompare(right.stay_date));
}

async function shiftNightSessions(
  supabase: SupabaseLike,
  nights: ReservationSwapNight[],
  delta: number,
  failureMessage: string
) {
  for (const night of nights) {
    const { error: updateError } = await supabase
      .from("reservation_nights")
      .update({ dayuse_session: night.dayuse_session + delta })
      .eq("id", night.id);
    if (updateError) {
      throw new RoomSwapError(updateError.message ?? failureMessage, 500);
    }
  }
}

async function updateNightRoom(
  supabase: SupabaseLike,
  nightId: string,
  roomId: string,
  failureMessage: string
) {
  const { error } = await supabase
    .from("reservation_nights")
    .update({
      room_id: roomId,
      assignment_source: "manual",
      dependency_plan_id: null,
      dependency_reason: null,
    })
    .eq("id", nightId);

  if (error) {
    throw new RoomSwapError(error.message ?? failureMessage, 500);
  }
}

export async function executeWholeStayRoomSwap(
  supabase: SupabaseLike,
  sourceReservationId: string,
  targetReservationId: string
) {
  const source = await loadReservationSwapContext(supabase, sourceReservationId);
  const target = await loadReservationSwapContext(supabase, targetReservationId);

  if (!source || !target) {
    throw new RoomSwapError("Swap unavailable: reservation not found.", 404, "reservation_not_found");
  }

  const evaluation = await evaluateRoomSwapEligibility(supabase, source, target);
  if (!evaluation.can_swap) {
    throw new RoomSwapError(evaluation.reason ?? "Swap unavailable.", 409, evaluation.reason_code);
  }

  const swapPairs = buildSwapWindowNightPairs(source, target);
  if (swapPairs.length === 0) {
    throw new RoomSwapError("Swap unavailable: no overlapping assigned nights found.", 409, "room_not_assigned");
  }

  // NOTE:
  // reservation_nights has unique index (room_id, stay_date, dayuse_session) for active rows.
  // A direct two-step room update can collide on overlapping dates.
  // We temporarily shift source dayuse_session to avoid transient key collisions during swap.
  const SESSION_SHIFT = 100;
  const sourceShiftNights = swapPairs.map((pair) => pair.source_night);
  const targetShiftNights = swapPairs.map((pair) => pair.target_night);
  let sourceSessionShifted = false;
  const updatedSourceNightIds = new Set<string>();
  const updatedTargetNightIds = new Set<string>();

  await shiftNightSessions(supabase, sourceShiftNights, SESSION_SHIFT, "Failed to prepare reservation for swap.");
  sourceSessionShifted = true;

  try {
    for (const pair of swapPairs) {
      await updateNightRoom(
        supabase,
        pair.source_night.id,
        pair.target_night.room_id,
        "Failed to update source reservation nights for swap."
      );
      updatedSourceNightIds.add(pair.source_night.id);
    }

    for (const pair of swapPairs) {
      await updateNightRoom(
        supabase,
        pair.target_night.id,
        pair.source_night.room_id,
        "Failed to update target reservation nights for swap."
      );
      updatedTargetNightIds.add(pair.target_night.id);
    }

    await shiftNightSessions(supabase, sourceShiftNights, SESSION_SHIFT * -1, "Swap succeeded but session cleanup failed.");
    sourceSessionShifted = false;
  } catch (error) {
    for (const pair of swapPairs) {
      if (updatedTargetNightIds.has(pair.target_night.id)) {
        await supabase
          .from("reservation_nights")
          .update({ room_id: pair.target_night.room_id })
          .eq("id", pair.target_night.id);
      }
    }
    for (const pair of swapPairs) {
      if (updatedSourceNightIds.has(pair.source_night.id)) {
        await supabase
          .from("reservation_nights")
          .update({ room_id: pair.source_night.room_id })
          .eq("id", pair.source_night.id);
      }
    }

    if (sourceSessionShifted) {
      try {
        await shiftNightSessions(supabase, sourceShiftNights, SESSION_SHIFT * -1, "Rollback session cleanup failed.");
      } catch {
        // swallow rollback cleanup error; original swap error remains primary
      }
      sourceSessionShifted = false;
    }
    throw error;
  }

  await syncReservationNightDependencyMetadata(supabase as any, { reservationId: sourceReservationId });
  await syncReservationNightDependencyMetadata(supabase as any, { reservationId: targetReservationId });
  const businessDate = await resolveRoomSwapBusinessDate(supabase);
  const sourceAfter = await loadReservationSwapContext(supabase, sourceReservationId);
  const targetAfter = await loadReservationSwapContext(supabase, targetReservationId);
  const swapWindowLabel = `${target.checkin_date} → ${target.checkout_date}`;

  const noteLineForSource = `[Room Swap] Window ${swapWindowLabel} | ${source.room_path_label ?? source.current_room_number ?? "?"} ↔ ${target.room_path_label ?? target.current_room_number ?? "?"} | Swapped with ${target.booking_code} (${target.guest_name})`;
  const noteLineForTarget = `[Room Swap] Window ${swapWindowLabel} | ${target.room_path_label ?? target.current_room_number ?? "?"} ↔ ${source.room_path_label ?? source.current_room_number ?? "?"} | Swapped with ${source.booking_code} (${source.guest_name})`;
  await appendReservationNoteLine(supabase as any, sourceReservationId, noteLineForSource);
  await appendReservationNoteLine(supabase as any, targetReservationId, noteLineForTarget);

  await supabase.from("audit_logs").insert([
    {
      action: "room_swapped",
      entity_type: "reservation",
      entity_id: sourceReservationId,
      before_json: {
        room_id: source.current_room_id,
        room_number: source.current_room_number,
        room_path: source.room_path_label,
        swap_with_reservation_id: targetReservationId,
        swap_with_booking_code: target.booking_code,
        swap_window_checkin: target.checkin_date,
        swap_window_checkout: target.checkout_date,
      },
      after_json: {
        room_id: sourceAfter?.current_room_id ?? null,
        room_number: sourceAfter?.current_room_number ?? null,
        room_path: sourceAfter?.room_path_label ?? null,
        swap_with_reservation_id: targetReservationId,
        swap_with_booking_code: target.booking_code,
      },
      business_date: businessDate,
      source: normalizeAuditSource("manual"),
    },
    {
      action: "room_swapped",
      entity_type: "reservation",
      entity_id: targetReservationId,
      before_json: {
        room_id: target.current_room_id,
        room_number: target.current_room_number,
        room_path: target.room_path_label,
        swap_with_reservation_id: sourceReservationId,
        swap_with_booking_code: source.booking_code,
        swap_window_checkin: target.checkin_date,
        swap_window_checkout: target.checkout_date,
      },
      after_json: {
        room_id: targetAfter?.current_room_id ?? null,
        room_number: targetAfter?.current_room_number ?? null,
        room_path: targetAfter?.room_path_label ?? null,
        swap_with_reservation_id: sourceReservationId,
        swap_with_booking_code: source.booking_code,
      },
      business_date: businessDate,
      source: normalizeAuditSource("manual"),
    },
  ]);

  await syncDynamicRoomLinksForReservation(supabase as any, {
    reservationId: sourceReservationId,
    nextRoomCode: resolveDynamicRoomCode(sourceAfter),
  });
  await syncDynamicRoomLinksForReservation(supabase as any, {
    reservationId: targetReservationId,
    nextRoomCode: resolveDynamicRoomCode(targetAfter),
  });

  return {
    success: true as const,
    source_reservation_id: sourceReservationId,
    target_reservation_id: targetReservationId,
    source_room_before: source.current_room_number,
    target_room_before: target.current_room_number,
    source_room_after: sourceAfter?.current_room_number ?? null,
    target_room_after: targetAfter?.current_room_number ?? null,
  };
}
