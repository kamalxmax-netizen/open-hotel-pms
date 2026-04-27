import { fromSatang, toSatang } from "@/lib/money";
import { normalizeAuditSource } from "@/lib/audit-utils";
import { syncReservationBookingNameAlias } from "@/lib/guest-booking-names";
import { syncExpectedArrivalAlert } from "@/lib/expected-arrival-alert";
import { extractBookedNameFromProfileNotes } from "@/lib/guest-name-match";
import { createServerSupabaseClient } from "@/lib/supabase/server";

export type PaymentMethod = "cash" | "transfer" | "credit_card";
export type DepositPolicy = "keep" | "set";
export type DepositCollectionMode = "separate" | "combined";

const HK_BLOCKED_CHECKIN_STATUSES = new Set(["dirty", "in_progress", "paused"]);
const ROOM_OCCUPIED_BACK_TO_BACK_CODE = "BACK_TO_BACK_DUE_OUT_PENDING_CHECKOUT";
const ROOM_OCCUPIED_INHOUSE_CODE = "ROOM_OCCUPIED_INHOUSE";
const PAYMENT_METHODS = new Set<PaymentMethod>(["cash", "transfer", "credit_card"]);

type SupabaseClientLike = ReturnType<typeof createServerSupabaseClient>;

type ValidationResult = { ok: true } | { ok: false; error: string; code: string };

type GroupCheckinValidationCandidate = {
  reservationId: string;
  roomId: string;
  guestProfileId: string;
  reservation: any;
};

type RoomConflictRow = {
  id: string;
  booking_code: string | null;
  guest_name: string | null;
  checkin_date: string | null;
  checkout_date: string | null;
  checked_in_at: unknown;
};

type HkReadinessResult =
  | { ok: true; taskId?: string; status?: string }
  | { ok: false; error: string; code: "hk_not_ready" };

export type MassPaymentInput = {
  method: PaymentMethod;
  amount: number;
  note?: string | null;
};

export type MassItemInput = {
  reservation_id: string;
  checked_in_at?: string | null;
  checkin_time?: string | null;
  deposit_policy?: DepositPolicy;
  deposit_collection_mode?: DepositCollectionMode;
  deposit_method?: PaymentMethod;
  deposit_amount?: number;
  deposit_note?: string | null;
  payments?: MassPaymentInput[];
};

type MassPayment = {
  method: PaymentMethod;
  amount: number;
  note: string | null;
};

type MassItem = {
  reservationId: string;
  checkedInAtDate: Date | null;
  checkinTime: string | null;
  depositPolicy: DepositPolicy;
  depositCollectionMode: DepositCollectionMode;
  depositMethod: PaymentMethod | null;
  depositAmount: number;
  depositNote: string | null;
  payments: MassPayment[];
};

export type GroupMassCheckinResultRow = {
  reservation_id: string;
  booking_code: string | null;
  guest_name: string | null;
  ok: boolean;
  error?: string;
  code?: string;
  checked_in_at?: string;
  checkin_time?: string;
  payments_recorded?: number;
  payment_amount?: number;
  deposit_policy?: DepositPolicy;
};

export type GroupMassCheckinResult = {
  success: boolean;
  summary: {
    requested: number;
    processed: number;
    success: number;
    failed: number;
  };
  results: GroupMassCheckinResultRow[];
};

function toLocalDate(d: Date, tz = "Asia/Bangkok"): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: tz }).format(d);
}

async function resolveBusinessDate(
  supabase: SupabaseClientLike,
  fallbackDate: string
): Promise<string> {
  const { data, error } = await supabase
    .from("hotel_settings")
    .select("business_date")
    .eq("id", 1)
    .maybeSingle();

  if (error) return fallbackDate;
  const value = String((data as any)?.business_date ?? "").trim();
  return /^\d{4}-\d{2}-\d{2}$/.test(value) ? value : fallbackDate;
}

function toLocalTime(d: Date, tz = "Asia/Bangkok"): string {
  return new Intl.DateTimeFormat("en-GB", {
    timeZone: tz,
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(d);
}

function normalizePaymentMethod(raw: unknown): PaymentMethod | null {
  if (raw === "cash" || raw === "transfer" || raw === "credit_card") {
    return raw;
  }
  if (raw === "card") return "credit_card";
  return null;
}

function isValidHHmm(value: string): boolean {
  return /^\d{2}:\d{2}$/.test(value);
}

function toNonNegativeMoney(value: unknown): { satang: number; amount: number } {
  const satang = toSatang(value);
  return { satang, amount: fromSatang(satang) };
}

function uniqueStrings(values: string[]): string[] {
  return Array.from(new Set(values.filter((value) => value.trim().length > 0)));
}

function buildRoomOccupancyFailure(conflict: RoomConflictRow, stayDate: string): ValidationResult {
  const isDueOutToday = String(conflict.checkout_date ?? "") === stayDate;
  const guestSuffix = conflict.guest_name ? ` ${conflict.guest_name}` : "";
  const bookingSuffix = conflict.booking_code ? ` (${conflict.booking_code})` : "";
  const occupiedBy = isDueOutToday ? "due-out guest" : "in-house guest";
  return {
    ok: false,
    error: `Room is still occupied by ${occupiedBy}${guestSuffix}${bookingSuffix}. Save Draft first, then check in again after checkout and housekeeping approval.`,
    code: isDueOutToday ? ROOM_OCCUPIED_BACK_TO_BACK_CODE : ROOM_OCCUPIED_INHOUSE_CODE,
  };
}

async function loadBulkPrimaryGuestConflicts(
  supabase: SupabaseClientLike,
  candidates: GroupCheckinValidationCandidate[]
): Promise<Map<string, ValidationResult>> {
  const result = new Map<string, ValidationResult>();
  const profileIds = uniqueStrings(candidates.map((candidate) => candidate.guestProfileId));

  for (const candidate of candidates) {
    if (candidate.guestProfileId) result.set(candidate.reservationId, { ok: true });
  }
  if (profileIds.length === 0) return result;

  const { data: rows, error } = await supabase
    .from("reservation_guests")
    .select(`
      reservation_id,
      guest_profile_id,
      reservations!inner(
        id,
        booking_code,
        guest_name,
        status,
        checked_in_at
      )
    `)
    .in("guest_profile_id", profileIds)
    .eq("role", "primary");

  if (error) {
    for (const candidate of candidates) {
      if (candidate.guestProfileId) {
        result.set(candidate.reservationId, {
          ok: false,
          error: error.message ?? "Failed to validate primary guest check-in conflict.",
          code: "primary_guest_already_checked_in",
        });
      }
    }
    return result;
  }

  const rowsByProfileId = new Map<string, any[]>();
  const pendingIdsByProfileId = new Map<string, Set<string>>();
  const checkedInReservationIds = new Set<string>();
  const profileIdsWithLogError = new Set<string>();

  for (const row of rows ?? []) {
    const profileId = String((row as any)?.guest_profile_id ?? "");
    const reservationId = String((row as any)?.reservation_id ?? "");
    const reservation = Array.isArray((row as any)?.reservations)
      ? (row as any).reservations[0]
      : (row as any)?.reservations;
    if (!profileId || !reservationId || !reservation) continue;
    if (String(reservation.status ?? "") !== "active") continue;

    const bucket = rowsByProfileId.get(profileId) ?? [];
    bucket.push(row);
    rowsByProfileId.set(profileId, bucket);

    if (reservation.checked_in_at) {
      checkedInReservationIds.add(reservationId);
    } else {
      const pending = pendingIdsByProfileId.get(profileId) ?? new Set<string>();
      pending.add(reservationId);
      pendingIdsByProfileId.set(profileId, pending);
    }
  }

  const pendingIds = uniqueStrings(Array.from(pendingIdsByProfileId.values()).flatMap((set) => Array.from(set)));
  if (pendingIds.length > 0) {
    const { data: logs, error: logError } = await supabase
      .from("audit_logs")
      .select("entity_id")
      .eq("entity_type", "reservation")
      .eq("action", "checked_in")
      .in("entity_id", pendingIds);

    if (logError) {
      for (const candidate of candidates) {
        const profilePendingIds = pendingIdsByProfileId.get(candidate.guestProfileId);
        if (profilePendingIds && profilePendingIds.size > 0) {
          profileIdsWithLogError.add(candidate.guestProfileId);
          result.set(candidate.reservationId, {
            ok: false,
            error: logError.message ?? "Failed to validate checked-in audit logs.",
            code: "primary_guest_already_checked_in",
          });
        }
      }
    } else {
      for (const log of logs ?? []) {
        const entityId = String((log as any)?.entity_id ?? "").trim();
        if (entityId) checkedInReservationIds.add(entityId);
      }
    }
  }

  for (const candidate of candidates) {
    if (!candidate.guestProfileId) continue;
    if (profileIdsWithLogError.has(candidate.guestProfileId)) continue;
    const candidateRows = rowsByProfileId.get(candidate.guestProfileId) ?? [];
    const conflict = candidateRows.find((row: any) => {
      const reservationId = String(row?.reservation_id ?? "");
      return reservationId && reservationId !== candidate.reservationId && checkedInReservationIds.has(reservationId);
    });
    if (!conflict) continue;

    result.set(candidate.reservationId, {
      ok: false,
      error: "Primary guest is already checked in on another active reservation.",
      code: "primary_guest_already_checked_in",
    });
  }

  return result;
}

async function loadBulkRoomVacancy(
  supabase: SupabaseClientLike,
  candidates: GroupCheckinValidationCandidate[],
  stayDate: string
): Promise<Map<string, ValidationResult>> {
  const result = new Map<string, ValidationResult>();
  for (const candidate of candidates) result.set(candidate.reservationId, { ok: true });
  if (candidates.length === 0) return result;

  const failAll = (error: string): Map<string, ValidationResult> => {
    for (const candidate of candidates) {
      result.set(candidate.reservationId, { ok: false, error, code: "ROOM_OCCUPANCY_CHECK_FAILED" });
    }
    return result;
  };

  const { data: rowsData, error: candidatesError } = await supabase
    .from("reservations")
    .select("id, booking_code, guest_name, checkin_date, checkout_date, checked_in_at")
    .eq("status", "active")
    .lte("checkin_date", stayDate)
    .gte("checkout_date", stayDate);

  if (candidatesError) return failAll(candidatesError.message);

  const rows: RoomConflictRow[] = (rowsData ?? [])
    .map((row: any) => ({
      id: String(row.id ?? ""),
      booking_code: row.booking_code ? String(row.booking_code) : null,
      guest_name: row.guest_name ? String(row.guest_name) : null,
      checkin_date: row.checkin_date ? String(row.checkin_date) : null,
      checkout_date: row.checkout_date ? String(row.checkout_date) : null,
      checked_in_at: row.checked_in_at ?? null,
    }))
    .filter((row) => row.id);

  if (rows.length === 0) return result;

  const checkedInIds = new Set<string>();
  const pendingLogLookupIds: string[] = [];
  for (const row of rows) {
    if (row.checked_in_at) {
      checkedInIds.add(row.id);
      continue;
    }
    if (row.checkin_date && row.checkin_date < stayDate) {
      checkedInIds.add(row.id);
      continue;
    }
    pendingLogLookupIds.push(row.id);
  }

  if (pendingLogLookupIds.length > 0) {
    const { data: checkinLogs, error: checkinLogError } = await supabase
      .from("audit_logs")
      .select("entity_id")
      .eq("entity_type", "reservation")
      .eq("action", "checked_in")
      .in("entity_id", uniqueStrings(pendingLogLookupIds));
    if (checkinLogError) return failAll(checkinLogError.message);

    for (const log of checkinLogs ?? []) {
      const id = String((log as any).entity_id ?? "");
      if (id) checkedInIds.add(id);
    }
  }

  const checkedInCandidateIds = rows.map((row) => row.id).filter((id) => checkedInIds.has(id));
  if (checkedInCandidateIds.length === 0) return result;

  const { data: nights, error: nightsError } = await supabase
    .from("reservation_nights")
    .select("reservation_id, room_id, stay_date")
    .in("reservation_id", checkedInCandidateIds)
    .is("cancelled_at", null)
    .lte("stay_date", stayDate);

  if (nightsError) return failAll(nightsError.message);

  const latestRoomByReservation = new Map<string, { stay_date: string; room_id: string }>();
  for (const night of nights ?? []) {
    const reservationId = String((night as any).reservation_id ?? "");
    const nightRoomId = String((night as any).room_id ?? "");
    const nightDate = String((night as any).stay_date ?? "");
    if (!reservationId || !nightRoomId || !nightDate) continue;
    const current = latestRoomByReservation.get(reservationId);
    if (!current || nightDate > current.stay_date) {
      latestRoomByReservation.set(reservationId, { stay_date: nightDate, room_id: nightRoomId });
    }
  }

  for (const candidate of candidates) {
    const conflict = rows.find((row) => {
      if (row.id === candidate.reservationId) return false;
      if (!checkedInIds.has(row.id)) return false;
      const latest = latestRoomByReservation.get(row.id);
      return latest?.room_id === candidate.roomId;
    });
    if (conflict) result.set(candidate.reservationId, buildRoomOccupancyFailure(conflict, stayDate));
  }

  return result;
}

function markRoomOccupiedInVacancyMap(
  vacancyByReservationId: Map<string, ValidationResult>,
  candidates: GroupCheckinValidationCandidate[],
  roomId: string,
  conflict: RoomConflictRow,
  stayDate: string
): void {
  const failure = buildRoomOccupancyFailure(conflict, stayDate);
  for (const candidate of candidates) {
    if (candidate.roomId === roomId) vacancyByReservationId.set(candidate.reservationId, failure);
  }
}

async function loadBulkHkReadiness(
  supabase: SupabaseClientLike,
  candidates: GroupCheckinValidationCandidate[],
  stayDate: string
): Promise<Map<string, HkReadinessResult>> {
  const result = new Map<string, HkReadinessResult>();
  const roomIds = uniqueStrings(candidates.map((candidate) => candidate.roomId));
  for (const roomId of roomIds) result.set(roomId, { ok: true });
  if (roomIds.length === 0) return result;

  const { data: hkTasks, error: hkTaskError } = await supabase
    .from("housekeeping_tasks")
    .select("id, room_id, status")
    .in("room_id", roomIds)
    .eq("stay_date", stayDate);

  if (hkTaskError) {
    for (const roomId of roomIds) {
      result.set(roomId, { ok: false, error: hkTaskError.message, code: "hk_not_ready" });
    }
    return result;
  }

  const tasksByRoomId = new Map<string, any[]>();
  for (const task of hkTasks ?? []) {
    const roomId = String((task as any).room_id ?? "");
    if (!roomId || !roomIds.includes(roomId)) continue;
    const bucket = tasksByRoomId.get(roomId) ?? [];
    bucket.push(task);
    tasksByRoomId.set(roomId, bucket);
  }

  for (const roomId of roomIds) {
    const tasks = tasksByRoomId.get(roomId) ?? [];
    if (tasks.length === 0) continue;
    if (tasks.length > 1) {
      result.set(roomId, {
        ok: false,
        error: "Multiple housekeeping tasks found for room/date.",
        code: "hk_not_ready",
      });
      continue;
    }

    const task = tasks[0];
    const hkStatus = String(task.status ?? "");
    if (HK_BLOCKED_CHECKIN_STATUSES.has(hkStatus)) {
      result.set(roomId, {
        ok: false,
        error: `Room is not ready for check-in (HK status: ${hkStatus}).`,
        code: "hk_not_ready",
      });
      continue;
    }

    result.set(roomId, {
      ok: true,
      taskId: task.id ? String(task.id) : undefined,
      status: hkStatus,
    });
  }

  return result;
}

export async function ensureHousekeepingReadyForCheckin(
  supabase: SupabaseClientLike,
  roomId: string,
  stayDate: string
): Promise<{ ok: true } | { ok: false; error: string; code: "hk_not_ready" }> {
  const { data: hkTask, error: hkTaskError } = await supabase
    .from("housekeeping_tasks")
    .select("id, status")
    .eq("room_id", roomId)
    .eq("stay_date", stayDate)
    .maybeSingle();

  if (hkTaskError && hkTaskError.code !== "PGRST116") {
    return { ok: false, error: hkTaskError.message, code: "hk_not_ready" };
  }

  if (!hkTask) return { ok: true };

  const hkStatus = String(hkTask.status ?? "");
  if (HK_BLOCKED_CHECKIN_STATUSES.has(hkStatus)) {
    return { ok: false, error: `Room is not ready for check-in (HK status: ${hkStatus}).`, code: "hk_not_ready" };
  }

  if (hkStatus === "cleaned") {
    const approvedAt = new Date().toISOString();
    const { error: approveError } = await supabase
      .from("housekeeping_tasks")
      .update({
        status: "approved",
        approved_at: approvedAt,
      })
      .eq("id", hkTask.id);

    if (approveError) {
      return { ok: false, error: approveError.message, code: "hk_not_ready" };
    }

    await supabase
      .from("housekeeping_logs")
      .insert({
        task_id: hkTask.id,
        status: "approved",
        note: "auto-approved at group check-in",
      });
  }

  return { ok: true };
}

export async function ensureRoomVacantForCheckin(
  supabase: SupabaseClientLike,
  roomId: string,
  stayDate: string,
  currentReservationId: string
): Promise<{ ok: true } | { ok: false; error: string; code: string }> {
  const { data: candidates, error: candidatesError } = await supabase
    .from("reservations")
    .select("id, booking_code, guest_name, checkin_date, checkout_date, checked_in_at")
    .eq("status", "active")
    .neq("id", currentReservationId)
    .lte("checkin_date", stayDate)
    .gte("checkout_date", stayDate);

  if (candidatesError) {
    return { ok: false, error: candidatesError.message, code: "ROOM_OCCUPANCY_CHECK_FAILED" };
  }

  const rows = (candidates ?? [])
    .map((row: any) => ({
      id: String(row.id ?? ""),
      booking_code: row.booking_code ? String(row.booking_code) : null,
      guest_name: row.guest_name ? String(row.guest_name) : null,
      checkin_date: row.checkin_date ? String(row.checkin_date) : null,
      checkout_date: row.checkout_date ? String(row.checkout_date) : null,
      checked_in_at: row.checked_in_at ?? null,
    }))
    .filter((row) => row.id);

  if (rows.length === 0) return { ok: true };

  const checkedInIds = new Set<string>();
  const pendingLogLookupIds: string[] = [];
  for (const row of rows) {
    if (row.checked_in_at) {
      checkedInIds.add(row.id);
      continue;
    }
    if (row.checkin_date && row.checkin_date < stayDate) {
      checkedInIds.add(row.id);
      continue;
    }
    pendingLogLookupIds.push(row.id);
  }

  if (pendingLogLookupIds.length > 0) {
    const { data: checkinLogs, error: checkinLogError } = await supabase
      .from("audit_logs")
      .select("entity_id")
      .eq("entity_type", "reservation")
      .eq("action", "checked_in")
      .in("entity_id", pendingLogLookupIds);
    if (checkinLogError) {
      return { ok: false, error: checkinLogError.message, code: "ROOM_OCCUPANCY_CHECK_FAILED" };
    }
    for (const log of checkinLogs ?? []) {
      const id = String((log as any).entity_id ?? "");
      if (id) checkedInIds.add(id);
    }
  }

  const checkedInCandidateIds = rows.map((row) => row.id).filter((id) => checkedInIds.has(id));
  if (checkedInCandidateIds.length === 0) return { ok: true };

  const { data: nights, error: nightsError } = await supabase
    .from("reservation_nights")
    .select("reservation_id, room_id, stay_date")
    .in("reservation_id", checkedInCandidateIds)
    .is("cancelled_at", null)
    .lte("stay_date", stayDate);

  if (nightsError) {
    return { ok: false, error: nightsError.message, code: "ROOM_OCCUPANCY_CHECK_FAILED" };
  }

  const latestRoomByReservation = new Map<string, { stay_date: string; room_id: string }>();
  for (const night of nights ?? []) {
    const reservationId = String((night as any).reservation_id ?? "");
    const nightRoomId = String((night as any).room_id ?? "");
    const nightDate = String((night as any).stay_date ?? "");
    if (!reservationId || !nightRoomId || !nightDate) continue;
    const current = latestRoomByReservation.get(reservationId);
    if (!current || nightDate > current.stay_date) {
      latestRoomByReservation.set(reservationId, { stay_date: nightDate, room_id: nightRoomId });
    }
  }

  const conflict = rows.find((row) => {
    if (!checkedInIds.has(row.id)) return false;
    const latest = latestRoomByReservation.get(row.id);
    return latest?.room_id === roomId;
  });

  if (!conflict) return { ok: true };

  return buildRoomOccupancyFailure(conflict, stayDate);
}

function normalizeMassItems(rawItems: unknown[]): { items: MassItem[]; error?: string } {
  const normalizedItems: MassItem[] = [];
  const seenReservationIds = new Set<string>();

  for (let i = 0; i < rawItems.length; i++) {
    const raw = (rawItems[i] ?? {}) as Record<string, unknown>;
    const reservationId = String(raw.reservation_id ?? "").trim();
    if (!reservationId) {
      return { items: [], error: `items[${i}].reservation_id is required.` };
    }
    if (seenReservationIds.has(reservationId)) continue;
    seenReservationIds.add(reservationId);

    const checkinTimeRaw = typeof raw.checkin_time === "string" ? raw.checkin_time.trim() : "";
    if (checkinTimeRaw && !isValidHHmm(checkinTimeRaw)) {
      return { items: [], error: `items[${i}].checkin_time must be HH:mm.` };
    }

    const checkedInAtRaw = typeof raw.checked_in_at === "string" ? raw.checked_in_at : null;
    const checkedInAtDate = checkedInAtRaw ? new Date(checkedInAtRaw) : null;
    if (checkedInAtDate && Number.isNaN(checkedInAtDate.getTime())) {
      return { items: [], error: `items[${i}].checked_in_at is invalid.` };
    }

    const depositPolicy: DepositPolicy = raw.deposit_policy === "set" ? "set" : "keep";
    const depositCollectionMode: DepositCollectionMode = raw.deposit_collection_mode === "combined" ? "combined" : "separate";
    const depositMethod = normalizePaymentMethod(raw.deposit_method);
    const depositMoney = toNonNegativeMoney(raw.deposit_amount ?? 0);
    const depositNote =
      typeof raw.deposit_note === "string" && raw.deposit_note.trim() ? raw.deposit_note.trim() : null;

    const paymentsRaw = Array.isArray(raw.payments) ? raw.payments : [];
    const payments: MassPayment[] = [];
    for (let p = 0; p < paymentsRaw.length; p++) {
      const paymentRaw = (paymentsRaw[p] ?? {}) as Record<string, unknown>;
      const method = normalizePaymentMethod(paymentRaw.method);
      if (!method || !PAYMENT_METHODS.has(method)) {
        return { items: [], error: `items[${i}].payments[${p}].method is invalid.` };
      }
      const paymentMoney = toNonNegativeMoney(paymentRaw.amount);
      if (paymentMoney.satang < 0) {
        return { items: [], error: `items[${i}].payments[${p}].amount must be >= 0.` };
      }
      if (paymentMoney.satang === 0) continue;
      const note = typeof paymentRaw.note === "string" && paymentRaw.note.trim() ? paymentRaw.note.trim() : null;
      payments.push({ method, amount: paymentMoney.amount, note });
    }

    normalizedItems.push({
      reservationId,
      checkedInAtDate,
      checkinTime: checkinTimeRaw || null,
      depositPolicy,
      depositCollectionMode,
      depositMethod,
      depositAmount: depositMoney.amount,
      depositNote,
      payments,
    });
  }

  return { items: normalizedItems };
}

export async function runGroupMassCheckin(params: {
  supabase: SupabaseClientLike;
  groupId: string;
  rawItems: unknown[];
  strictDueIn?: boolean;
  todayOverride?: string;
}): Promise<{ ok: true; data: GroupMassCheckinResult } | { ok: false; status: number; error: string }> {
  const { supabase, groupId, rawItems } = params;
  const strictDueIn = params.strictDueIn !== false;

  if (!groupId) return { ok: false, status: 400, error: "Missing group ID." };
  if (!Array.isArray(rawItems) || rawItems.length === 0) {
    return { ok: false, status: 400, error: "items is required and must be a non-empty array." };
  }

  const normalized = normalizeMassItems(rawItems);
  if (normalized.error) return { ok: false, status: 400, error: normalized.error };
  const items = normalized.items;
  if (items.length === 0) return { ok: false, status: 400, error: "No valid reservation items to process." };

  const reservationIds = items.map((item) => item.reservationId);
  const { data: reservations, error: reservationError } = await supabase
    .from("reservations")
    .select("id, booking_code, booking_group_id, status, checkin_date, guest_name, guest_profile_id")
    .in("id", reservationIds);

  if (reservationError) return { ok: false, status: 500, error: reservationError.message };

  const reservationById = new Map<string, any>();
  (reservations ?? []).forEach((row: any) => reservationById.set(String(row.id), row));

  const { data: checkinLogs, error: logError } = await supabase
    .from("audit_logs")
    .select("entity_id")
    .eq("entity_type", "reservation")
    .eq("action", "checked_in")
    .in("entity_id", reservationIds);

  if (logError) return { ok: false, status: 500, error: logError.message };
  const alreadyCheckedIn = new Set<string>((checkinLogs ?? []).map((row: any) => String(row.entity_id)));

  const { data: reservationNights, error: nightsError } = await supabase
    .from("reservation_nights")
    .select("reservation_id, room_id")
    .in("reservation_id", reservationIds)
    .is("cancelled_at", null);

  if (nightsError) return { ok: false, status: 500, error: nightsError.message };

  const roomIdByReservation = new Map<string, string>();
  (reservationNights ?? []).forEach((night: any) => {
    const reservationId = night?.reservation_id ? String(night.reservation_id) : "";
    const roomId = night?.room_id ? String(night.room_id) : "";
    if (!reservationId || !roomId) return;
    if (!roomIdByReservation.has(reservationId)) roomIdByReservation.set(reservationId, roomId);
  });

  const today = params.todayOverride || await resolveBusinessDate(supabase, toLocalDate(new Date()));
  const validationCandidates: GroupCheckinValidationCandidate[] = [];
  for (const item of items) {
    const reservation = reservationById.get(item.reservationId);
    if (!reservation) continue;
    if (!reservation.booking_group_id || String(reservation.booking_group_id) !== groupId) continue;
    if (reservation.status !== "active") continue;
    if (strictDueIn && String(reservation.checkin_date) !== today) continue;
    if (alreadyCheckedIn.has(item.reservationId)) continue;
    const roomId = roomIdByReservation.get(item.reservationId) ?? null;
    if (!roomId) continue;
    validationCandidates.push({
      reservationId: item.reservationId,
      roomId,
      guestProfileId: reservation?.guest_profile_id ? String(reservation.guest_profile_id) : "",
      reservation,
    });
  }
  const primaryGuestConflicts = await loadBulkPrimaryGuestConflicts(supabase, validationCandidates);
  const roomVacancyByReservation = await loadBulkRoomVacancy(supabase, validationCandidates, today);
  const hkReadinessByRoom = await loadBulkHkReadiness(supabase, validationCandidates, today);
  const results: GroupMassCheckinResultRow[] = [];
  const processedPrimaryGuestProfileIds = new Set<string>();

  for (const item of items) {
    const reservation = reservationById.get(item.reservationId);
    const resultBase = {
      reservation_id: item.reservationId,
      booking_code: reservation?.booking_code ?? null,
      guest_name: reservation?.guest_name ?? null,
    };

    if (!reservation) {
      results.push({ ...resultBase, ok: false, error: "Reservation not found." });
      continue;
    }
    if (!reservation.booking_group_id || String(reservation.booking_group_id) !== groupId) {
      results.push({ ...resultBase, ok: false, error: "Reservation does not belong to this group." });
      continue;
    }
    if (reservation.status !== "active") {
      results.push({ ...resultBase, ok: false, error: `Reservation status is ${reservation.status}.` });
      continue;
    }
    if (strictDueIn && String(reservation.checkin_date) !== today) {
      results.push({ ...resultBase, ok: false, error: `Reservation is not due-in today (${today}).` });
      continue;
    }
    if (alreadyCheckedIn.has(item.reservationId)) {
      results.push({ ...resultBase, ok: false, error: "Reservation already checked in." });
      continue;
    }

    const roomId = roomIdByReservation.get(item.reservationId) ?? null;
    if (!roomId) {
      results.push({ ...resultBase, ok: false, error: "Room is not assigned." });
      continue;
    }

    const guestProfileId = reservation?.guest_profile_id ? String(reservation.guest_profile_id) : "";
    if (guestProfileId && processedPrimaryGuestProfileIds.has(guestProfileId)) {
      results.push({
        ...resultBase,
        ok: false,
        error: "Primary guest is selected on more than one room in this group check-in batch.",
        code: "primary_guest_already_checked_in",
      });
      continue;
    }
    if (guestProfileId) {
      const primaryGuestConflict = primaryGuestConflicts.get(item.reservationId) ?? { ok: true };
      if (!primaryGuestConflict.ok) {
        results.push({
          ...resultBase,
          ok: false,
          error: primaryGuestConflict.error,
          code: primaryGuestConflict.code,
        });
        continue;
      }
    }

    const checkedInDate = item.checkedInAtDate ?? new Date();
    const checkedInAtIso = checkedInDate.toISOString();
    const checkinTime = item.checkinTime || toLocalTime(checkedInDate);
    const roomVacant = roomVacancyByReservation.get(item.reservationId) ?? { ok: true };
    if (!roomVacant.ok) {
      results.push({ ...resultBase, ok: false, error: roomVacant.error, code: roomVacant.code });
      continue;
    }

    const hkReady = hkReadinessByRoom.get(roomId) ?? { ok: true };
    if (!hkReady.ok) {
      results.push({ ...resultBase, ok: false, error: hkReady.error, code: hkReady.code });
      continue;
    }
    if (hkReady.status === "cleaned" && hkReady.taskId) {
      const approvedAt = new Date().toISOString();
      const { error: approveError } = await supabase
        .from("housekeeping_tasks")
        .update({
          status: "approved",
          approved_at: approvedAt,
        })
        .eq("id", hkReady.taskId);

      if (approveError) {
        results.push({ ...resultBase, ok: false, error: approveError.message, code: "hk_not_ready" });
        continue;
      }

      await supabase
        .from("housekeeping_logs")
        .insert({
          task_id: hkReady.taskId,
          status: "approved",
          note: "auto-approved at group check-in",
        });

      hkReadinessByRoom.set(roomId, { ok: true, taskId: hkReady.taskId, status: "approved" });
    }

    const updatePayload: Record<string, any> = { checkin_time: checkinTime };
    if (item.depositPolicy === "set") {
      updatePayload.deposit_amount = item.depositAmount;
      updatePayload.deposit_note = item.depositNote;
      updatePayload.deposit_paid_at = item.depositAmount > 0 ? checkedInAtIso : null;
    }

    let checkedInAtPersisted = true;
    let vacancyMapUpdated = false;
    const updateWithCheckedInAt = await supabase
      .from("reservations")
      .update({ ...updatePayload, checked_in_at: checkedInAtIso })
      .eq("id", item.reservationId);

    let reservationUpdateError = updateWithCheckedInAt.error;
    if (reservationUpdateError && /checked_in_at/i.test(reservationUpdateError.message)) {
      checkedInAtPersisted = false;
      const fallback = await supabase.from("reservations").update(updatePayload).eq("id", item.reservationId);
      reservationUpdateError = fallback.error;
    }

    if (reservationUpdateError) {
      results.push({ ...resultBase, ok: false, error: reservationUpdateError.message });
      continue;
    }
    if (checkedInAtPersisted) {
      markRoomOccupiedInVacancyMap(
        roomVacancyByReservation,
        validationCandidates,
        roomId,
        {
          id: item.reservationId,
          booking_code: reservation?.booking_code ? String(reservation.booking_code) : null,
          guest_name: reservation?.guest_name ? String(reservation.guest_name) : null,
          checkin_date: reservation?.checkin_date ? String(reservation.checkin_date) : null,
          checkout_date: reservation?.checkout_date ? String(reservation.checkout_date) : null,
          checked_in_at: checkedInAtIso,
        },
        today
      );
      vacancyMapUpdated = true;
    }

    const folioRows: Array<Record<string, unknown>> = [];
    if (item.depositPolicy === "set" && item.depositAmount > 0) {
      const depositMethod =
        item.depositCollectionMode === "combined"
          ? item.payments[0]?.method ?? item.depositMethod ?? "cash"
          : item.depositMethod ?? "cash";
      folioRows.push({
        reservation_id: item.reservationId,
        tx_type: "deposit",
        method: depositMethod,
        amount: item.depositAmount,
        note: item.depositNote || "Deposit collected at group check-in",
        revenue_category: "deposit",
        cashier_name: "FO",
        paid_date: today,
        paid_at: checkedInAtIso,
      });
    }
    if (item.payments.length > 0) {
      item.payments.forEach((payment) => {
        folioRows.push({
          reservation_id: item.reservationId,
          tx_type: "payment",
          method: payment.method,
          amount: payment.amount,
          note: payment.note || "Paid at group check-in",
          revenue_category: "room_revenue",
          cashier_name: "FO",
          paid_date: today,
          paid_at: checkedInAtIso,
        });
      });
    }
    if (folioRows.length > 0) {
      const { error: paymentInsertError } = await supabase.from("folio_payments").insert(folioRows);
      if (paymentInsertError) {
        results.push({ ...resultBase, ok: false, error: paymentInsertError.message });
        continue;
      }
    }

    const paymentTotalSatang = item.payments.reduce((sum, payment) => sum + toSatang(payment.amount), 0);
    const paymentTotal = fromSatang(paymentTotalSatang);
    const { error: auditError } = await supabase
      .from("audit_logs")
      .insert({
        action: "checked_in",
        entity_type: "reservation",
        entity_id: item.reservationId,
        after_json: {
          guest_name: reservation.guest_name,
          checkin_date: reservation.checkin_date,
          checked_in_at: checkedInAtIso,
          mass_group_checkin: true,
          group_id: groupId,
          payment_methods: item.payments.map((payment) => payment.method),
          payment_count: item.payments.length,
          payment_amount: paymentTotal || null,
          deposit_policy: item.depositPolicy,
          deposit_amount: item.depositPolicy === "set" ? item.depositAmount : null,
        },
        business_date: today,
        source: normalizeAuditSource("manual"),
      });

    if (auditError) {
      results.push({ ...resultBase, ok: false, error: auditError.message });
      continue;
    }

    if (guestProfileId) {
      try {
        const profileName = await supabase
          .from("guest_profiles")
          .select("first_name, last_name, notes")
          .eq("id", guestProfileId)
          .maybeSingle();
        if (!profileName.error && profileName.data) {
          const profileNotes = String((profileName.data as any).notes ?? "").trim();
          const bookingNameForAlias = extractBookedNameFromProfileNotes(profileNotes) || reservation.guest_name;
          await syncReservationBookingNameAlias({
            supabase: supabase as any,
            guestProfileId,
            bookingName: bookingNameForAlias,
            actualName: `${String((profileName.data as any).first_name ?? "").trim()} ${String((profileName.data as any).last_name ?? "").trim()}`.trim(),
            sourceReservationId: item.reservationId,
            seenAt: checkedInAtIso,
          });
        }
      } catch {
        // Alias sync is best-effort in group flow; never roll back a successful check-in.
      }
    }

    try {
      await syncExpectedArrivalAlert({
        supabase: supabase as any,
        reservationId: item.reservationId,
        expectedArrivalTime: null,
      });
    } catch (error) {
      console.error("expected arrival alert auto-dismiss failed", error);
    }

    alreadyCheckedIn.add(item.reservationId);
    if (guestProfileId) processedPrimaryGuestProfileIds.add(guestProfileId);
    if (!vacancyMapUpdated) {
      markRoomOccupiedInVacancyMap(
        roomVacancyByReservation,
        validationCandidates,
        roomId,
        {
          id: item.reservationId,
          booking_code: reservation?.booking_code ? String(reservation.booking_code) : null,
          guest_name: reservation?.guest_name ? String(reservation.guest_name) : null,
          checkin_date: reservation?.checkin_date ? String(reservation.checkin_date) : null,
          checkout_date: reservation?.checkout_date ? String(reservation.checkout_date) : null,
          checked_in_at: checkedInAtIso,
        },
        today
      );
    }
    results.push({
      ...resultBase,
      ok: true,
      checked_in_at: checkedInAtIso,
      checkin_time: checkinTime,
      payments_recorded: item.payments.length,
      payment_amount: paymentTotal,
      deposit_policy: item.depositPolicy,
    });
  }

  const successCount = results.filter((result) => result.ok).length;
  const failedCount = results.length - successCount;

  return {
    ok: true,
    data: {
      success: failedCount === 0,
      summary: {
        requested: items.length,
        processed: results.length,
        success: successCount,
        failed: failedCount,
      },
      results,
    },
  };
}
