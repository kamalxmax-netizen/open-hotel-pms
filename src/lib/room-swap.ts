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
  reservation_id: string;
  stay_date: string;
  room_id: string;
  room_number: string | null;
  room_type_id: number | null;
  room_is_dayuse: boolean;
  dayuse_session: number;
};

export type ReservationSwapContext = {
  reservation_id: string;
  parent_reservation_id: string | null;
  root_reservation_id: string;
  primary_reservation_id: string;
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
  member_reservation_ids: string[];
  member_count: number;
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
  member_count: number;
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

type SingleReservationSwapContext = ReservationSwapContext;

async function loadSingleReservationSwapContext(
  supabase: SupabaseLike,
  reservationId: string
): Promise<SingleReservationSwapContext | null> {
  const { data: reservation, error: reservationError } = await supabase
    .from("reservations")
    .select("id, parent_reservation_id, booking_code, guest_name, checkin_date, checkout_date, status, checked_in_at, do_not_move_assigned_room, do_not_move_reason")
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
        reservation_id: String(reservation.id),
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
    parent_reservation_id: reservation.parent_reservation_id ? String(reservation.parent_reservation_id) : null,
    root_reservation_id: reservation.parent_reservation_id ? String(reservation.parent_reservation_id) : String(reservation.id),
    primary_reservation_id: String(reservation.id),
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
    member_reservation_ids: [String(reservation.id)],
    member_count: 1,
  };
}

function dedupeStringList(values: Array<string | null | undefined>): string[] {
  return Array.from(new Set(values.map((value) => String(value ?? "").trim()).filter(Boolean)));
}

function mergeReservationSwapContexts(
  anchor: ReservationSwapContext,
  contexts: ReservationSwapContext[]
): ReservationSwapContext {
  const activeNights = Array.from(
    new Map(
      contexts
        .flatMap((context) => context.active_nights)
        .map((night) => [night.id, night])
    ).values()
  ).sort((left, right) => {
    const dateCmp = left.stay_date.localeCompare(right.stay_date);
    if (dateCmp !== 0) return dateCmp;
    return left.reservation_id.localeCompare(right.reservation_id);
  });

  const uniqueRoomIds = Array.from(new Set(activeNights.map((night) => night.room_id)));
  const roomTypeIds = Array.from(
    new Set(activeNights.map((night) => Number(night.room_type_id ?? 0)).filter((value) => Number.isFinite(value) && value > 0))
  );
  const memberReservationIds = dedupeStringList(contexts.flatMap((context) => context.member_reservation_ids));
  const firstCheckedInAt = contexts.map((context) => context.checked_in_at).find(Boolean) ?? null;
  const firstLockReason = contexts.map((context) => context.do_not_move_reason).find(Boolean) ?? null;
  const sortedByCheckin = [...contexts].sort((left, right) => {
    const checkinCmp = left.checkin_date.localeCompare(right.checkin_date);
    if (checkinCmp !== 0) return checkinCmp;
    return left.primary_reservation_id.localeCompare(right.primary_reservation_id);
  });
  const roomPathLabel = buildRoomPathLabel(activeNights);

  return {
    reservation_id: anchor.reservation_id,
    parent_reservation_id: anchor.parent_reservation_id,
    root_reservation_id: anchor.root_reservation_id,
    primary_reservation_id: anchor.primary_reservation_id,
    booking_code: anchor.booking_code,
    guest_name: anchor.guest_name,
    checkin_date: sortedByCheckin[0]?.checkin_date ?? anchor.checkin_date,
    checkout_date: sortedByCheckin.sort((left, right) => right.checkout_date.localeCompare(left.checkout_date))[0]?.checkout_date ?? anchor.checkout_date,
    status: contexts.every((context) => context.status === "active") ? "active" : anchor.status,
    checked_in_at: firstCheckedInAt,
    room_type_id: roomTypeIds.length === 1 ? roomTypeIds[0] : null,
    room_type_name: anchor.room_type_name,
    current_room_id: activeNights[0]?.room_id ?? anchor.current_room_id,
    current_room_number: roomPathLabel ?? anchor.current_room_number,
    room_path_label: roomPathLabel,
    current_room_is_dayuse: contexts.some((context) => context.current_room_is_dayuse),
    has_multiple_room_segments: uniqueRoomIds.length > 1,
    has_active_planned_move: contexts.some((context) => context.has_active_planned_move),
    do_not_move_assigned_room: contexts.some((context) => context.do_not_move_assigned_room),
    do_not_move_reason: firstLockReason,
    active_nights: activeNights,
    member_reservation_ids: memberReservationIds,
    member_count: memberReservationIds.length,
  };
}

async function expandTargetSwapContextForSourceWindow(
  supabase: SupabaseLike,
  source: ReservationSwapContext,
  anchor: ReservationSwapContext
): Promise<ReservationSwapContext> {
  const anchorNightByDate = buildNightMap(anchor.active_nights);
  const anchorUniqueRoomIds = Array.from(new Set(anchor.active_nights.map((night) => night.room_id)));
  const fallbackRoomId = anchorUniqueRoomIds.length === 1 ? anchorUniqueRoomIds[0] : null;
  const desiredTargetRoomByDate = new Map<string, string>();

  for (const sourceNight of source.active_nights) {
    const explicitTargetNight = anchorNightByDate.get(sourceNight.stay_date);
    const desiredRoomId = explicitTargetNight?.room_id ?? fallbackRoomId;
    if (desiredRoomId) {
      desiredTargetRoomByDate.set(sourceNight.stay_date, desiredRoomId);
    }
  }

  const targetRoomIds = dedupeStringList(Array.from(desiredTargetRoomByDate.values()));
  if (targetRoomIds.length === 0) {
    return anchor;
  }

  const sourceReservationIds = new Set(source.member_reservation_ids);
  const { data: blockerNights, error: blockerNightsError } = await supabase
    .from("reservation_nights")
    .select("reservation_id, room_id, stay_date")
    .in("room_id", targetRoomIds)
    .in("stay_date", Array.from(desiredTargetRoomByDate.keys()))
    .is("cancelled_at", null);

  if (blockerNightsError) {
    throw new RoomSwapError(blockerNightsError.message ?? "Failed to load swap blockers.", 500);
  }

  const blockerReservationIds = dedupeStringList(
    (blockerNights ?? [])
      .filter((row: any) => {
        const reservationId = String(row?.reservation_id ?? "");
        const stayDate = String(row?.stay_date ?? "");
        const roomId = String(row?.room_id ?? "");
        return !sourceReservationIds.has(reservationId) && desiredTargetRoomByDate.get(stayDate) === roomId;
      })
      .map((row: any) => String(row?.reservation_id ?? ""))
  );

  if (blockerReservationIds.length === 0) {
    return anchor;
  }

  const blockerContexts = await Promise.all(blockerReservationIds.map((reservationId) => loadReservationSwapContext(supabase, reservationId)));
  const mergedContexts = [
    anchor,
    ...blockerContexts.filter((context): context is ReservationSwapContext => Boolean(context)),
  ];

  return mergeReservationSwapContexts(anchor, mergedContexts);
}

export async function loadReservationSwapContext(
  supabase: SupabaseLike,
  reservationId: string
): Promise<ReservationSwapContext | null> {
  const anchor = await loadSingleReservationSwapContext(supabase, reservationId);
  if (!anchor) return null;

  const rootReservationId = anchor.root_reservation_id;
  const { data: linkedRows, error: linkedError } = await supabase
    .from("reservations")
    .select("id")
    .or(`id.eq.${rootReservationId},parent_reservation_id.eq.${rootReservationId}`);

  if (linkedError) {
    throw new RoomSwapError(linkedError.message ?? "Failed to load linked reservations.", 500);
  }

  const linkedIds = dedupeStringList((linkedRows ?? []).map((row: any) => String(row.id ?? "")));
  if (linkedIds.length <= 1) {
    return anchor;
  }

  const memberContextsRaw = await Promise.all(linkedIds.map((id) => loadSingleReservationSwapContext(supabase, id)));
  const movableMembers = memberContextsRaw
    .filter((context): context is SingleReservationSwapContext => Boolean(context))
    .filter((context) => context.status === "active");

  const memberContexts = movableMembers.length > 0 ? movableMembers : [anchor];
  if (memberContexts.length === 1) {
    return {
      ...memberContexts[0],
      root_reservation_id: rootReservationId,
    };
  }

  const sortedMembers = [...memberContexts].sort((left, right) => {
    const checkinCmp = left.checkin_date.localeCompare(right.checkin_date);
    if (checkinCmp !== 0) return checkinCmp;
    return left.reservation_id.localeCompare(right.reservation_id);
  });
  const primaryMember = sortedMembers.find((member) => member.reservation_id === anchor.reservation_id) ?? sortedMembers[0];
  const activeNights = [...sortedMembers.flatMap((member) => member.active_nights)].sort((left, right) => {
    const dateCmp = left.stay_date.localeCompare(right.stay_date);
    if (dateCmp !== 0) return dateCmp;
    return left.reservation_id.localeCompare(right.reservation_id);
  });
  const roomPathLabel = buildRoomPathLabel(activeNights);
  const uniqueRoomIds = Array.from(new Set(activeNights.map((night) => night.room_id)));
  const uniqueRoomTypeIds = Array.from(
    new Set(activeNights.map((night) => Number(night.room_type_id ?? 0)).filter((value) => Number.isFinite(value) && value > 0))
  );
  const memberReservationIds = sortedMembers.map((member) => member.reservation_id);
  const firstLockReason = sortedMembers.find((member) => member.do_not_move_reason)?.do_not_move_reason ?? null;

  return {
    reservation_id: anchor.reservation_id,
    parent_reservation_id: anchor.parent_reservation_id,
    root_reservation_id: rootReservationId,
    primary_reservation_id: primaryMember.reservation_id,
    booking_code: primaryMember.booking_code,
    guest_name: primaryMember.guest_name,
    checkin_date: sortedMembers[0]?.checkin_date ?? anchor.checkin_date,
    checkout_date: sortedMembers[sortedMembers.length - 1]?.checkout_date ?? anchor.checkout_date,
    status: "active",
    checked_in_at: null,
    room_type_id: uniqueRoomTypeIds.length === 1 ? uniqueRoomTypeIds[0] : null,
    room_type_name: primaryMember.room_type_name,
    current_room_id: activeNights[0]?.room_id ?? null,
    current_room_number: roomPathLabel ?? primaryMember.current_room_number,
    room_path_label: roomPathLabel,
    current_room_is_dayuse: activeNights.some((night) => night.room_is_dayuse),
    has_multiple_room_segments: uniqueRoomIds.length > 1,
    has_active_planned_move: sortedMembers.some((member) => member.has_active_planned_move),
    do_not_move_assigned_room: sortedMembers.some((member) => member.do_not_move_assigned_room),
    do_not_move_reason: firstLockReason,
    active_nights: activeNights,
    member_reservation_ids: memberReservationIds,
    member_count: memberReservationIds.length,
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

async function listCandidateSwapAnchorReservationIds(
  supabase: SupabaseLike,
  source: ReservationSwapContext
): Promise<string[]> {
  if (!source.room_type_id || source.active_nights.length === 0) return [];

  const sourceStayDates = dedupeStringList(source.active_nights.map((night) => night.stay_date));
  if (sourceStayDates.length === 0) return [];

  const sourceMemberIds = new Set(source.member_reservation_ids);
  sourceMemberIds.add(source.root_reservation_id);

  const { data: candidateNightRows, error: candidateNightRowsError } = await supabase
    .from("reservation_nights")
    .select("reservation_id")
    .eq("room_type_id", source.room_type_id)
    .in("stay_date", sourceStayDates)
    .is("cancelled_at", null);

  if (candidateNightRowsError) {
    throw new RoomSwapError(candidateNightRowsError.message ?? "Failed to load swap candidates.", 500);
  }

  const candidateReservationIds = dedupeStringList(
    (candidateNightRows ?? [])
      .map((row: any) => String(row?.reservation_id ?? ""))
      .filter((reservationId: string) => !sourceMemberIds.has(reservationId))
  );

  if (candidateReservationIds.length === 0) return [];

  const { data: candidateReservations, error: candidateReservationsError } = await supabase
    .from("reservations")
    .select("id, parent_reservation_id, checkin_date, checkout_date, status, checked_in_at")
    .in("id", candidateReservationIds)
    .eq("status", "active")
    .is("checked_in_at", null)
    .gte("checkin_date", source.checkin_date)
    .lte("checkout_date", source.checkout_date)
    .order("checkin_date", { ascending: true })
    .order("id", { ascending: true });

  if (candidateReservationsError) {
    throw new RoomSwapError(candidateReservationsError.message ?? "Failed to load swap candidates.", 500);
  }

  const representativeReservationIdByRoot = new Map<string, string>();
  for (const row of candidateReservations ?? []) {
    const reservationId = String(row?.id ?? "").trim();
    if (!reservationId || sourceMemberIds.has(reservationId)) continue;
    const rootReservationId = String(row?.parent_reservation_id ?? reservationId).trim() || reservationId;
    if (sourceMemberIds.has(rootReservationId)) continue;
    if (!representativeReservationIdByRoot.has(rootReservationId)) {
      representativeReservationIdByRoot.set(rootReservationId, reservationId);
    }
  }

  return Array.from(representativeReservationIdByRoot.values());
}

export async function listSwapCandidatesForReservation(
  supabase: SupabaseLike,
  reservationId: string,
  sourceOverride?: ReservationSwapContext | null
): Promise<SwapCandidate[]> {
  const source = sourceOverride ?? (await loadReservationSwapContext(supabase, reservationId));
  if (!source || !source.room_type_id || source.active_nights.length === 0 || source.checked_in_at) return [];
  const candidateReservationIds = await listCandidateSwapAnchorReservationIds(supabase, source);
  if (candidateReservationIds.length === 0) return [];

  const contexts = await Promise.all(
    candidateReservationIds.map((candidateReservationId) => loadReservationSwapContext(supabase, candidateReservationId))
  );
  const seenCandidateKeys = new Set<string>();

  const results: SwapCandidate[] = [];
  for (const context of contexts) {
    if (!context || context.checked_in_at) continue;
    const expandedContext = await expandTargetSwapContextForSourceWindow(supabase, source, context);
    const candidateKey = dedupeStringList(expandedContext.member_reservation_ids).sort().join("|");
    if (seenCandidateKeys.has(candidateKey)) continue;
    seenCandidateKeys.add(candidateKey);

    const evaluation = await evaluateRoomSwapEligibility(supabase, source, expandedContext);
    results.push({
      reservation_id: context.primary_reservation_id,
      booking_code: expandedContext.booking_code,
      guest_name: expandedContext.guest_name,
      room_id: expandedContext.current_room_id,
      room_number: expandedContext.current_room_number,
      checkin_date: expandedContext.checkin_date,
      checkout_date: expandedContext.checkout_date,
      nights: roomStayNights(expandedContext.checkin_date, expandedContext.checkout_date),
      can_swap: evaluation.can_swap,
      reason_code: evaluation.reason_code,
      reason: evaluation.reason,
      do_not_move_assigned_room: expandedContext.do_not_move_assigned_room,
      do_not_move_reason: expandedContext.do_not_move_reason,
      member_count: expandedContext.member_count,
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

type SourceMoveNightPair = {
  stay_date: string;
  source_night: ReservationSwapNight;
  target_room_id: string;
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

function buildDesiredTargetRoomByDate(
  source: ReservationSwapContext,
  target: ReservationSwapContext
): Map<string, string> {
  const targetNightByDate = buildNightMap(target.active_nights);
  const targetUniqueRoomIds = Array.from(new Set(target.active_nights.map((night) => night.room_id)));
  const fallbackRoomId = targetUniqueRoomIds.length === 1 ? targetUniqueRoomIds[0] : null;
  const desiredTargetRoomByDate = new Map<string, string>();

  for (const sourceNight of source.active_nights) {
    const targetNight = targetNightByDate.get(sourceNight.stay_date);
    const desiredRoomId = targetNight?.room_id ?? fallbackRoomId;
    if (!desiredRoomId) {
      throw new RoomSwapError(
        `Swap unavailable: ${target.booking_code} does not define a target room for ${sourceNight.stay_date}.`,
        409,
        "target_room_conflict"
      );
    }
    desiredTargetRoomByDate.set(sourceNight.stay_date, desiredRoomId);
  }

  return desiredTargetRoomByDate;
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
  const anchorTarget = await loadReservationSwapContext(supabase, targetReservationId);
  const target = source && anchorTarget
    ? await expandTargetSwapContextForSourceWindow(supabase, source, anchorTarget)
    : anchorTarget;

  if (!source || !target) {
    throw new RoomSwapError("Swap unavailable: reservation not found.", 404, "reservation_not_found");
  }

  const evaluation = await evaluateRoomSwapEligibility(supabase, source, target);
  if (!evaluation.can_swap) {
    throw new RoomSwapError(evaluation.reason ?? "Swap unavailable.", 409, evaluation.reason_code);
  }

  const desiredTargetRoomByDate = buildDesiredTargetRoomByDate(source, target);
  const sourceMovePairs: SourceMoveNightPair[] = source.active_nights.map((sourceNight) => {
    const targetRoomId = desiredTargetRoomByDate.get(sourceNight.stay_date);
    if (!targetRoomId) {
      throw new RoomSwapError(
        `Swap unavailable: target room is missing for ${sourceNight.stay_date}.`,
        409,
        "target_room_conflict"
      );
    }
    return {
      stay_date: sourceNight.stay_date,
      source_night: sourceNight,
      target_room_id: targetRoomId,
    } satisfies SourceMoveNightPair;
  });
  const swapPairs = buildSwapWindowNightPairs(source, target);
  if (sourceMovePairs.length === 0) {
    throw new RoomSwapError("Swap unavailable: no assigned nights found in the source stay.", 409, "room_not_assigned");
  }

  // NOTE:
  // reservation_nights has unique index (room_id, stay_date, dayuse_session) for active rows.
  // A direct two-step room update can collide on overlapping dates.
  // We temporarily shift source dayuse_session to avoid transient key collisions during swap.
  const SESSION_SHIFT = 100;
  const sourceShiftNights = sourceMovePairs.map((pair) => pair.source_night);
  const targetShiftNights = swapPairs.map((pair) => pair.target_night);
  let sourceSessionShifted = false;
  const updatedSourceNightIds = new Set<string>();
  const updatedTargetNightIds = new Set<string>();

  await shiftNightSessions(supabase, sourceShiftNights, SESSION_SHIFT, "Failed to prepare reservation for swap.");
  sourceSessionShifted = true;

  try {
    for (const pair of sourceMovePairs) {
      await updateNightRoom(
        supabase,
        pair.source_night.id,
        pair.target_room_id,
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
  const swapWindowLabel = `${source.checkin_date} → ${source.checkout_date}`;
  const sourceMemberIds = dedupeStringList(source.member_reservation_ids);
  const targetMemberIds = dedupeStringList(target.member_reservation_ids);

  const noteLineForSource = `[Room Swap] Window ${swapWindowLabel} | ${source.room_path_label ?? source.current_room_number ?? "?"} ↔ ${target.room_path_label ?? target.current_room_number ?? "?"} | Swapped with ${target.booking_code} (${target.guest_name})${target.member_count > 1 ? ` · ${target.member_count} linked segments` : ""}`;
  const noteLineForTarget = `[Room Swap] Window ${swapWindowLabel} | ${target.room_path_label ?? target.current_room_number ?? "?"} ↔ ${source.room_path_label ?? source.current_room_number ?? "?"} | Swapped with ${source.booking_code} (${source.guest_name})${source.member_count > 1 ? ` · ${source.member_count} linked segments` : ""}`;
  await Promise.all([
    ...sourceMemberIds.map((memberId) => appendReservationNoteLine(supabase as any, memberId, noteLineForSource)),
    ...targetMemberIds.map((memberId) => appendReservationNoteLine(supabase as any, memberId, noteLineForTarget)),
  ]);

  const auditRows = [
    ...sourceMemberIds.map((memberId) => ({
      action: "room_swapped",
      entity_type: "reservation",
      entity_id: memberId,
      before_json: {
        room_id: source.current_room_id,
        room_number: source.current_room_number,
        room_path: source.room_path_label,
        swap_with_reservation_id: target.primary_reservation_id,
        swap_with_booking_code: target.booking_code,
        swap_window_checkin: target.checkin_date,
        swap_window_checkout: target.checkout_date,
        linked_segments: source.member_count,
      },
      after_json: {
        room_id: sourceAfter?.current_room_id ?? null,
        room_number: sourceAfter?.current_room_number ?? null,
        room_path: sourceAfter?.room_path_label ?? null,
        swap_with_reservation_id: target.primary_reservation_id,
        swap_with_booking_code: target.booking_code,
      },
      business_date: businessDate,
      source: normalizeAuditSource("manual"),
    })),
    ...targetMemberIds.map((memberId) => ({
      action: "room_swapped",
      entity_type: "reservation",
      entity_id: memberId,
      before_json: {
        room_id: target.current_room_id,
        room_number: target.current_room_number,
        room_path: target.room_path_label,
        swap_with_reservation_id: source.primary_reservation_id,
        swap_with_booking_code: source.booking_code,
        swap_window_checkin: target.checkin_date,
        swap_window_checkout: target.checkout_date,
        linked_segments: target.member_count,
      },
      after_json: {
        room_id: targetAfter?.current_room_id ?? null,
        room_number: targetAfter?.current_room_number ?? null,
        room_path: targetAfter?.room_path_label ?? null,
        swap_with_reservation_id: source.primary_reservation_id,
        swap_with_booking_code: source.booking_code,
      },
      business_date: businessDate,
      source: normalizeAuditSource("manual"),
    })),
  ];
  if (auditRows.length > 0) {
    await supabase.from("audit_logs").insert(auditRows);
  }

  await Promise.all(
    [...sourceMemberIds, ...targetMemberIds].map(async (memberId) => {
      const memberAfter = await loadSingleReservationSwapContext(supabase, memberId);
      await syncDynamicRoomLinksForReservation(supabase as any, {
        reservationId: memberId,
        nextRoomCode: resolveDynamicRoomCode(memberAfter),
      });
    })
  );

  return {
    success: true as const,
    source_reservation_id: source.primary_reservation_id,
    target_reservation_id: target.primary_reservation_id,
    source_room_before: source.current_room_number,
    target_room_before: target.current_room_number,
    source_room_after: sourceAfter?.current_room_number ?? null,
    target_room_after: targetAfter?.current_room_number ?? null,
    source_member_count: source.member_count,
    target_member_count: target.member_count,
  };
}
