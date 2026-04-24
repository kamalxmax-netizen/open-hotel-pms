import { toBangkokDateString } from "@/lib/audit-utils";
import { getAuthenticatedUser, getUserRole } from "@/lib/server-auth";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import type { LostFoundCategory, LostFoundGuestAlert, LostFoundItem, LostFoundStatus, UserRole } from "@/lib/types";
import type { NextRequest } from "next/server";

const LOST_FOUND_BUCKET = "lost-found-photos";
const LOST_FOUND_ALLOWED_IMAGE_TYPES = new Set(["image/jpeg", "image/png", "image/webp"]);
const LOST_FOUND_MAX_UPLOAD_BYTES = 5 * 1024 * 1024;

type SupabaseServerClient = ReturnType<typeof createServerSupabaseClient>;

type LostFoundDbRow = {
  id: string;
  room_id: string | null;
  room_number: string | null;
  reservation_id: string | null;
  guest_profile_id: string | null;
  booking_code: string | null;
  guest_name: string | null;
  checkin_date: string | null;
  checkout_date: string | null;
  description: string;
  photo_path: string | null;
  category: LostFoundCategory;
  status: LostFoundStatus;
  found_date: string;
  found_by: string;
  reported_by_user_id: string | null;
  location_detail: string | null;
  claim_note: string | null;
  claimed_at: string | null;
  claimed_by: string | null;
  cleared_at: string | null;
  cleared_by: string | null;
  created_at: string;
  updated_at: string;
};

type ReservationLinkRow = {
  id: string;
  booking_code: string | null;
  guest_name: string | null;
  guest_profile_id: string | null;
  checkin_date: string | null;
  checkout_date: string | null;
  status: string | null;
  created_at?: string | null;
  updated_at?: string | null;
  checked_in_at?: string | null;
};

export type LostFoundRole = Extract<UserRole, "admin" | "frontdesk" | "maid" | "supervisor" | "owner">;

export type LostFoundActor = {
  userId: string;
  role: LostFoundRole;
  displayName: string;
};

export type LostFoundListFilters = {
  status?: "all" | "pending" | "claimed";
  dateFrom?: string | null;
  dateTo?: string | null;
  roomNumber?: string | null;
  guestName?: string | null;
  reportedBy?: string | null;
  guestProfileId?: string | null;
};

export type LostFoundSummary = {
  pending: number;
  claimed_this_month: number;
  total: number;
};

export type LostFoundReportRoom = {
  id: string;
  room_number: string;
  guest_name: string | null;
  reservation_id: string | null;
};

function normalizeText(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function isLostFoundRole(value: string | null): value is LostFoundRole {
  return value === "admin" || value === "frontdesk" || value === "maid" || value === "supervisor" || value === "owner";
}

function makeError(message: string, status: number) {
  const error = new Error(message) as Error & { status?: number };
  error.status = status;
  return error;
}

function compareDateValue(left?: string | null, right?: string | null): number {
  return String(right ?? "").localeCompare(String(left ?? ""));
}

function addSignedPhotoUrl(item: LostFoundItem, photoUrl?: string | null): LostFoundItem {
  return {
    ...item,
    photo_url: photoUrl ?? null,
  };
}

export function getLostFoundBucketName() {
  return LOST_FOUND_BUCKET;
}

export function getLostFoundAllowedImageTypes() {
  return LOST_FOUND_ALLOWED_IMAGE_TYPES;
}

export function getLostFoundMaxUploadBytes() {
  return LOST_FOUND_MAX_UPLOAD_BYTES;
}

export function resolveLostFoundExpiryCutoff(today = toBangkokDateString()): string {
  const base = new Date(`${today}T12:00:00+07:00`);
  base.setFullYear(base.getFullYear() - 1);
  return toBangkokDateString(base);
}

export function isLostFoundExpired(foundDate?: string | null, today = toBangkokDateString()): boolean {
  const normalized = normalizeText(foundDate);
  if (!normalized) return false;
  return normalized <= resolveLostFoundExpiryCutoff(today);
}

export function mapLostFoundRow(row: LostFoundDbRow, today = toBangkokDateString()): LostFoundItem {
  return {
    id: row.id,
    room_id: row.room_id ?? "",
    room_number: row.room_number ?? "",
    reservation_id: row.reservation_id,
    guest_profile_id: row.guest_profile_id,
    booking_code: row.booking_code,
    guest_name: row.guest_name,
    checkin_date: row.checkin_date,
    checkout_date: row.checkout_date,
    description: row.description,
    photo_path: row.photo_path,
    category: row.category,
    status: row.status,
    found_date: row.found_date,
    found_by: row.found_by,
    reported_by_user_id: row.reported_by_user_id,
    location_detail: row.location_detail,
    claim_note: row.claim_note,
    claimed_at: row.claimed_at,
    claimed_by: row.claimed_by,
    cleared_at: row.cleared_at,
    cleared_by: row.cleared_by,
    created_at: row.created_at,
    updated_at: row.updated_at,
    is_expired: row.status === "pending" && isLostFoundExpired(row.found_date, today),
  };
}

export async function requireLostFoundActor(
  supabase: SupabaseServerClient,
  request: NextRequest,
  allowedRoles: LostFoundRole[],
): Promise<LostFoundActor> {
  const user = await getAuthenticatedUser(supabase, request);
  if (!user) {
    throw makeError("Unauthorized", 401);
  }

  const role = await getUserRole(supabase, user.id);
  if (!isLostFoundRole(role)) {
    throw makeError("Forbidden", 403);
  }
  if (role === "owner" && request.method.toUpperCase() === "GET") {
    // Owner can view every surface, but cannot mutate Lost & Found.
  } else if (!allowedRoles.includes(role)) {
    throw makeError("Forbidden", 403);
  }

  const { data: profile, error } = await supabase
    .from("profiles")
    .select("full_name")
    .eq("user_id", user.id)
    .maybeSingle();

  if (error) {
    throw makeError(error.message, 500);
  }

  return {
    userId: user.id,
    role,
    displayName: normalizeText(profile?.full_name) ?? normalizeText(user.email) ?? user.id,
  };
}

export async function getRoomSnapshot(supabase: SupabaseServerClient, roomId: string) {
  const { data, error } = await supabase
    .from("rooms")
    .select("id, room_number")
    .eq("id", roomId)
    .maybeSingle();

  if (error) throw makeError(error.message, 500);
  if (!data?.id) throw makeError("Room not found.", 404);

  return {
    id: String(data.id),
    room_number: String(data.room_number ?? ""),
  };
}

export async function listLostFoundReportRooms(
  supabase: SupabaseServerClient,
): Promise<LostFoundReportRoom[]> {
  const businessDate = toBangkokDateString();
  const { data, error } = await supabase
    .from("reservations")
    .select("id, guest_name, reservation_nights(room_id, cancelled_at)")
    .eq("status", "checked_out")
    .eq("checkout_date", businessDate)
    .order("updated_at", { ascending: false });

  if (error) throw makeError(error.message, 500);

  const roomById = new Map<string, { reservation_id: string; guest_name: string | null }>();
  for (const reservation of data ?? []) {
    const nights = Array.isArray((reservation as any).reservation_nights)
      ? ((reservation as any).reservation_nights as Array<{ room_id?: string | null; cancelled_at?: string | null }>)
      : [];
    const roomId = String(
      nights.find((night) => night?.room_id && !night?.cancelled_at)?.room_id ?? "",
    );
    const reservationId = String((reservation as any).id ?? "");
    if (!roomId || !reservationId || roomById.has(roomId)) continue;
    roomById.set(roomId, {
      reservation_id: reservationId,
      guest_name: normalizeText((reservation as any).guest_name) ?? null,
    });
  }

  const roomIds = Array.from(roomById.keys());
  if (roomIds.length === 0) return [];

  const { data: rooms, error: roomsError } = await supabase
    .from("rooms")
    .select("id, room_number")
    .in("id", roomIds);

  if (roomsError) throw makeError(roomsError.message, 500);

  return (rooms ?? [])
    .map((room: any) => ({
      id: String(room.id),
      room_number: String(room.room_number ?? ""),
      guest_name: roomById.get(String(room.id))?.guest_name ?? null,
      reservation_id: roomById.get(String(room.id))?.reservation_id ?? null,
    }))
    .sort((left, right) =>
      left.room_number.localeCompare(right.room_number, undefined, {
        numeric: true,
        sensitivity: "base",
      }),
    );
}

async function fetchReservationById(supabase: SupabaseServerClient, reservationId: string) {
  const { data, error } = await supabase
    .from("reservations")
    .select("id, booking_code, guest_name, guest_profile_id, checkin_date, checkout_date, status, created_at, updated_at, checked_in_at")
    .eq("id", reservationId)
    .maybeSingle<ReservationLinkRow>();

  if (error) throw makeError(error.message, 500);
  if (!data?.id) throw makeError("Reservation not found.", 404);
  return data;
}

async function fetchReservationsForIds(supabase: SupabaseServerClient, reservationIds: string[]) {
  if (reservationIds.length === 0) return [] as ReservationLinkRow[];
  const { data, error } = await supabase
    .from("reservations")
    .select("id, booking_code, guest_name, guest_profile_id, checkin_date, checkout_date, status, created_at, updated_at, checked_in_at")
    .in("id", reservationIds);

  if (error) throw makeError(error.message, 500);
  return (data ?? []) as ReservationLinkRow[];
}

function orderReservationCandidates(rows: ReservationLinkRow[]) {
  return [...rows].sort((left, right) => {
    const checkoutCmp = compareDateValue(left.checkout_date, right.checkout_date);
    if (checkoutCmp !== 0) return checkoutCmp;
    const checkinCmp = compareDateValue(left.checkin_date, right.checkin_date);
    if (checkinCmp !== 0) return checkinCmp;
    const updatedCmp = compareDateValue(left.updated_at ?? left.created_at, right.updated_at ?? right.created_at);
    if (updatedCmp !== 0) return updatedCmp;
    return String(right.id).localeCompare(String(left.id));
  });
}

async function findCheckedOutTodayReservation(
  supabase: SupabaseServerClient,
  roomId: string,
  businessDate: string,
) {
  const { data, error } = await supabase
    .from("reservations")
    .select("id, booking_code, guest_name, guest_profile_id, checkin_date, checkout_date, status, created_at, updated_at, reservation_nights(room_id, cancelled_at)")
    .eq("status", "checked_out")
    .eq("checkout_date", businessDate)
    .order("updated_at", { ascending: false })
    .limit(20);

  if (error) throw makeError(error.message, 500);

  const matched = (data ?? []).filter((row: any) =>
    Array.isArray(row.reservation_nights) &&
    row.reservation_nights.some((night: any) => String(night?.room_id ?? "") === roomId && !night?.cancelled_at)
  );

  return orderReservationCandidates(matched as ReservationLinkRow[])[0] ?? null;
}

async function findActiveReservation(
  supabase: SupabaseServerClient,
  roomId: string,
  businessDate: string,
) {
  const { data, error } = await supabase
    .from("reservations")
    .select("id, booking_code, guest_name, guest_profile_id, checkin_date, checkout_date, status, created_at, updated_at, checked_in_at, reservation_nights(room_id, cancelled_at)")
    .eq("status", "active")
    .lte("checkin_date", businessDate)
    .gte("checkout_date", businessDate)
    .order("checkin_date", { ascending: false })
    .limit(50);

  if (error) throw makeError(error.message, 500);

  const matched = (data ?? []).filter((row: any) =>
    Array.isArray(row.reservation_nights) &&
    row.reservation_nights.some((night: any) => String(night?.room_id ?? "") === roomId && !night?.cancelled_at)
  );

  return orderReservationCandidates(matched as ReservationLinkRow[])[0] ?? null;
}

async function findLatestCheckoutReservation(
  supabase: SupabaseServerClient,
  roomId: string,
  businessDate: string,
) {
  const { data: nightRows, error: nightError } = await supabase
    .from("reservation_nights")
    .select("reservation_id, stay_date")
    .eq("room_id", roomId)
    .is("cancelled_at", null)
    .lte("stay_date", businessDate)
    .order("stay_date", { ascending: false })
    .limit(50);

  if (nightError) throw makeError(nightError.message, 500);

  const reservationIds = Array.from(
    new Set(
      (nightRows ?? [])
        .map((row: any) => String(row?.reservation_id ?? ""))
        .filter(Boolean),
    ),
  );

  const reservations = await fetchReservationsForIds(supabase, reservationIds);
  return orderReservationCandidates(reservations)[0] ?? null;
}

export async function resolveLostFoundReservationLink(
  supabase: SupabaseServerClient,
  roomId: string,
  reservationId?: string | null,
) {
  const explicitReservationId = normalizeText(reservationId);
  const linked = explicitReservationId
    ? await fetchReservationById(supabase, explicitReservationId)
    : await findCheckedOutTodayReservation(supabase, roomId, toBangkokDateString()) ??
      await findActiveReservation(supabase, roomId, toBangkokDateString()) ??
      await findLatestCheckoutReservation(supabase, roomId, toBangkokDateString());

  if (!linked) {
    return {
      reservation_id: null,
      guest_profile_id: null,
      booking_code: null,
      guest_name: null,
      checkin_date: null,
      checkout_date: null,
    };
  }

  return {
    reservation_id: String(linked.id),
    guest_profile_id: linked.guest_profile_id ? String(linked.guest_profile_id) : null,
    booking_code: linked.booking_code ? String(linked.booking_code) : null,
    guest_name: linked.guest_name ? String(linked.guest_name) : null,
    checkin_date: linked.checkin_date ? String(linked.checkin_date) : null,
    checkout_date: linked.checkout_date ? String(linked.checkout_date) : null,
  };
}

export async function createLostFoundSignedUrl(
  supabase: SupabaseServerClient,
  photoPath?: string | null,
  expiresInSeconds = 3600,
) {
  const normalizedPath = normalizeText(photoPath);
  if (!normalizedPath) return null;

  const { data, error } = await supabase.storage
    .from(LOST_FOUND_BUCKET)
    .createSignedUrl(normalizedPath, expiresInSeconds);

  if (error || !data?.signedUrl) return null;
  return data.signedUrl;
}

export async function attachLostFoundPhotoUrls(
  supabase: SupabaseServerClient,
  items: LostFoundItem[],
) {
  const signedUrls = await Promise.all(
    items.map((item) => createLostFoundSignedUrl(supabase, item.photo_path)),
  );

  return items.map((item, index) => addSignedPhotoUrl(item, signedUrls[index] ?? null));
}

export async function getLostFoundItemById(
  supabase: SupabaseServerClient,
  itemId: string,
) {
  const { data, error } = await supabase
    .from("lost_found_items")
    .select("*")
    .eq("id", itemId)
    .maybeSingle<LostFoundDbRow>();

  if (error) throw makeError(error.message, 500);
  if (!data?.id) throw makeError("Lost & Found item not found.", 404);
  return mapLostFoundRow(data);
}

export async function deleteLostFoundPhoto(
  supabase: SupabaseServerClient,
  photoPath?: string | null,
) {
  const normalizedPath = normalizeText(photoPath);
  if (!normalizedPath) return;
  await supabase.storage.from(LOST_FOUND_BUCKET).remove([normalizedPath]);
}

export async function listLostFoundItems(
  supabase: SupabaseServerClient,
  filters: LostFoundListFilters,
) {
  const today = toBangkokDateString();
  let query = supabase
    .from("lost_found_items")
    .select("*")
    .is("cleared_at", null)
    .order("found_date", { ascending: false })
    .order("created_at", { ascending: false });

  if (filters.status && filters.status !== "all") {
    query = query.eq("status", filters.status);
  }
  if (filters.dateFrom) query = query.gte("found_date", filters.dateFrom);
  if (filters.dateTo) query = query.lte("found_date", filters.dateTo);
  if (filters.roomNumber) query = query.ilike("room_number", `%${filters.roomNumber}%`);
  if (filters.guestName) query = query.ilike("guest_name", `%${filters.guestName}%`);
  if (filters.reportedBy) query = query.ilike("found_by", `%${filters.reportedBy}%`);
  if (filters.guestProfileId) query = query.eq("guest_profile_id", filters.guestProfileId);

  const { data, error } = await query;
  if (error) throw makeError(error.message, 500);

  const items = (data ?? []).map((row) => mapLostFoundRow(row as LostFoundDbRow, today));
  return items.filter((item) => item.status === "claimed" || !item.is_expired);
}

export async function getLostFoundSummary(
  supabase: SupabaseServerClient,
): Promise<LostFoundSummary> {
  const today = toBangkokDateString();
  const cutoff = resolveLostFoundExpiryCutoff(today);
  const monthStart = `${today.slice(0, 7)}-01`;

  const [pendingRes, claimedThisMonthRes, totalRes] = await Promise.all([
    supabase
      .from("lost_found_items")
      .select("id", { count: "exact", head: true })
      .eq("status", "pending")
      .is("cleared_at", null)
      .gt("found_date", cutoff),
    supabase
      .from("lost_found_items")
      .select("id", { count: "exact", head: true })
      .eq("status", "claimed")
      .gte("claimed_at", `${monthStart}T00:00:00+07:00`),
    supabase
      .from("lost_found_items")
      .select("id", { count: "exact", head: true })
      .is("cleared_at", null),
  ]);

  if (pendingRes.error) throw makeError(pendingRes.error.message, 500);
  if (claimedThisMonthRes.error) throw makeError(claimedThisMonthRes.error.message, 500);
  if (totalRes.error) throw makeError(totalRes.error.message, 500);

  return {
    pending: pendingRes.count ?? 0,
    claimed_this_month: claimedThisMonthRes.count ?? 0,
    total: totalRes.count ?? 0,
  };
}

export async function listExpiredLostFoundItems(
  supabase: SupabaseServerClient,
  showCleared: boolean,
) {
  const today = toBangkokDateString();
  const cutoff = resolveLostFoundExpiryCutoff(today);
  let query = supabase
    .from("lost_found_items")
    .select("*")
    .eq("status", "pending")
    .lte("found_date", cutoff)
    .order("found_date", { ascending: true })
    .order("created_at", { ascending: true });

  if (!showCleared) {
    query = query.is("cleared_at", null);
  }

  const { data, error } = await query;
  if (error) throw makeError(error.message, 500);

  return (data ?? []).map((row) => mapLostFoundRow(row as LostFoundDbRow, today));
}

export async function getLostFoundGuestAlert(
  supabase: SupabaseServerClient,
  guestProfileId: string,
): Promise<LostFoundGuestAlert | null> {
  const cutoff = resolveLostFoundExpiryCutoff();
  const { data, error } = await supabase
    .from("lost_found_items")
    .select("id, guest_profile_id, guest_name, description, room_number, booking_code, found_date, category")
    .eq("guest_profile_id", guestProfileId)
    .eq("status", "pending")
    .is("cleared_at", null)
    .gt("found_date", cutoff)
    .order("found_date", { ascending: false });

  if (error) throw makeError(error.message, 500);
  if (!data || data.length === 0) return null;

  return {
    guest_profile_id: guestProfileId,
    guest_name: normalizeText((data[0] as any).guest_name) ?? null,
    items: data.map((row: any) => ({
      id: String(row.id),
      description: String(row.description ?? ""),
      room_number: String(row.room_number ?? ""),
      booking_code: normalizeText(row.booking_code) ?? null,
      found_date: String(row.found_date ?? ""),
      category: (normalizeText(row.category) ?? "general") as LostFoundCategory,
    })),
  };
}

export function getLostFoundErrorStatus(error: unknown) {
  return typeof error === "object" && error && "status" in error && typeof (error as any).status === "number"
    ? (error as any).status
    : 500;
}

export function getLostFoundErrorMessage(error: unknown) {
  return error instanceof Error ? error.message : "Internal server error";
}
