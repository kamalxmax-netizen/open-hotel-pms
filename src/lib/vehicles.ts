import { toBangkokDateString } from "@/lib/audit-utils";
import { toBangkokWindow } from "@/lib/night-audit";
import { getAuthenticatedUser, getUserRole } from "@/lib/server-auth";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import type { UserRole } from "@/lib/types";
import type { NextRequest } from "next/server";

type SupabaseServerClient = ReturnType<typeof createServerSupabaseClient>;

export const VEHICLE_TYPES = ["car", "motorcycle", "bicycle"] as const;
export type VehicleType = (typeof VEHICLE_TYPES)[number];

export const VEHICLE_COUNTRIES = ["TH", "MY"] as const;
export type VehicleCountry = (typeof VEHICLE_COUNTRIES)[number];

export const VEHICLE_COLORS = ["white", "black", "silver", "red", "blue", "yellow", "other"] as const;
export type VehicleColor = (typeof VEHICLE_COLORS)[number];

export type VehicleActorRole = Extract<UserRole, "admin" | "frontdesk" | "supervisor">;

export type VehicleActor = {
  userId: string;
  role: VehicleActorRole;
  displayName: string;
};

type GuestVehicleDbRow = {
  id: string;
  reservation_id: string;
  guest_profile_id: string | null;
  room_id: string | null;
  room_number: string | null;
  booking_code: string | null;
  guest_name: string | null;
  vehicle_type: VehicleType;
  plate_number: string | null;
  plate_province: string | null;
  plate_country: VehicleCountry;
  vehicle_brand: string | null;
  vehicle_model: string | null;
  vehicle_color: VehicleColor;
  description: string | null;
  registered_at: string;
  registered_by: string | null;
  checked_out_at: string | null;
  created_at: string;
  updated_at: string;
};

type ReservationRow = {
  id: string;
  booking_code: string | null;
  guest_name: string | null;
  guest_profile_id: string | null;
  booking_group_id: string | null;
  status: string | null;
  checkin_date: string | null;
  checkout_date: string | null;
  checked_in_at: string | null;
  checked_out_at: string | null;
};

type ReservationNightRow = {
  reservation_id: string;
  room_id: string | null;
  stay_date: string;
};

type RoomRow = {
  id: string;
  room_number: string | null;
};

type ReservationVehicleContext = ReservationRow & {
  current_room_id: string | null;
  current_room_number: string | null;
};

export type VehicleRecord = {
  id: string;
  reservation_id: string;
  guest_profile_id: string | null;
  room_id: string | null;
  room_number: string | null;
  current_room_id: string | null;
  current_room_number: string | null;
  effective_room_id: string | null;
  effective_room_number: string | null;
  booking_code: string | null;
  guest_name: string | null;
  reservation_status: string | null;
  checkin_date: string | null;
  checkout_date: string | null;
  checked_in_at: string | null;
  reservation_checked_out_at: string | null;
  vehicle_type: VehicleType;
  plate_number: string | null;
  plate_province: string | null;
  plate_country: VehicleCountry;
  country_flag: string;
  vehicle_brand: string | null;
  vehicle_model: string | null;
  vehicle_color: VehicleColor;
  description: string | null;
  registered_at: string;
  registered_by: string | null;
  checked_out_at: string | null;
  created_at: string;
  updated_at: string;
  is_active: boolean;
  vehicle_status: "active" | "checked_out_today" | "historical";
  short_label: string;
  title: string;
  subtitle: string | null;
  plate_display: string | null;
  plate_suffix: string | null;
};

export type VehicleSummary = {
  id: string;
  reservation_id: string;
  effective_room_id: string | null;
  effective_room_number: string | null;
  guest_name: string | null;
  booking_code: string | null;
  vehicle_type: VehicleType;
  vehicle_color: VehicleColor;
  plate_number: string | null;
  plate_province: string | null;
  plate_country: VehicleCountry;
  country_flag: string;
  short_label: string;
  title: string;
  description: string | null;
};

export type DistinctProfileVehicle = {
  vehicle_key: string;
  vehicle_type: VehicleType;
  plate_number: string | null;
  plate_province: string | null;
  plate_country: VehicleCountry;
  vehicle_brand: string | null;
  vehicle_model: string | null;
  vehicle_color: VehicleColor;
  description: string | null;
  short_label: string;
  title: string;
  subtitle: string | null;
  latest_registered_at: string;
  last_reservation_id: string | null;
  last_room_number: string | null;
  last_guest_name: string | null;
};

export type CreateVehicleInput = {
  reservationId: string;
  groupLink?: boolean;
  actorName?: string | null;
  vehicleType: VehicleType;
  plateNumber?: string | null;
  plateProvince?: string | null;
  plateCountry?: VehicleCountry;
  vehicleBrand?: string | null;
  vehicleModel?: string | null;
  vehicleColor?: VehicleColor;
  description?: string | null;
};

type VehicleInsertRow = Omit<GuestVehicleDbRow, "id" | "created_at" | "updated_at">;

function normalizeText(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function normalizePlateNumber(value: unknown): string | null {
  const normalized = normalizeText(value);
  if (!normalized) return null;
  return normalized.replace(/\s+/g, " ");
}

function normalizePlateNumberKey(value: unknown): string | null {
  const normalized = normalizePlateNumber(value);
  if (!normalized) return null;
  return normalized.toUpperCase();
}

function toBangkokDateFromIso(value: string | null | undefined): string | null {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Bangkok" }).format(date);
}

function getCountryFlag(country: VehicleCountry): string {
  return country === "MY" ? "🇲🇾" : "🇹🇭";
}

function getPlateSuffix(rawPlate: string | null | undefined, digits: number): string | null {
  const normalized = normalizePlateNumber(rawPlate);
  if (!normalized) return null;
  const onlyDigits = normalized.replace(/\D/g, "");
  if (onlyDigits.length > 0) return onlyDigits.slice(-digits);
  const compact = normalized.replace(/\s+/g, "");
  return compact.length > digits ? compact.slice(-digits) : compact;
}

function getVehicleShortLabel(row: {
  vehicle_type: VehicleType;
  plate_number: string | null;
}): string {
  if (row.vehicle_type === "bicycle") return "BICYCLE";
  const suffix = getPlateSuffix(row.plate_number, row.vehicle_type === "car" ? 4 : 3);
  if (row.vehicle_type === "car") return `CAR-${suffix ?? "----"}`;
  return `MOTO-${suffix ?? "---"}`;
}

function getVehicleTitle(row: {
  vehicle_type: VehicleType;
  plate_number: string | null;
  description: string | null;
}): string {
  const plate = normalizePlateNumber(row.plate_number);
  if (plate) return plate;
  if (row.vehicle_type === "bicycle") return normalizeText(row.description) ?? "BICYCLE";
  return normalizeText(row.description) ?? "No Plate";
}

function getVehicleSubtitle(row: {
  vehicle_brand: string | null;
  vehicle_model: string | null;
  vehicle_color: VehicleColor;
}): string | null {
  const parts = [
    normalizeText(row.vehicle_brand),
    normalizeText(row.vehicle_model),
    normalizeText(row.vehicle_color),
  ].filter(Boolean);
  return parts.length > 0 ? parts.join(" · ") : null;
}

function compareRoomLabel(left: string | null | undefined, right: string | null | undefined): number {
  return String(left ?? "").localeCompare(String(right ?? ""), undefined, { numeric: true, sensitivity: "base" });
}

function compareIso(left: string | null | undefined, right: string | null | undefined): number {
  return String(right ?? "").localeCompare(String(left ?? ""));
}

function sortVehicleRecords(rows: VehicleRecord[]): VehicleRecord[] {
  return [...rows].sort((a, b) => {
    if (a.is_active !== b.is_active) return a.is_active ? -1 : 1;
    const roomCompare = compareRoomLabel(a.effective_room_number, b.effective_room_number);
    if (roomCompare !== 0) return roomCompare;
    const checkoutCompare = compareIso(a.checked_out_at, b.checked_out_at);
    if (checkoutCompare !== 0) return checkoutCompare;
    const plateCompare = String(a.plate_number ?? "").localeCompare(String(b.plate_number ?? ""), undefined, {
      numeric: true,
      sensitivity: "base",
    });
    if (plateCompare !== 0) return plateCompare;
    return compareIso(a.registered_at, b.registered_at);
  });
}

function getVehicleStatus(row: GuestVehicleDbRow, today: string): VehicleRecord["vehicle_status"] {
  if (!row.checked_out_at) return "active";
  return toBangkokDateFromIso(row.checked_out_at) === today ? "checked_out_today" : "historical";
}

function buildDistinctVehicleKey(row: {
  vehicle_type: VehicleType;
  plate_number: string | null;
  plate_country: VehicleCountry;
  description: string | null;
  vehicle_brand: string | null;
  vehicle_model: string | null;
}): string {
  const plateKey = normalizePlateNumberKey(row.plate_number);
  if (plateKey) {
    return `${row.vehicle_type}|${row.plate_country}|${plateKey}`;
  }

  const fallback = [
    row.vehicle_type,
    normalizeText(row.description)?.toLowerCase() ?? "",
    normalizeText(row.vehicle_brand)?.toLowerCase() ?? "",
    normalizeText(row.vehicle_model)?.toLowerCase() ?? "",
  ].join("|");
  return fallback;
}

function isVehicleActorRole(value: string | null): value is VehicleActorRole {
  return value === "admin" || value === "frontdesk" || value === "supervisor";
}

function makeVehicleError(message: string, status: number) {
  const error = new Error(message) as Error & { status?: number };
  error.status = status;
  return error;
}

export function getVehicleErrorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  return "Internal server error";
}

export function getVehicleErrorStatus(error: unknown): number {
  if (typeof error === "object" && error && "status" in error && typeof (error as { status?: unknown }).status === "number") {
    return Number((error as { status?: number }).status);
  }
  return 500;
}

async function loadReservationsByIds(
  supabase: SupabaseServerClient,
  reservationIds: string[],
): Promise<Map<string, ReservationRow>> {
  const ids = Array.from(new Set(reservationIds.filter(Boolean)));
  if (ids.length === 0) return new Map();

  const { data, error } = await supabase
    .from("reservations")
    .select("id, booking_code, guest_name, guest_profile_id, booking_group_id, status, checkin_date, checkout_date, checked_in_at, checked_out_at")
    .in("id", ids);

  if (error) {
    throw makeVehicleError(error.message, 500);
  }

  return new Map(
    (data ?? []).map((row: any) => [
      String(row.id),
      {
        id: String(row.id),
        booking_code: normalizeText(row.booking_code),
        guest_name: normalizeText(row.guest_name),
        guest_profile_id: row.guest_profile_id ? String(row.guest_profile_id) : null,
        booking_group_id: row.booking_group_id ? String(row.booking_group_id) : null,
        status: normalizeText(row.status),
        checkin_date: normalizeText(row.checkin_date),
        checkout_date: normalizeText(row.checkout_date),
        checked_in_at: row.checked_in_at ? String(row.checked_in_at) : null,
        checked_out_at: row.checked_out_at ? String(row.checked_out_at) : null,
      },
    ]),
  );
}

async function loadLatestRoomByReservationIds(
  supabase: SupabaseServerClient,
  reservationIds: string[],
): Promise<Map<string, { room_id: string | null; room_number: string | null }>> {
  const ids = Array.from(new Set(reservationIds.filter(Boolean)));
  if (ids.length === 0) return new Map();

  const { data: nights, error: nightsError } = await supabase
    .from("reservation_nights")
    .select("reservation_id, room_id, stay_date")
    .in("reservation_id", ids)
    .is("cancelled_at", null);

  if (nightsError) {
    throw makeVehicleError(nightsError.message, 500);
  }

  const latestNightByReservation = new Map<string, ReservationNightRow>();
  const roomIds = new Set<string>();

  for (const row of (nights ?? []) as any[]) {
    const reservationId = String(row.reservation_id ?? "");
    const stayDate = String(row.stay_date ?? "");
    const roomId = row.room_id ? String(row.room_id) : null;
    if (!reservationId || !stayDate) continue;
    const current = latestNightByReservation.get(reservationId);
    if (!current || stayDate > current.stay_date) {
      latestNightByReservation.set(reservationId, {
        reservation_id: reservationId,
        room_id: roomId,
        stay_date: stayDate,
      });
    }
    if (roomId) roomIds.add(roomId);
  }

  const roomNumberById = new Map<string, string | null>();
  if (roomIds.size > 0) {
    const { data: rooms, error: roomsError } = await supabase
      .from("rooms")
      .select("id, room_number")
      .in("id", Array.from(roomIds));

    if (roomsError) {
      throw makeVehicleError(roomsError.message, 500);
    }

    for (const room of (rooms ?? []) as RoomRow[]) {
      roomNumberById.set(String(room.id), normalizeText(room.room_number));
    }
  }

  return new Map(
    Array.from(latestNightByReservation.entries()).map(([reservationId, row]) => [
      reservationId,
      {
        room_id: row.room_id,
        room_number: row.room_id ? roomNumberById.get(row.room_id) ?? null : null,
      },
    ]),
  );
}

async function loadReservationVehicleContextByIds(
  supabase: SupabaseServerClient,
  reservationIds: string[],
): Promise<Map<string, ReservationVehicleContext>> {
  const [reservationMap, roomMap] = await Promise.all([
    loadReservationsByIds(supabase, reservationIds),
    loadLatestRoomByReservationIds(supabase, reservationIds),
  ]);

  return new Map(
    Array.from(reservationMap.entries()).map(([reservationId, reservation]) => [
      reservationId,
      {
        ...reservation,
        current_room_id: roomMap.get(reservationId)?.room_id ?? null,
        current_room_number: roomMap.get(reservationId)?.room_number ?? null,
      },
    ]),
  );
}

function mapVehicleRow(
  row: GuestVehicleDbRow,
  reservationContext: ReservationVehicleContext | null,
  today = toBangkokDateString(),
): VehicleRecord {
  const vehicleStatus = getVehicleStatus(row, today);
  const effectiveRoomId = reservationContext?.current_room_id ?? row.room_id ?? null;
  const effectiveRoomNumber = reservationContext?.current_room_number ?? row.room_number ?? null;

  return {
    id: row.id,
    reservation_id: row.reservation_id,
    guest_profile_id: row.guest_profile_id ?? reservationContext?.guest_profile_id ?? null,
    room_id: row.room_id,
    room_number: row.room_number,
    current_room_id: reservationContext?.current_room_id ?? null,
    current_room_number: reservationContext?.current_room_number ?? null,
    effective_room_id: effectiveRoomId,
    effective_room_number: effectiveRoomNumber,
    booking_code: row.booking_code ?? reservationContext?.booking_code ?? null,
    guest_name: row.guest_name ?? reservationContext?.guest_name ?? null,
    reservation_status: reservationContext?.status ?? null,
    checkin_date: reservationContext?.checkin_date ?? null,
    checkout_date: reservationContext?.checkout_date ?? null,
    checked_in_at: reservationContext?.checked_in_at ?? null,
    reservation_checked_out_at: reservationContext?.checked_out_at ?? null,
    vehicle_type: row.vehicle_type,
    plate_number: row.plate_number,
    plate_province: row.plate_province,
    plate_country: row.plate_country,
    country_flag: getCountryFlag(row.plate_country),
    vehicle_brand: row.vehicle_brand,
    vehicle_model: row.vehicle_model,
    vehicle_color: row.vehicle_color,
    description: row.description,
    registered_at: row.registered_at,
    registered_by: row.registered_by,
    checked_out_at: row.checked_out_at,
    created_at: row.created_at,
    updated_at: row.updated_at,
    is_active: vehicleStatus === "active",
    vehicle_status: vehicleStatus,
    short_label: getVehicleShortLabel(row),
    title: getVehicleTitle(row),
    subtitle: getVehicleSubtitle(row),
    plate_display: normalizePlateNumber(row.plate_number),
    plate_suffix: getPlateSuffix(row.plate_number, row.vehicle_type === "car" ? 4 : 3),
  };
}

async function enrichVehicleRows(
  supabase: SupabaseServerClient,
  rows: GuestVehicleDbRow[],
): Promise<VehicleRecord[]> {
  if (rows.length === 0) return [];
  const reservationContext = await loadReservationVehicleContextByIds(
    supabase,
    rows.map((row) => row.reservation_id),
  );

  return sortVehicleRecords(
    rows.map((row) => mapVehicleRow(row, reservationContext.get(row.reservation_id) ?? null)),
  );
}

function mapRawVehicleRow(row: any): GuestVehicleDbRow {
  return {
    id: String(row.id),
    reservation_id: String(row.reservation_id),
    guest_profile_id: row.guest_profile_id ? String(row.guest_profile_id) : null,
    room_id: row.room_id ? String(row.room_id) : null,
    room_number: normalizeText(row.room_number),
    booking_code: normalizeText(row.booking_code),
    guest_name: normalizeText(row.guest_name),
    vehicle_type: String(row.vehicle_type) as VehicleType,
    plate_number: normalizePlateNumber(row.plate_number),
    plate_province: normalizeText(row.plate_province),
    plate_country: String(row.plate_country ?? "TH") as VehicleCountry,
    vehicle_brand: normalizeText(row.vehicle_brand),
    vehicle_model: normalizeText(row.vehicle_model),
    vehicle_color: String(row.vehicle_color ?? "white") as VehicleColor,
    description: normalizeText(row.description),
    registered_at: String(row.registered_at),
    registered_by: normalizeText(row.registered_by),
    checked_out_at: row.checked_out_at ? String(row.checked_out_at) : null,
    created_at: String(row.created_at),
    updated_at: String(row.updated_at),
  };
}

export async function requireVehicleActor(
  supabase: SupabaseServerClient,
  request: NextRequest,
  allowedRoles: VehicleActorRole[] = ["admin", "frontdesk", "supervisor"],
): Promise<VehicleActor> {
  const user = await getAuthenticatedUser(supabase, request);
  if (!user) {
    throw makeVehicleError("Unauthorized", 401);
  }

  const role = await getUserRole(supabase, user.id);
  if (!isVehicleActorRole(role)) {
    throw makeVehicleError("Forbidden", 403);
  }
  if (!allowedRoles.includes(role)) {
    throw makeVehicleError("Forbidden", 403);
  }

  const { data: profile, error } = await supabase
    .from("profiles")
    .select("full_name")
    .eq("user_id", user.id)
    .maybeSingle();

  if (error) {
    throw makeVehicleError(error.message, 500);
  }

  return {
    userId: user.id,
    role,
    displayName: normalizeText(profile?.full_name) ?? normalizeText(user.email) ?? user.id,
  };
}

async function listVehicleRows(
  _supabase: SupabaseServerClient,
  query: PromiseLike<{ data: any[] | null; error: { message?: string | null } | null }>,
): Promise<GuestVehicleDbRow[]> {
  const { data, error } = await query;
  if (error) {
    throw makeVehicleError(String(error.message ?? "Database query failed."), 500);
  }
  return ((data ?? []) as any[]).map(mapRawVehicleRow);
}

export async function getActiveVehicles(supabase: SupabaseServerClient): Promise<VehicleRecord[]> {
  const rows = await listVehicleRows(
    supabase,
    supabase
      .from("guest_vehicles")
      .select("*")
      .is("checked_out_at", null)
      .order("room_number", { ascending: true })
      .order("registered_at", { ascending: true }),
  );
  return enrichVehicleRows(supabase, rows);
}

export async function getCheckedOutTodayVehicles(
  supabase: SupabaseServerClient,
  today = toBangkokDateString(),
): Promise<VehicleRecord[]> {
  const window = toBangkokWindow(today);
  const rows = await listVehicleRows(
    supabase,
    supabase
      .from("guest_vehicles")
      .select("*")
      .gte("checked_out_at", window.from)
      .lt("checked_out_at", window.to)
      .order("checked_out_at", { ascending: false }),
  );
  return enrichVehicleRows(supabase, rows);
}

export async function getVehicleById(
  supabase: SupabaseServerClient,
  vehicleId: string,
): Promise<VehicleRecord | null> {
  const { data, error } = await supabase
    .from("guest_vehicles")
    .select("*")
    .eq("id", vehicleId)
    .maybeSingle();

  if (error) {
    throw makeVehicleError(error.message, 500);
  }
  if (!data) return null;

  const [vehicle] = await enrichVehicleRows(supabase, [mapRawVehicleRow(data)]);
  return vehicle ?? null;
}

export async function getVehiclesByRoom(
  supabase: SupabaseServerClient,
  roomId: string,
): Promise<VehicleRecord[]> {
  const activeVehicles = await getActiveVehicles(supabase);
  return activeVehicles.filter((vehicle) => vehicle.effective_room_id === roomId);
}

export async function getVehiclesByReservation(
  supabase: SupabaseServerClient,
  reservationId: string,
): Promise<VehicleRecord[]> {
  const rows = await listVehicleRows(
    supabase,
    supabase
      .from("guest_vehicles")
      .select("*")
      .eq("reservation_id", reservationId)
      .order("checked_out_at", { ascending: false, nullsFirst: true })
      .order("registered_at", { ascending: false }),
  );
  return enrichVehicleRows(supabase, rows);
}

export async function getProfileDistinctVehicles(
  supabase: SupabaseServerClient,
  guestProfileId: string,
): Promise<DistinctProfileVehicle[]> {
  const rows = await listVehicleRows(
    supabase,
    supabase
      .from("guest_vehicles")
      .select("*")
      .eq("guest_profile_id", guestProfileId)
      .order("registered_at", { ascending: false }),
  );

  const vehicles = await enrichVehicleRows(supabase, rows);
  const distinct = new Map<string, DistinctProfileVehicle>();

  for (const vehicle of vehicles) {
    const key = buildDistinctVehicleKey({
      vehicle_type: vehicle.vehicle_type,
      plate_number: vehicle.plate_number,
      plate_country: vehicle.plate_country,
      description: vehicle.description,
      vehicle_brand: vehicle.vehicle_brand,
      vehicle_model: vehicle.vehicle_model,
    });
    if (distinct.has(key)) continue;
    distinct.set(key, {
      vehicle_key: key,
      vehicle_type: vehicle.vehicle_type,
      plate_number: vehicle.plate_number,
      plate_province: vehicle.plate_province,
      plate_country: vehicle.plate_country,
      vehicle_brand: vehicle.vehicle_brand,
      vehicle_model: vehicle.vehicle_model,
      vehicle_color: vehicle.vehicle_color,
      description: vehicle.description,
      short_label: vehicle.short_label,
      title: vehicle.title,
      subtitle: vehicle.subtitle,
      latest_registered_at: vehicle.registered_at,
      last_reservation_id: vehicle.reservation_id,
      last_room_number: vehicle.effective_room_number,
      last_guest_name: vehicle.guest_name,
    });
  }

  return Array.from(distinct.values());
}

export async function getActiveVehicleSummary(
  supabase: SupabaseServerClient,
): Promise<Record<string, VehicleSummary[]>> {
  const activeVehicles = await getActiveVehicles(supabase);
  const summary: Record<string, VehicleSummary[]> = {};

  for (const vehicle of activeVehicles) {
    if (!vehicle.effective_room_id) continue;
    if (!summary[vehicle.effective_room_id]) {
      summary[vehicle.effective_room_id] = [];
    }
    summary[vehicle.effective_room_id].push({
      id: vehicle.id,
      reservation_id: vehicle.reservation_id,
      effective_room_id: vehicle.effective_room_id,
      effective_room_number: vehicle.effective_room_number,
      guest_name: vehicle.guest_name,
      booking_code: vehicle.booking_code,
      vehicle_type: vehicle.vehicle_type,
      vehicle_color: vehicle.vehicle_color,
      plate_number: vehicle.plate_number,
      plate_province: vehicle.plate_province,
      plate_country: vehicle.plate_country,
      country_flag: vehicle.country_flag,
      short_label: vehicle.short_label,
      title: vehicle.title,
      description: vehicle.description,
    });
  }

  return summary;
}

async function getReservationVehicleContext(
  supabase: SupabaseServerClient,
  reservationId: string,
): Promise<ReservationVehicleContext> {
  const contextMap = await loadReservationVehicleContextByIds(supabase, [reservationId]);
  const reservation = contextMap.get(reservationId);
  if (!reservation) {
    throw makeVehicleError("Reservation not found.", 404);
  }
  return reservation;
}

async function listActiveGroupReservations(
  supabase: SupabaseServerClient,
  bookingGroupId: string,
): Promise<ReservationVehicleContext[]> {
  const { data, error } = await supabase
    .from("reservations")
    .select("id")
    .eq("booking_group_id", bookingGroupId)
    .eq("status", "active");

  if (error) {
    throw makeVehicleError(error.message, 500);
  }

  const ids = (data ?? []).map((row: any) => String(row.id ?? "")).filter(Boolean);
  if (ids.length === 0) return [];

  const contextMap = await loadReservationVehicleContextByIds(supabase, ids);
  return ids
    .map((id) => contextMap.get(id) ?? null)
    .filter((row): row is ReservationVehicleContext => Boolean(row));
}

function validateVehicleReservationContext(context: ReservationVehicleContext): void {
  if (context.status !== "active") {
    throw makeVehicleError("Reservation must be active before registering a vehicle.", 409);
  }

  const today = toBangkokDateString();
  const isCheckedIn = Boolean(context.checked_in_at) || (context.checkin_date ? context.checkin_date <= today : false);
  if (!isCheckedIn) {
    throw makeVehicleError("Reservation is not checked in yet.", 409);
  }
}

async function listActiveVehicleRowsForReservations(
  supabase: SupabaseServerClient,
  reservationIds: string[],
): Promise<GuestVehicleDbRow[]> {
  const ids = Array.from(new Set(reservationIds.filter(Boolean)));
  if (ids.length === 0) return [];

  return listVehicleRows(
    supabase,
    supabase
      .from("guest_vehicles")
      .select("*")
      .in("reservation_id", ids)
      .is("checked_out_at", null),
  );
}

export async function createVehicleLinks(
  supabase: SupabaseServerClient,
  input: CreateVehicleInput,
): Promise<{
  vehicles: VehicleRecord[];
  created_count: number;
  skipped_count: number;
  skipped_reservation_ids: string[];
}> {
  const primaryReservation = await getReservationVehicleContext(supabase, input.reservationId);
  validateVehicleReservationContext(primaryReservation);

  const targetReservations = input.groupLink && primaryReservation.booking_group_id
    ? await listActiveGroupReservations(supabase, primaryReservation.booking_group_id)
    : [primaryReservation];

  if (targetReservations.length === 0) {
    throw makeVehicleError("No active reservations available for vehicle link.", 409);
  }

  for (const reservation of targetReservations) {
    validateVehicleReservationContext(reservation);
  }

  const newVehicleKey = buildDistinctVehicleKey({
    vehicle_type: input.vehicleType,
    plate_number: input.plateNumber ?? null,
    plate_country: input.plateCountry ?? "TH",
    description: input.description ?? null,
    vehicle_brand: input.vehicleBrand ?? null,
    vehicle_model: input.vehicleModel ?? null,
  });

  const existingRows = await listActiveVehicleRowsForReservations(
    supabase,
    targetReservations.map((reservation) => reservation.id),
  );

  const existingKeysByReservation = new Map<string, Set<string>>();
  for (const row of existingRows) {
    if (!existingKeysByReservation.has(row.reservation_id)) {
      existingKeysByReservation.set(row.reservation_id, new Set());
    }
    existingKeysByReservation.get(row.reservation_id)?.add(
      buildDistinctVehicleKey({
        vehicle_type: row.vehicle_type,
        plate_number: row.plate_number,
        plate_country: row.plate_country,
        description: row.description,
        vehicle_brand: row.vehicle_brand,
        vehicle_model: row.vehicle_model,
      }),
    );
  }

  const rowsToInsert: VehicleInsertRow[] = [];
  const skippedReservationIds: string[] = [];

  for (const reservation of targetReservations) {
    const existingKeys = existingKeysByReservation.get(reservation.id) ?? new Set<string>();
    if (existingKeys.has(newVehicleKey)) {
      skippedReservationIds.push(reservation.id);
      continue;
    }

    rowsToInsert.push({
      reservation_id: reservation.id,
      guest_profile_id: reservation.guest_profile_id ?? null,
      room_id: reservation.current_room_id ?? null,
      room_number: reservation.current_room_number ?? null,
      booking_code: reservation.booking_code ?? null,
      guest_name: reservation.guest_name ?? null,
      vehicle_type: input.vehicleType,
      plate_number: normalizePlateNumber(input.plateNumber) ?? null,
      plate_province: normalizeText(input.plateProvince) ?? null,
      plate_country: input.plateCountry ?? "TH",
      vehicle_brand: normalizeText(input.vehicleBrand) ?? null,
      vehicle_model: normalizeText(input.vehicleModel) ?? null,
      vehicle_color: input.vehicleColor ?? "white",
      description: normalizeText(input.description) ?? null,
      registered_at: new Date().toISOString(),
      registered_by: normalizeText(input.actorName) ?? null,
      checked_out_at: null,
    });
  }

  if (rowsToInsert.length === 0) {
    return {
      vehicles: [],
      created_count: 0,
      skipped_count: skippedReservationIds.length,
      skipped_reservation_ids: skippedReservationIds,
    };
  }

  const { data, error } = await supabase
    .from("guest_vehicles")
    .insert(rowsToInsert)
    .select("*");

  if (error) {
    throw makeVehicleError(error.message, 500);
  }

  return {
    vehicles: await enrichVehicleRows(supabase, ((data ?? []) as any[]).map(mapRawVehicleRow)),
    created_count: rowsToInsert.length,
    skipped_count: skippedReservationIds.length,
    skipped_reservation_ids: skippedReservationIds,
  };
}

export async function updateVehicle(
  supabase: SupabaseServerClient,
  vehicleId: string,
  updates: Partial<{
    vehicle_type: VehicleType;
    plate_number: string | null;
    plate_province: string | null;
    plate_country: VehicleCountry;
    vehicle_brand: string | null;
    vehicle_model: string | null;
    vehicle_color: VehicleColor;
    description: string | null;
  }>,
): Promise<VehicleRecord> {
  const payload: Record<string, unknown> = {};
  if (updates.vehicle_type !== undefined) payload.vehicle_type = updates.vehicle_type;
  if (updates.plate_number !== undefined) payload.plate_number = normalizePlateNumber(updates.plate_number) ?? null;
  if (updates.plate_province !== undefined) payload.plate_province = normalizeText(updates.plate_province) ?? null;
  if (updates.plate_country !== undefined) payload.plate_country = updates.plate_country;
  if (updates.vehicle_brand !== undefined) payload.vehicle_brand = normalizeText(updates.vehicle_brand) ?? null;
  if (updates.vehicle_model !== undefined) payload.vehicle_model = normalizeText(updates.vehicle_model) ?? null;
  if (updates.vehicle_color !== undefined) payload.vehicle_color = updates.vehicle_color;
  if (updates.description !== undefined) payload.description = normalizeText(updates.description) ?? null;

  const { data, error } = await supabase
    .from("guest_vehicles")
    .update(payload)
    .eq("id", vehicleId)
    .select("*")
    .maybeSingle();

  if (error) {
    throw makeVehicleError(error.message, 500);
  }
  if (!data) {
    throw makeVehicleError("Vehicle not found.", 404);
  }

  const [vehicle] = await enrichVehicleRows(supabase, [mapRawVehicleRow(data)]);
  if (!vehicle) {
    throw makeVehicleError("Vehicle not found.", 404);
  }
  return vehicle;
}

export async function unlinkVehicle(
  supabase: SupabaseServerClient,
  vehicleId: string,
  when = new Date().toISOString(),
): Promise<VehicleRecord> {
  const { data, error } = await supabase
    .from("guest_vehicles")
    .update({
      checked_out_at: when,
      updated_at: when,
    })
    .eq("id", vehicleId)
    .is("checked_out_at", null)
    .select("*")
    .maybeSingle();

  if (error) {
    throw makeVehicleError(error.message, 500);
  }

  if (data) {
    const [vehicle] = await enrichVehicleRows(supabase, [mapRawVehicleRow(data)]);
    if (vehicle) return vehicle;
  }

  const existing = await getVehicleById(supabase, vehicleId);
  if (!existing) {
    throw makeVehicleError("Vehicle not found.", 404);
  }
  return existing;
}

export async function markReservationVehiclesCheckedOut(
  supabase: SupabaseServerClient,
  reservationId: string,
  checkedOutAt = new Date().toISOString(),
): Promise<number> {
  const { data, error } = await supabase
    .from("guest_vehicles")
    .update({
      checked_out_at: checkedOutAt,
      updated_at: checkedOutAt,
    })
    .eq("reservation_id", reservationId)
    .is("checked_out_at", null)
    .select("id");

  if (error) {
    throw makeVehicleError(error.message, 500);
  }

  return (data ?? []).length;
}
