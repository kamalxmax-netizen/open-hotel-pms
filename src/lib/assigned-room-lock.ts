import { appendReservationNoteLine } from "@/lib/planned-room-moves";
import { normalizeAuditSource, toBangkokDateString } from "@/lib/audit-utils";

type SupabaseLike = {
  from: (table: string) => any;
};

export type AssignedRoomLockAction =
  | "move_room"
  | "planned_move"
  | "assign"
  | "swap_room"
  | "reservation_update";

export type AssignedRoomLockClearReason =
  | "manual_unlock"
  | "override_move"
  | "override_swap"
  | "override_assign"
  | "override_planned_move"
  | "checkin_auto_release"
  | "stale_override";

export type AssignedRoomLockContext = {
  reservationId: string;
  bookingCode: string | null;
  guestName: string | null;
  status: string | null;
  checkedInAt: string | null;
  currentRoomId: string | null;
  currentRoomNumber: string | null;
  isLocked: boolean;
  reason: string | null;
  roomIdSnapshot: string | null;
  roomNumberSnapshot: string | null;
  setAt: string | null;
  setBy: string | null;
  isStale: boolean;
};

export class AssignedRoomLockError extends Error {
  status: number;
  code: string;

  constructor(message: string, status = 400, code = "ASSIGNED_ROOM_LOCK_ERROR") {
    super(message);
    this.name = "AssignedRoomLockError";
    this.status = status;
    this.code = code;
  }
}

function toActor(actor?: string | null) {
  const normalized = String(actor ?? "").trim();
  return normalized || "FO";
}

function buildAssignedRoomLockNoteLine(params: {
  action: "set" | "unlock" | "override";
  roomNumber: string;
  note: string;
}) {
  const prefix =
    params.action === "set"
      ? "[ASSIGNED ROOM LOCK]"
      : params.action === "unlock"
        ? "[ASSIGNED ROOM UNLOCK]"
        : "[ASSIGNED ROOM OVERRIDE]";
  return `${prefix}[Room ${params.roomNumber}] ${params.note.trim()}`;
}

async function resolveRoomNumberById(supabase: SupabaseLike, roomId?: string | null) {
  if (!roomId) return null;
  const { data, error } = await supabase
    .from("rooms")
    .select("room_number")
    .eq("id", roomId)
    .maybeSingle();
  if (error) {
    throw new AssignedRoomLockError(error.message ?? "Failed to resolve room number.", 500, "ROOM_LOOKUP_FAILED");
  }
  return data?.room_number ? String(data.room_number) : null;
}

async function resolveCurrentAssignedRoom(supabase: SupabaseLike, reservationId: string) {
  const { data, error } = await supabase
    .from("reservation_nights")
    .select("room_id, stay_date")
    .eq("reservation_id", reservationId)
    .is("cancelled_at", null)
    .not("room_id", "is", null)
    .order("stay_date", { ascending: true })
    .limit(1)
    .maybeSingle();

  if (error) {
    throw new AssignedRoomLockError(error.message ?? "Failed to load assigned room.", 500, "ASSIGNED_ROOM_LOOKUP_FAILED");
  }

  const roomId = data?.room_id ? String(data.room_id) : null;
  const roomNumber = await resolveRoomNumberById(supabase, roomId);
  return { roomId, roomNumber };
}

export async function getAssignedRoomLockContext(
  supabase: SupabaseLike,
  reservationId: string
): Promise<AssignedRoomLockContext> {
  const { data, error } = await supabase
    .from("reservations")
    .select(
      "id, booking_code, guest_name, status, checked_in_at, do_not_move_assigned_room, do_not_move_reason, do_not_move_room_id_snapshot, do_not_move_set_at, do_not_move_set_by"
    )
    .eq("id", reservationId)
    .maybeSingle();

  if (error) {
    const message = String(error.message ?? "");
    if (message.toLowerCase().includes("do_not_move_assigned_room")) {
      throw new AssignedRoomLockError(
        "DB migration required: apply 20260312_phase28_assigned_room_lock.sql before using assigned room lock.",
        500,
        "ASSIGNED_ROOM_LOCK_MIGRATION_MISSING"
      );
    }
    throw new AssignedRoomLockError(error.message ?? "Failed to load reservation.", 500, "RESERVATION_LOOKUP_FAILED");
  }
  if (!data) {
    throw new AssignedRoomLockError("Reservation not found.", 404, "RESERVATION_NOT_FOUND");
  }

  const currentAssigned = await resolveCurrentAssignedRoom(supabase, reservationId);
  const roomIdSnapshot = data.do_not_move_room_id_snapshot ? String(data.do_not_move_room_id_snapshot) : null;
  const roomNumberSnapshot = await resolveRoomNumberById(supabase, roomIdSnapshot);
  const isLocked = Boolean(data.do_not_move_assigned_room);
  const isStale = Boolean(isLocked && roomIdSnapshot && currentAssigned.roomId && roomIdSnapshot !== currentAssigned.roomId);

  return {
    reservationId: String(data.id),
    bookingCode: data.booking_code ? String(data.booking_code) : null,
    guestName: data.guest_name ? String(data.guest_name) : null,
    status: data.status ? String(data.status) : null,
    checkedInAt: data.checked_in_at ? String(data.checked_in_at) : null,
    currentRoomId: currentAssigned.roomId,
    currentRoomNumber: currentAssigned.roomNumber,
    isLocked,
    reason: data.do_not_move_reason ? String(data.do_not_move_reason) : null,
    roomIdSnapshot,
    roomNumberSnapshot,
    setAt: data.do_not_move_set_at ? String(data.do_not_move_set_at) : null,
    setBy: data.do_not_move_set_by ? String(data.do_not_move_set_by) : null,
    isStale,
  };
}

export async function setAssignedRoomLock(params: {
  supabase: SupabaseLike;
  reservationId: string;
  reason: string;
  actor?: string | null;
}) {
  const { supabase, reservationId } = params;
  const reason = String(params.reason ?? "").trim();
  const actor = toActor(params.actor);
  if (!reason) {
    throw new AssignedRoomLockError("Lock reason is required.", 400, "LOCK_REASON_REQUIRED");
  }

  const context = await getAssignedRoomLockContext(supabase, reservationId);
  if (context.status !== "active") {
    throw new AssignedRoomLockError("Only active reservations can lock assigned room.", 400, "LOCK_RESERVATION_NOT_ACTIVE");
  }
  if (context.checkedInAt) {
    throw new AssignedRoomLockError("Assigned room lock is only available before check-in.", 409, "LOCK_ALREADY_CHECKED_IN");
  }
  if (!context.currentRoomId || !context.currentRoomNumber) {
    throw new AssignedRoomLockError("Assign a room before enabling Do Not Move.", 409, "LOCK_NO_ASSIGNED_ROOM");
  }

  const payload = {
    do_not_move_assigned_room: true,
    do_not_move_reason: reason,
    do_not_move_room_id_snapshot: context.currentRoomId,
    do_not_move_set_at: new Date().toISOString(),
    do_not_move_set_by: actor,
  };

  const { error } = await supabase.from("reservations").update(payload).eq("id", reservationId);
  if (error) {
    throw new AssignedRoomLockError(error.message ?? "Failed to save assigned room lock.", 500, "LOCK_UPDATE_FAILED");
  }

  await appendReservationNoteLine(
    supabase as any,
    reservationId,
    buildAssignedRoomLockNoteLine({ action: "set", roomNumber: context.currentRoomNumber, note: reason })
  );

  await supabase.from("audit_logs").insert({
    action: "assigned_room_lock_set",
    entity_type: "reservation",
    entity_id: reservationId,
    before_json: {
      do_not_move_assigned_room: context.isLocked,
      room_id_snapshot: context.roomIdSnapshot,
      reason: context.reason,
    },
    after_json: {
      do_not_move_assigned_room: true,
      room_id_snapshot: context.currentRoomId,
      room_number_snapshot: context.currentRoomNumber,
      reason,
      actor,
    },
    business_date: toBangkokDateString(),
    source: normalizeAuditSource("manual"),
  });

  return {
    success: true as const,
    room_id_snapshot: context.currentRoomId,
    room_number_snapshot: context.currentRoomNumber,
    reason,
  };
}

export async function clearAssignedRoomLock(params: {
  supabase: SupabaseLike;
  reservationId: string;
  actor?: string | null;
  reason?: string | null;
  clearReason: AssignedRoomLockClearReason;
  appendNote?: boolean;
}) {
  const { supabase, reservationId, clearReason } = params;
  const actor = toActor(params.actor);
  const reason = String(params.reason ?? "").trim() || null;
  const appendNote = params.appendNote ?? clearReason !== "checkin_auto_release";
  const context = await getAssignedRoomLockContext(supabase, reservationId);

  if (!context.isLocked) {
    return { success: true as const, cleared: false };
  }

  const { error } = await supabase
    .from("reservations")
    .update({
      do_not_move_assigned_room: false,
      do_not_move_reason: null,
      do_not_move_room_id_snapshot: null,
      do_not_move_set_at: null,
      do_not_move_set_by: null,
    })
    .eq("id", reservationId);

  if (error) {
    throw new AssignedRoomLockError(error.message ?? "Failed to clear assigned room lock.", 500, "LOCK_CLEAR_FAILED");
  }

  if (appendNote && context.roomNumberSnapshot) {
    await appendReservationNoteLine(
      supabase as any,
      reservationId,
      buildAssignedRoomLockNoteLine({
        action: clearReason === "manual_unlock" ? "unlock" : "override",
        roomNumber: context.roomNumberSnapshot,
        note: reason || clearReason.replaceAll("_", " "),
      })
    );
  }

  await supabase.from("audit_logs").insert({
    action: "assigned_room_lock_cleared",
    entity_type: "reservation",
    entity_id: reservationId,
    before_json: {
      do_not_move_assigned_room: true,
      room_id_snapshot: context.roomIdSnapshot,
      room_number_snapshot: context.roomNumberSnapshot,
      reason: context.reason,
      set_at: context.setAt,
      set_by: context.setBy,
    },
    after_json: {
      do_not_move_assigned_room: false,
      clear_reason: clearReason,
      actor,
      note: reason,
    },
    business_date: toBangkokDateString(),
    source: normalizeAuditSource("manual"),
  });

  return { success: true as const, cleared: true };
}

export async function assertAssignedRoomUnlockedOrOverride(params: {
  supabase: SupabaseLike;
  reservationId: string;
  action: AssignedRoomLockAction;
  overrideNote?: string | null;
}) {
  const { supabase, reservationId, action } = params;
  const overrideNote = String(params.overrideNote ?? "").trim();
  const context = await getAssignedRoomLockContext(supabase, reservationId);
  if (!context.isLocked) return null;
  if (context.checkedInAt) return null;

  if (!overrideNote) {
    const roomLabel = context.roomNumberSnapshot ? `Room ${context.roomNumberSnapshot}` : "the assigned room";
    throw new AssignedRoomLockError(
      `Assigned room is locked to ${roomLabel}. Reason: ${context.reason || "Do Not Move"}. Provide override note to continue.`,
      409,
      "ASSIGNED_ROOM_LOCKED"
    );
  }

  return context;
}
