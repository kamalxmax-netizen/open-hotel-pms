import { createServerSupabaseClient } from "@/lib/supabase/server";

const HK_BLOCKED_CHECKIN_STATUSES = new Set(["dirty", "in_progress", "paused"]);

type SupabaseClientLike = ReturnType<typeof createServerSupabaseClient>;

export type MobileCheckinDraftReason = "profile_incomplete" | "room_not_ready";

export type ReservationRoomContext = {
  room_id: string | null;
  room_number: string | null;
};

export type RoomReadinessResult =
  | {
      ok: true;
      room_id: string | null;
      room_number: string | null;
      hk_status: string | null;
      draft_reason: null;
      draft_message: null;
    }
  | {
      ok: false;
      room_id: string | null;
      room_number: string | null;
      hk_status: string;
      draft_reason: "room_not_ready";
      draft_message: string;
    };

function describeHousekeepingStatus(status: string): string {
  switch (status) {
    case "dirty":
      return "Dirty";
    case "in_progress":
      return "Cleaning In Progress";
    case "paused":
      return "Cleaning Paused";
    default:
      return status;
  }
}

export async function resolveReservationRoomContext(
  supabase: SupabaseClientLike,
  reservationId: string,
  stayDate: string
): Promise<ReservationRoomContext> {
  const { data: nightRows, error } = await supabase
    .from("reservation_nights")
    .select("room_id, stay_date, rooms(room_number)")
    .eq("reservation_id", reservationId)
    .is("cancelled_at", null)
    .lte("stay_date", stayDate)
    .order("stay_date", { ascending: false })
    .limit(5);

  if (error) {
    throw new Error(error.message || "Failed to resolve room assignment.");
  }

  const exactMatch =
    (nightRows ?? []).find((row: any) => String(row?.stay_date ?? "") === stayDate) ?? (nightRows ?? [])[0];
  const roomRef = Array.isArray((exactMatch as any)?.rooms) ? (exactMatch as any)?.rooms[0] : (exactMatch as any)?.rooms;

  return {
    room_id: exactMatch?.room_id ? String(exactMatch.room_id) : null,
    room_number: roomRef?.room_number ? String(roomRef.room_number) : null,
  };
}

export async function ensureReservationRoomReadyForMobileCheckin(
  supabase: SupabaseClientLike,
  reservationId: string,
  stayDate: string,
  options?: { autoApproveCleaned?: boolean }
): Promise<RoomReadinessResult> {
  const autoApproveCleaned = options?.autoApproveCleaned ?? true;
  const roomContext = await resolveReservationRoomContext(supabase, reservationId, stayDate);
  if (!roomContext.room_id) {
    return {
      ok: true,
      room_id: null,
      room_number: roomContext.room_number,
      hk_status: null,
      draft_reason: null,
      draft_message: null,
    };
  }

  const { data: hkTask, error: hkTaskError } = await supabase
    .from("housekeeping_tasks")
    .select("id, status")
    .eq("room_id", roomContext.room_id)
    .eq("stay_date", stayDate)
    .order("task_seq", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (hkTaskError && hkTaskError.code !== "PGRST116") {
    throw new Error(hkTaskError.message || "Failed to read housekeeping status.");
  }

  if (!hkTask) {
    return {
      ok: true,
      room_id: roomContext.room_id,
      room_number: roomContext.room_number,
      hk_status: null,
      draft_reason: null,
      draft_message: null,
    };
  }

  const hkStatus = String(hkTask.status ?? "").trim();
  if (HK_BLOCKED_CHECKIN_STATUSES.has(hkStatus)) {
    const roomLabel = roomContext.room_number ? `Room ${roomContext.room_number}` : "This room";
    const hkLabel = describeHousekeepingStatus(hkStatus);
    return {
      ok: false,
      room_id: roomContext.room_id,
      room_number: roomContext.room_number,
      hk_status: hkStatus,
      draft_reason: "room_not_ready",
      draft_message: `${roomLabel} is still ${hkLabel}. Save Draft first, then complete check-in after housekeeping approval.`,
    };
  }

  if (hkStatus === "cleaned" && autoApproveCleaned) {
    const approvedAt = new Date().toISOString();
    const { error: approveError } = await supabase
      .from("housekeeping_tasks")
      .update({
        status: "approved",
        approved_at: approvedAt,
      })
      .eq("id", hkTask.id);

    if (approveError) {
      throw new Error(approveError.message || "Failed to auto-approve cleaned room.");
    }

    await supabase.from("housekeeping_logs").insert({
      task_id: hkTask.id,
      status: "approved",
      note: "auto-approved at mobile check-in",
    });

    return {
      ok: true,
      room_id: roomContext.room_id,
      room_number: roomContext.room_number,
      hk_status: "approved",
      draft_reason: null,
      draft_message: null,
    };
  }

  return {
    ok: true,
    room_id: roomContext.room_id,
    room_number: roomContext.room_number,
    hk_status: hkStatus === "cleaned" && autoApproveCleaned ? "approved" : hkStatus || null,
    draft_reason: null,
    draft_message: null,
  };
}
