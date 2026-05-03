import { getUserRole } from "@/lib/server-auth";
import { resolveBusinessDate, toLocalDate } from "@/lib/folio-fees";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { syncStaffFromProfiles } from "@/lib/staff-sync";

type SupabaseServerClient = ReturnType<typeof createServerSupabaseClient>;

export const LOGBOOK_NOTE_TYPES = ["general", "task", "urgent", "stock", "vip"] as const;
export const LOGBOOK_STATUSES = ["open", "in_progress", "resolved"] as const;
export const LOGBOOK_PRIORITIES = ["low", "normal", "high", "urgent"] as const;
export const LOGBOOK_LINK_TYPES = ["room", "guest", "stock", "staff"] as const;
export const LOGBOOK_MENTION_TYPES = ["staff", "group_all", "group_frontdesk"] as const;
export const LOGBOOK_BOARD_MODES = ["minimized", "middle"] as const;
export const LOGBOOK_TEXT_SIZES = ["s", "m", "l"] as const;

export type LogbookNoteTypeValue = (typeof LOGBOOK_NOTE_TYPES)[number];
export type LogbookStatusValue = (typeof LOGBOOK_STATUSES)[number];
export type LogbookPriorityValue = (typeof LOGBOOK_PRIORITIES)[number];
export type LogbookLinkTypeValue = (typeof LOGBOOK_LINK_TYPES)[number];
export type LogbookMentionTypeValue = (typeof LOGBOOK_MENTION_TYPES)[number];
export type LogbookBoardModeValue = (typeof LOGBOOK_BOARD_MODES)[number];

export class HttpError extends Error {
  status: number;

  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

function coerceNonEmptyString(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function buildGuestName(row: { first_name: string | null; last_name: string | null }): string {
  const first = coerceNonEmptyString(row.first_name);
  const last = coerceNonEmptyString(row.last_name);
  const full = [first, last].filter(Boolean).join(" ").trim();
  return full.length > 0 ? full : "Guest";
}

export function stripHtmlToPlainText(value: string): string {
  return String(value ?? "")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/p>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

export function buildRichBody(input: {
  body?: string | null;
  body_rich?: unknown;
}): {
  body: string;
  body_rich: {
    html: string;
    styles: {
      bold: boolean;
      color: string;
      size: "s" | "m" | "l";
    };
  } | null;
} {
  const hasBody = input.body !== undefined && input.body !== null;
  const body = String(input.body ?? "");
  const bodyRichRaw =
    input.body_rich && typeof input.body_rich === "object"
      ? (input.body_rich as Record<string, unknown>)
      : null;

  if (!bodyRichRaw) {
    return { body, body_rich: null };
  }

  const stylesRaw =
    bodyRichRaw.styles && typeof bodyRichRaw.styles === "object"
      ? (bodyRichRaw.styles as Record<string, unknown>)
      : {};
  const html =
    typeof bodyRichRaw.html === "string" && bodyRichRaw.html.trim().length > 0
      ? bodyRichRaw.html
      : body.replace(/\n/g, "<br>");

  const normalized = {
    html,
    styles: {
      bold: Boolean(stylesRaw.bold),
      color:
        typeof stylesRaw.color === "string" && stylesRaw.color.trim().length > 0
          ? stylesRaw.color
          : "#334155",
      size: (stylesRaw.size === "s" || stylesRaw.size === "l" ? stylesRaw.size : "m") as "s" | "m" | "l",
    },
  };

  return {
    body: hasBody ? body : stripHtmlToPlainText(normalized.html),
    body_rich: normalized,
  };
}

export async function getNextLogbookZIndex(supabase: SupabaseServerClient): Promise<number> {
  const { data, error } = await supabase
    .from("logbook_notes")
    .select("z_index")
    .order("z_index", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) throw new HttpError(500, error.message);
  const max = data?.z_index === null || data?.z_index === undefined ? 0 : Number(data.z_index);
  if (!Number.isFinite(max) || max < 0) return 1;
  return max + 1;
}

export async function assertCanManageLogbookNote(
  supabase: SupabaseServerClient,
  userId: string | null | undefined,
  noteId: string
): Promise<{ id: string; created_by: string }> {
  const { data, error } = await supabase
    .from("logbook_notes")
    .select("id, created_by")
    .eq("id", noteId)
    .maybeSingle();

  if (error) throw new HttpError(500, error.message);
  if (!data) throw new HttpError(404, "Logbook note not found.");

  const createdBy = String(data.created_by);
  // Legacy PMS mode: if auth is not wired yet, allow note management.
  if (!userId) {
    return { id: String(data.id), created_by: createdBy };
  }

  if (createdBy === userId) {
    return { id: String(data.id), created_by: createdBy };
  }

  const role = await getUserRole(supabase, userId);
  if (role === "admin" || role === "supervisor") {
    return { id: String(data.id), created_by: createdBy };
  }

  throw new HttpError(403, "Forbidden");
}

export async function resolveLogbookActorStaffId(
  supabase: SupabaseServerClient,
  userId: string | null | undefined
): Promise<string> {
  const preferred = coerceNonEmptyString(userId);
  if (preferred) {
    const { data: preferredStaff, error: preferredError } = await supabase
      .from("staff")
      .select("id")
      .eq("id", preferred)
      .maybeSingle();
    if (preferredError) throw new HttpError(500, preferredError.message);
    if (preferredStaff?.id) return String(preferredStaff.id);
  }

  // Keep staff table in sync for auth-linked users, then fallback to first staff row.
  try {
    await syncStaffFromProfiles(supabase);
  } catch (err) {
    console.error("resolveLogbookActorStaffId syncStaffFromProfiles failed", err);
  }

  let firstQuery = await supabase
    .from("staff")
    .select("id")
    .eq("is_active", true)
    .order("display_name", { ascending: true })
    .limit(1)
    .maybeSingle();

  if (firstQuery.error) {
    const lower = String(firstQuery.error.message ?? "").toLowerCase();
    if (!lower.includes("is_active")) {
      throw new HttpError(500, firstQuery.error.message);
    }
    firstQuery = await supabase
      .from("staff")
      .select("id")
      .order("display_name", { ascending: true })
      .limit(1)
      .maybeSingle();
    if (firstQuery.error) throw new HttpError(500, firstQuery.error.message);
  }

  const fallbackId = coerceNonEmptyString(firstQuery.data?.id);
  if (!fallbackId) {
    throw new HttpError(
      400,
      "No staff found. Please create at least 1 staff in Team & Shifts before using Logbook."
    );
  }
  return fallbackId;
}

export type LogbookLinkInput = {
  link_type: LogbookLinkTypeValue;
  ref_id?: string | null;
  ref_code?: string | null;
  room_link_mode?: "static" | "dynamic" | null;
  label?: string | null;
};

async function resolveLogbookBusinessDate(supabase: SupabaseServerClient): Promise<string> {
  return resolveBusinessDate(supabase, toLocalDate(new Date(), "Asia/Bangkok"));
}

export async function resolveRoomLinkMode(
  supabase: SupabaseServerClient,
  roomCodeRaw: string
): Promise<"static" | "dynamic"> {
  const roomCode = coerceNonEmptyString(roomCodeRaw);
  if (!roomCode) {
    throw new HttpError(400, "room link requires ref_code (room number).");
  }

  const today = await resolveLogbookBusinessDate(supabase);

  const { data: roomRow, error: roomError } = await supabase
    .from("rooms")
    .select("id")
    .eq("room_number", roomCode)
    .maybeSingle();

  if (roomError) throw new HttpError(500, roomError.message);
  if (!roomRow?.id) return "static";

  const roomId = String(roomRow.id);
  const [{ data: stayRows, error: stayError }, { data: departureRows, error: departureError }] = await Promise.all([
    supabase
      .from("reservation_nights")
      .select("reservation_id, reservations!reservation_nights_reservation_id_fkey(id, status, checkin_date)")
      .eq("room_id", roomId)
      .eq("stay_date", today)
      .is("cancelled_at", null),
    supabase
      .from("reservations")
      .select("id, reservation_nights(room_id, stay_date, cancelled_at)")
      .eq("status", "active")
      .eq("checkout_date", today),
  ]);

  if (stayError) throw new HttpError(500, stayError.message);
  if (departureError) throw new HttpError(500, departureError.message);

  const activeStayRows = (stayRows ?? []).filter((row: any) => {
    const reservationRef = Array.isArray(row?.reservations) ? row.reservations[0] : row?.reservations;
    return reservationRef?.status === "active";
  });

  const hasOccupiedStay = activeStayRows.length > 0;
  const hasArrivalTodayPending = activeStayRows.some((row: any) => {
    const reservationRef = Array.isArray(row?.reservations) ? row.reservations[0] : row?.reservations;
    return String(reservationRef?.checkin_date ?? "") === today;
  });

  const hasDepartureToday = (departureRows ?? []).some((row: any) => {
    const nights = Array.isArray(row?.reservation_nights)
      ? row.reservation_nights
      : row?.reservation_nights
        ? [row.reservation_nights]
        : [];
    return nights.some((night: any) => !night?.cancelled_at && String(night?.room_id ?? "") === roomId);
  });

  return hasOccupiedStay || hasArrivalTodayPending || hasDepartureToday ? "dynamic" : "static";
}

export async function resolveDynamicRoomReservationId(
  supabase: SupabaseServerClient,
  roomCodeRaw: string
): Promise<string | null> {
  const roomCode = coerceNonEmptyString(roomCodeRaw);
  if (!roomCode) {
    throw new HttpError(400, "room link requires ref_code (room number).");
  }

  const today = await resolveLogbookBusinessDate(supabase);

  const { data: roomRow, error: roomError } = await supabase
    .from("rooms")
    .select("id")
    .eq("room_number", roomCode)
    .maybeSingle();

  if (roomError) throw new HttpError(500, roomError.message);
  if (!roomRow?.id) return null;

  const roomId = String(roomRow.id);

  const [{ data: stayRows, error: stayError }, { data: departureRows, error: departureError }] =
    await Promise.all([
      supabase
        .from("reservation_nights")
        .select(
          "reservation_id, reservations!reservation_nights_reservation_id_fkey(id, status, checkin_date)"
        )
        .eq("room_id", roomId)
        .eq("stay_date", today)
        .is("cancelled_at", null),
      supabase
        .from("reservations")
        .select("id, reservation_nights(room_id, stay_date, cancelled_at)")
        .eq("status", "active")
        .eq("checkout_date", today),
    ]);

  if (stayError) throw new HttpError(500, stayError.message);
  if (departureError) throw new HttpError(500, departureError.message);

  const departureReservation = (departureRows ?? []).find((row: any) => {
    const nights = Array.isArray(row?.reservation_nights)
      ? row.reservation_nights
      : row?.reservation_nights
        ? [row.reservation_nights]
        : [];
    return nights.some((night: any) => !night?.cancelled_at && String(night?.room_id ?? "") === roomId);
  });

  if (departureReservation?.id) {
    return String(departureReservation.id);
  }

  const activeStayRows = (stayRows ?? []).filter((row: any) => {
    const reservationRef = Array.isArray(row?.reservations) ? row.reservations[0] : row?.reservations;
    return reservationRef?.status === "active";
  });

  const dueInReservation = activeStayRows.find((row: any) => {
    const reservationRef = Array.isArray(row?.reservations) ? row.reservations[0] : row?.reservations;
    return String(reservationRef?.checkin_date ?? "") === today;
  });

  if (dueInReservation?.reservation_id) {
    return String(dueInReservation.reservation_id);
  }

  const occupiedReservation = activeStayRows[0];
  if (occupiedReservation?.reservation_id) {
    return String(occupiedReservation.reservation_id);
  }

  return null;
}

export async function syncDynamicRoomLinksForReservation(
  supabase: SupabaseServerClient,
  params: {
    reservationId: string;
    nextRoomCode?: string | null;
  }
): Promise<void> {
  const reservationId = coerceNonEmptyString(params.reservationId);
  if (!reservationId) {
    throw new HttpError(400, "reservationId is required to sync dynamic room links.");
  }

  const nextRoomCode = coerceNonEmptyString(params.nextRoomCode);
  const updates = nextRoomCode
    ? {
        ref_code: nextRoomCode,
        label: `Room ${nextRoomCode}`,
      }
    : {
        ref_code: null,
        label: "Floating",
      };

  const { error } = await supabase
    .from("logbook_note_links")
    .update(updates)
    .eq("link_type", "room")
    .eq("room_link_mode", "dynamic")
    .eq("ref_id", reservationId);

  if (error) {
    throw new HttpError(500, error.message);
  }
}

export async function normalizeLogbookLinkInput(
  supabase: SupabaseServerClient,
  input: LogbookLinkInput
): Promise<{
  link_type: LogbookLinkTypeValue;
  ref_id: string | null;
  ref_code: string | null;
  room_link_mode: "static" | "dynamic";
  label: string;
}> {
  const customLabel = coerceNonEmptyString(input.label);

  if (input.link_type === "room") {
    const roomCode = coerceNonEmptyString(input.ref_code);
    if (!roomCode) {
      throw new HttpError(400, "room link requires ref_code (room number).");
    }
    const roomLinkMode =
      input.room_link_mode === "dynamic" || input.room_link_mode === "static"
        ? input.room_link_mode
        : await resolveRoomLinkMode(supabase, roomCode);

    if (roomLinkMode === "dynamic") {
      const reservationId =
        coerceNonEmptyString(input.ref_id) ?? (await resolveDynamicRoomReservationId(supabase, roomCode));
      if (!reservationId) {
        throw new HttpError(
          400,
          "Dynamic room link requires a reservation currently assigned to that room."
        );
      }

      return {
        link_type: "room",
        ref_id: reservationId,
        ref_code: roomCode,
        room_link_mode: "dynamic",
        label: customLabel ?? `Room ${roomCode}`,
      };
    }

    return {
      link_type: "room",
      ref_id: null,
      ref_code: roomCode,
      room_link_mode: "static",
      label: customLabel ?? `Room ${roomCode}`,
    };
  }

  if (input.link_type === "stock") {
    const refCode = coerceNonEmptyString(input.ref_code) ?? "stock";
    return {
      link_type: "stock",
      ref_id: null,
      ref_code: refCode,
      room_link_mode: "static",
      label: customLabel ?? "Stock",
    };
  }

  if (input.link_type === "guest") {
    const refId = coerceNonEmptyString(input.ref_id);
    if (!refId) throw new HttpError(400, "guest link requires ref_id.");

    const { data, error } = await supabase
      .from("guest_profiles")
      .select("id, first_name, last_name")
      .eq("id", refId)
      .maybeSingle();

    if (error) throw new HttpError(500, error.message);
    if (!data) throw new HttpError(404, "Guest profile not found.");

    return {
      link_type: "guest",
      ref_id: String(data.id),
      ref_code: null,
      room_link_mode: "static",
      label: customLabel ?? buildGuestName(data),
    };
  }

  const refId = coerceNonEmptyString(input.ref_id);
  if (!refId) throw new HttpError(400, "staff link requires ref_id.");

  const { data, error } = await supabase
    .from("staff")
    .select("id, display_name")
    .eq("id", refId)
    .maybeSingle();

  if (error) throw new HttpError(500, error.message);
  if (!data) throw new HttpError(404, "Staff not found.");

  const staffName = coerceNonEmptyString(data.display_name) ?? "Staff";
  return {
    link_type: "staff",
    ref_id: String(data.id),
    ref_code: null,
    room_link_mode: "static",
    label: customLabel ?? staffName,
  };
}

export type LogbookMentionInput = {
  mention_type: LogbookMentionTypeValue;
  staff_id?: string | null;
};

export async function normalizeLogbookMentionInput(
  supabase: SupabaseServerClient,
  input: LogbookMentionInput
): Promise<{ mention_type: LogbookMentionTypeValue; staff_id: string | null }> {
  if (input.mention_type === "staff") {
    const staffId = coerceNonEmptyString(input.staff_id);
    if (!staffId) {
      throw new HttpError(400, "staff mention requires staff_id.");
    }
    const { data, error } = await supabase.from("staff").select("id").eq("id", staffId).maybeSingle();
    if (error) throw new HttpError(500, error.message);
    if (!data) throw new HttpError(404, "Staff not found.");
    return { mention_type: "staff", staff_id: String(data.id) };
  }

  return { mention_type: input.mention_type, staff_id: null };
}

export function dedupeMentionInputs(
  rows: Array<{ mention_type: LogbookMentionTypeValue; staff_id: string | null }>
): Array<{ mention_type: LogbookMentionTypeValue; staff_id: string | null }> {
  const seen = new Set<string>();
  const deduped: Array<{ mention_type: LogbookMentionTypeValue; staff_id: string | null }> = [];
  for (const row of rows) {
    const key =
      row.mention_type === "staff"
        ? `staff:${row.staff_id ?? ""}`
        : `group:${row.mention_type}`;
    if (seen.has(key)) continue;
    seen.add(key);
    deduped.push(row);
  }
  return deduped;
}

export function extractLogbookInlineRefs(body: string): {
  links: Array<{ link_type: "room" | "stock"; ref_code: string | null; label: string }>;
  mentions: Array<{ mention_type: "group_all" | "group_frontdesk"; staff_id: null }>;
} {
  const safeBody = String(body ?? "");
  if (!safeBody.trim()) return { links: [], mentions: [] };

  const linkMap = new Map<string, { link_type: "room" | "stock"; ref_code: string | null; label: string }>();
  const mentionMap = new Map<string, { mention_type: "group_all" | "group_frontdesk"; staff_id: null }>();

  const regex = /@([a-zA-Z0-9_]+)/g;
  let match: RegExpExecArray | null;
  while ((match = regex.exec(safeBody)) !== null) {
    const token = String(match[1] ?? "").trim().toLowerCase();
    if (!token) continue;

    if (token === "all") {
      mentionMap.set("group_all", { mention_type: "group_all", staff_id: null });
      continue;
    }
    if (token === "frontdesk" || token === "fo") {
      mentionMap.set("group_frontdesk", { mention_type: "group_frontdesk", staff_id: null });
      continue;
    }
    if (token === "stock") {
      linkMap.set("stock", { link_type: "stock", ref_code: "stock", label: "Stock" });
      continue;
    }

    const roomMatch = token.match(/^(?:room|r)(\d{1,4})$/);
    if (roomMatch?.[1]) {
      const roomCode = roomMatch[1];
      linkMap.set(`room:${roomCode}`, {
        link_type: "room",
        ref_code: roomCode,
        label: `Room ${roomCode}`,
      });
    }
  }

  return {
    links: Array.from(linkMap.values()),
    mentions: Array.from(mentionMap.values()),
  };
}
