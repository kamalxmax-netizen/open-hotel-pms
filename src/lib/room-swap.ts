import { compareDateStrings } from "@/lib/dates";
import {
  appendReservationNoteLine,
  assertNoRoomBlockConflict,
  listOverlappingPlannedRoomHolds,
  listReservationPlannedMoves,
  PlannedRoomMoveError,
  syncReservationNightDependencyMetadata,
} from "@/lib/planned-room-moves";
import { normalizeAuditSource, toBangkokDateString } from "@/lib/audit-utils";
import { syncDynamicRoomLinksForReservation } from "@/lib/logbook-api";

type SupabaseLike = {
  from: (table: string) => any;
};

export type RoomSwapReasonCode =
  | "reservation_not_found"
  | "reservation_not_active"
  | "already_checked_in"
  | "room_not_assigned"
  | "multiple_room_segments"
  | "planned_move_active"
  | "room_type_mismatch"
  | "same_room"
  | "dayuse_room"
  | "target_checkout_exceeds_source"
  | "source_room_conflict"
  | "target_room_conflict";

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
  current_room_is_dayuse: boolean;
  has_multiple_room_segments: boolean;
  has_active_planned_move: boolean;
  do_not_move_assigned_room: boolean;
  do_not_move_reason: string | null;
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
    .select("room_id, room_type_id, stay_date")
    .eq("reservation_id", reservationId)
    .is("cancelled_at", null)
    .order("stay_date", { ascending: true });

  if (nightsError) {
    throw new RoomSwapError(nightsError.message ?? "Failed to load reservation nights.", 500);
  }

  const activeNights = nights ?? [];
  const roomIds: string[] = Array.from(
    new Set(activeNights.map((row: any) => String(row.room_id ?? "")).filter((value: string) => Boolean(value)))
  );
  const roomTypeIds: number[] = Array.from(
    new Set(
      activeNights
        .map((row: any) => Number(row.room_type_id ?? 0))
        .filter((value: number) => Number.isFinite(value) && value > 0)
    )
  );
  const roomsById = await loadRoomsByIds(supabase, roomIds);
  const currentRoom = roomIds[0] ? roomsById.get(roomIds[0]) : null;

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
    current_room_id: roomIds[0] ?? null,
    current_room_number: currentRoom?.room_number ? String(currentRoom.room_number) : null,
    current_room_is_dayuse: Boolean(currentRoom?.is_dayuse),
    has_multiple_room_segments: roomIds.length > 1,
    has_active_planned_move: plannedMoves.length > 0,
    do_not_move_assigned_room: Boolean(reservation.do_not_move_assigned_room),
    do_not_move_reason: reservation.do_not_move_reason ? String(reservation.do_not_move_reason) : null,
  };
}

async function assertRoomAvailableForSwapRange(params: {
  supabase: SupabaseLike;
  roomId: string;
  checkinDate: string;
  checkoutDate: string;
  excludeReservationIds: string[];
}) {
  const { supabase, roomId, checkinDate, checkoutDate, excludeReservationIds } = params;

  let nightsQuery = supabase
    .from("reservation_nights")
    .select("reservation_id, stay_date")
    .eq("room_id", roomId)
    .gte("stay_date", checkinDate)
    .lt("stay_date", checkoutDate)
    .is("cancelled_at", null)
    .limit(1);

  for (const reservationId of excludeReservationIds.filter(Boolean)) {
    nightsQuery = nightsQuery.neq("reservation_id", reservationId);
  }

  const { data: conflictNights, error: conflictNightsError } = await nightsQuery;
  if (conflictNightsError) {
    throw new RoomSwapError(conflictNightsError.message ?? "Failed to check room occupancy.", 500);
  }
  if ((conflictNights ?? []).length > 0) {
    const conflict = conflictNights![0];
    return {
      ok: false,
      reason: `is needed by another reservation on ${String(conflict.stay_date)}.`,
    };
  }

  try {
    await assertNoRoomBlockConflict(supabase as any, { roomId, checkinDate, checkoutDate });
  } catch (error) {
    if (error instanceof PlannedRoomMoveError) {
      return { ok: false, reason: error.message };
    }
    throw error;
  }

  const plannedHolds = await listOverlappingPlannedRoomHolds(supabase as any, {
    roomIds: [roomId],
    checkinDate,
    checkoutDate,
  });
  const blockingHold = plannedHolds.find((row) => !excludeReservationIds.includes(String(row.reservation_id)));
  if (blockingHold) {
    return {
      ok: false,
      reason: `is held by planned move for reservation ${String(blockingHold.reservation_id)} (${blockingHold.start_date} → ${blockingHold.end_date}).`,
    };
  }

  return { ok: true, reason: null } as const;
}

export async function evaluateRoomSwapEligibility(
  supabase: SupabaseLike,
  source: ReservationSwapContext,
  target: ReservationSwapContext
): Promise<{ can_swap: boolean; reason_code: RoomSwapReasonCode | null; reason: string | null }> {
  if (source.status !== "active" || target.status !== "active") {
    return { can_swap: false, reason_code: "reservation_not_active", reason: "Swap unavailable: reservation is not active." };
  }
  if (source.checked_in_at || target.checked_in_at) {
    return { can_swap: false, reason_code: "already_checked_in", reason: "Swap unavailable: target reservation already checked in." };
  }
  if (!source.current_room_id || !target.current_room_id) {
    return { can_swap: false, reason_code: "room_not_assigned", reason: "Swap unavailable: both reservations must already have assigned rooms." };
  }
  if (source.current_room_id === target.current_room_id) {
    return { can_swap: false, reason_code: "same_room", reason: "Swap unavailable: both reservations already use the same room." };
  }
  if (source.has_multiple_room_segments || target.has_multiple_room_segments) {
    return { can_swap: false, reason_code: "multiple_room_segments", reason: "Swap unavailable: reservation has multiple room segments already." };
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
  if (compareDateStrings(target.checkout_date, source.checkout_date) > 0) {
    return {
      can_swap: false,
      reason_code: "target_checkout_exceeds_source",
      reason: `Swap unavailable: Room ${target.current_room_number ?? "?"} is needed after ${source.checkout_date}.`,
    };
  }

  const sourceRoomAvailability = await assertRoomAvailableForSwapRange({
    supabase,
    roomId: source.current_room_id,
    checkinDate: target.checkin_date,
    checkoutDate: target.checkout_date,
    excludeReservationIds: [source.reservation_id, target.reservation_id],
  });
  if (!sourceRoomAvailability.ok) {
    return {
      can_swap: false,
      reason_code: "source_room_conflict",
      reason: `Swap unavailable: Room ${source.current_room_number ?? "?"} ${sourceRoomAvailability.reason}`,
    };
  }

  const targetRoomAvailability = await assertRoomAvailableForSwapRange({
    supabase,
    roomId: target.current_room_id,
    checkinDate: source.checkin_date,
    checkoutDate: source.checkout_date,
    excludeReservationIds: [source.reservation_id, target.reservation_id],
  });
  if (!targetRoomAvailability.ok) {
    return {
      can_swap: false,
      reason_code: "target_room_conflict",
      reason: `Swap unavailable: Room ${target.current_room_number ?? "?"} ${targetRoomAvailability.reason}`,
    };
  }

  return { can_swap: true, reason_code: null, reason: null };
}

export async function listSwapCandidatesForReservation(
  supabase: SupabaseLike,
  reservationId: string
): Promise<SwapCandidate[]> {
  const source = await loadReservationSwapContext(supabase, reservationId);
  if (!source || !source.room_type_id || !source.current_room_id || source.checked_in_at) return [];

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

  // NOTE:
  // reservation_nights has unique index (room_id, stay_date, dayuse_session) for active rows.
  // A direct two-step room update can collide on overlapping dates.
  // We temporarily shift source dayuse_session to avoid transient key collisions during swap.
  const SESSION_SHIFT = 100;
  let sourceSessionShifted = false;
  let sourceMovedToTarget = false;
  let targetMovedToSource = false;

  const shiftSourceSessions = async (delta: number, failureMessage: string) => {
    const { data: rows, error: rowsError } = await supabase
      .from("reservation_nights")
      .select("id, dayuse_session")
      .eq("reservation_id", sourceReservationId)
      .is("cancelled_at", null);

    if (rowsError) {
      throw new RoomSwapError(rowsError.message ?? failureMessage, 500);
    }

    for (const row of rows ?? []) {
      const rowId = String((row as any)?.id ?? "");
      if (!rowId) continue;
      const currentSession = Number((row as any)?.dayuse_session ?? 0);
      const { error: updateError } = await supabase
        .from("reservation_nights")
        .update({ dayuse_session: currentSession + delta })
        .eq("id", rowId);
      if (updateError) {
        throw new RoomSwapError(updateError.message ?? failureMessage, 500);
      }
    }
  };

  await shiftSourceSessions(SESSION_SHIFT, "Failed to prepare reservation for swap.");
  sourceSessionShifted = true;

  try {
    const { error: sourceUpdateError } = await supabase
      .from("reservation_nights")
      .update({
        room_id: target.current_room_id,
        assignment_source: "manual",
        dependency_plan_id: null,
        dependency_reason: null,
      })
      .eq("reservation_id", sourceReservationId)
      .is("cancelled_at", null);

    if (sourceUpdateError) {
      throw new RoomSwapError(sourceUpdateError.message ?? "Failed to update source reservation nights for swap.", 500);
    }
    sourceMovedToTarget = true;

    const { error: targetUpdateError } = await supabase
      .from("reservation_nights")
      .update({
        room_id: source.current_room_id,
        assignment_source: "manual",
        dependency_plan_id: null,
        dependency_reason: null,
      })
      .eq("reservation_id", targetReservationId)
      .is("cancelled_at", null);

    if (targetUpdateError) {
      throw new RoomSwapError(targetUpdateError.message ?? "Failed to update target reservation nights for swap.", 500);
    }
    targetMovedToSource = true;

    await shiftSourceSessions(SESSION_SHIFT * -1, "Swap succeeded but session cleanup failed.");
    sourceSessionShifted = false;
  } catch (error) {
    if (targetMovedToSource) {
      await supabase
        .from("reservation_nights")
        .update({ room_id: target.current_room_id })
        .eq("reservation_id", targetReservationId)
        .is("cancelled_at", null);
    }
    if (sourceMovedToTarget) {
      await supabase
        .from("reservation_nights")
        .update({ room_id: source.current_room_id })
        .eq("reservation_id", sourceReservationId)
        .is("cancelled_at", null);
    }

    if (sourceSessionShifted) {
      try {
        await shiftSourceSessions(SESSION_SHIFT * -1, "Rollback session cleanup failed.");
      } catch {
        // swallow rollback cleanup error; original swap error remains primary
      }
      sourceSessionShifted = false;
    }
    throw error;
  }

  await syncReservationNightDependencyMetadata(supabase as any, { reservationId: sourceReservationId });
  await syncReservationNightDependencyMetadata(supabase as any, { reservationId: targetReservationId });

  const noteLineForSource = `[Room Swap] ${source.current_room_number ?? "?"} ↔ ${target.current_room_number ?? "?"} | Swapped with ${target.booking_code} (${target.guest_name})`;
  const noteLineForTarget = `[Room Swap] ${target.current_room_number ?? "?"} ↔ ${source.current_room_number ?? "?"} | Swapped with ${source.booking_code} (${source.guest_name})`;
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
        swap_with_reservation_id: targetReservationId,
        swap_with_booking_code: target.booking_code,
      },
      after_json: {
        room_id: target.current_room_id,
        room_number: target.current_room_number,
        swap_with_reservation_id: targetReservationId,
        swap_with_booking_code: target.booking_code,
      },
      business_date: toBangkokDateString(),
      source: normalizeAuditSource("manual"),
    },
    {
      action: "room_swapped",
      entity_type: "reservation",
      entity_id: targetReservationId,
      before_json: {
        room_id: target.current_room_id,
        room_number: target.current_room_number,
        swap_with_reservation_id: sourceReservationId,
        swap_with_booking_code: source.booking_code,
      },
      after_json: {
        room_id: source.current_room_id,
        room_number: source.current_room_number,
        swap_with_reservation_id: sourceReservationId,
        swap_with_booking_code: source.booking_code,
      },
      business_date: toBangkokDateString(),
      source: normalizeAuditSource("manual"),
    },
  ]);

  await syncDynamicRoomLinksForReservation(supabase as any, {
    reservationId: sourceReservationId,
    nextRoomCode: target.current_room_number ?? null,
  });
  await syncDynamicRoomLinksForReservation(supabase as any, {
    reservationId: targetReservationId,
    nextRoomCode: source.current_room_number ?? null,
  });

  return {
    success: true as const,
    source_reservation_id: sourceReservationId,
    target_reservation_id: targetReservationId,
    source_room_before: source.current_room_number,
    target_room_before: target.current_room_number,
    source_room_after: target.current_room_number,
    target_room_after: source.current_room_number,
  };
}
