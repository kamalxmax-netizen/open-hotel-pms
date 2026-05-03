import type {
  AlertDailyStateRow,
  AlertItem,
  AlertRule,
  AlertRuleInput,
  AlertRuleOverlapResult,
  AlertsRangeDay,
  AlertsSummary,
  AlertSettings,
  AlertStatus,
  AlertsTodayResponse,
  BookingAlarm,
  BookingAlarmInput,
  NightAuditAlertCheckResponse,
} from "@/lib/types/alerts";
import { getAuthenticatedUser, getUserRole } from "@/lib/server-auth";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import type { NextRequest } from "next/server";

type SupabaseClientLike = ReturnType<typeof createServerSupabaseClient>;

type AlertsActor = {
  userId: string;
  role: string;
};

type BusinessDateContext = {
  businessDate: string;
  calendarDate: string;
  timezone: string;
};

type AlertSettingsPatch = Partial<AlertSettings>;

type AlertRuleDraft = AlertRuleInput;

type BookingAlarmPatch = Partial<Pick<BookingAlarmInput, "alarm_date" | "note">> & {
  action?: "complete";
  completion_note?: string;
};

type AlertSourceMaps = {
  ruleNames: Map<string, string>;
  alarmNotes: Map<string, string>;
};

type ReservationAlertRow = {
  id: string;
  booking_code: string | null;
  guest_name: string | null;
  guest_profile_id: string | null;
  booking_group_id: string | null;
  is_thai_manual: boolean | null;
  checkin_date: string;
  checkout_date: string;
  total_price: number | string | null;
  source: string | null;
  guest_profiles?: any;
  reservation_nights?: any[];
};

const READ_ROLES = new Set(["admin", "frontdesk", "supervisor", "manager", "owner"]);
const ADMIN_ROLES = new Set(["admin"]);

export async function requireAlertsReadAccess(request: NextRequest) {
  const supabase = createServerSupabaseClient();
  const actor = await getAuthenticatedUser(supabase, request);
  if (!actor) {
    return { ok: false as const, error: "Unauthorized." };
  }
  const role = (await getUserRole(supabase, actor.id)) ?? "";
  if (!READ_ROLES.has(role)) {
    return { ok: false as const, error: "Forbidden." };
  }
  return {
    ok: true as const,
    supabase,
    actor: { userId: actor.id, role } satisfies AlertsActor,
  };
}

export async function requireAlertsAdminAccess(request: NextRequest) {
  const supabase = createServerSupabaseClient();
  const actor = await getAuthenticatedUser(supabase, request);
  if (!actor) {
    return { ok: false as const, error: "Unauthorized." };
  }
  const role = (await getUserRole(supabase, actor.id)) ?? "";
  if (!ADMIN_ROLES.has(role)) {
    return { ok: false as const, error: "Forbidden." };
  }
  return {
    ok: true as const,
    supabase,
    actor: { userId: actor.id, role } satisfies AlertsActor,
  };
}

function toNumber(value: unknown, fallback = 0) {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim()) {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return fallback;
}

function toNullableString(value: unknown) {
  const normalized = String(value ?? "").trim();
  return normalized || null;
}

function isIsoDate(value: unknown): value is string {
  return /^\d{4}-\d{2}-\d{2}$/.test(String(value ?? "").trim());
}

function normalizeTime(value: unknown, fallback: string) {
  const normalized = String(value ?? "").trim();
  return /^\d{2}:\d{2}$/.test(normalized) ? normalized : fallback;
}

function addDays(date: string, offset: number) {
  const next = new Date(`${date}T00:00:00Z`);
  next.setUTCDate(next.getUTCDate() + offset);
  return next.toISOString().slice(0, 10);
}

function diffDays(start: string, end: string) {
  const startTime = Date.parse(`${start}T00:00:00Z`);
  const endTime = Date.parse(`${end}T00:00:00Z`);
  if (!Number.isFinite(startTime) || !Number.isFinite(endTime)) return 0;
  return Math.max(0, Math.round((endTime - startTime) / 86400000));
}

function formatCalendarDate(date: Date, timezone: string) {
  return new Intl.DateTimeFormat("en-CA", { timeZone: timezone }).format(date);
}

function firstRow<T>(value: T | T[] | null | undefined): T | null {
  if (Array.isArray(value)) return value[0] ?? null;
  return value ?? null;
}

function coerceAlertStatus(value: unknown): AlertStatus {
  const normalized = String(value ?? "").trim();
  if (
    normalized === "pending" ||
    normalized === "snoozed" ||
    normalized === "cleared_auto" ||
    normalized === "cleared_manual" ||
    normalized === "cleared_admin_override" ||
    normalized === "auto_cancelled_due_in"
  ) {
    return normalized;
  }
  return "pending";
}

function buildRoomLabel(reservation: ReservationAlertRow) {
  const numbers = Array.from(
    new Set(
      (reservation.reservation_nights ?? [])
        .filter((row: any) => row?.cancelled_at == null)
        .map((row: any) => {
          const room = firstRow(row?.rooms);
          const roomNumber = String(room?.room_number ?? "").trim();
          return roomNumber || null;
        })
        .filter(Boolean) as string[]
    )
  );

  if (numbers.length === 0) return null;
  if (numbers.length === 1) return numbers[0];
  return numbers.join(", ");
}

function isThaiCustomer(reservation: ReservationAlertRow) {
  const profile = firstRow(reservation.guest_profiles) as any;
  if (reservation.is_thai_manual === true) return true;
  const nationalityCode = String(profile?.nationality_code ?? "").trim().toUpperCase();
  if (nationalityCode === "TH" || nationalityCode === "THA") return true;
  const nationality = String(profile?.nationality ?? "").trim().toLowerCase();
  if (nationality === "thai" || nationality === "thailand" || nationality === "ไทย" || nationality === "ประเทศไทย") return true;
  const fullName = `${String(profile?.first_name ?? "")} ${String(profile?.last_name ?? "")}`;
  if (/[\u0E00-\u0E7F]/.test(fullName)) return true;
  return /[\u0E00-\u0E7F]/.test(String(reservation.guest_name ?? ""));
}

function mapAlertRuleRow(row: any): AlertRule {
  return {
    id: String(row.id),
    name: String(row.name ?? ""),
    is_active: Boolean(row.is_active),
    trigger_mode: row.trigger_mode === "date_range" ? "date_range" : "all_year",
    date_start: row.date_start ? String(row.date_start) : null,
    date_end: row.date_end ? String(row.date_end) : null,
    occ_threshold: toNumber(row.occ_threshold),
    scope:
      row.scope === "individual" || row.scope === "group"
        ? row.scope
        : "all",
    created_at: String(row.created_at),
    created_by: row.created_by ? String(row.created_by) : null,
    updated_at: String(row.updated_at),
  };
}

function mapBookingAlarmRow(row: any): BookingAlarm {
  return {
    id: String(row.id),
    reservation_id: String(row.reservation_id),
    alarm_date: String(row.alarm_date),
    note: String(row.note ?? ""),
    status:
      row.status === "completed" ||
      row.status === "deleted" ||
      row.status === "auto_cancelled_due_in"
        ? row.status
        : "active",
    created_at: String(row.created_at),
    created_by: row.created_by ? String(row.created_by) : null,
    completed_at: row.completed_at ? String(row.completed_at) : null,
    completed_by: row.completed_by ? String(row.completed_by) : null,
    completion_note: row.completion_note ? String(row.completion_note) : null,
    deleted_at: row.deleted_at ? String(row.deleted_at) : null,
    deleted_by: row.deleted_by ? String(row.deleted_by) : null,
  };
}

function mapAlertDailyStateRow(row: any): AlertDailyStateRow {
  return {
    id: String(row.id),
    alert_date: String(row.alert_date),
    reservation_id: String(row.reservation_id),
    alert_type: row.alert_type === "custom" ? "custom" : "prepayment",
    source_id: String(row.source_id),
    status: coerceAlertStatus(row.status),
    snoozed_from: row.snoozed_from ? String(row.snoozed_from) : null,
    snooze_note: row.snooze_note ? String(row.snooze_note) : null,
    cleared_at: row.cleared_at ? String(row.cleared_at) : null,
    cleared_by: row.cleared_by ? String(row.cleared_by) : null,
    clear_note: row.clear_note ? String(row.clear_note) : null,
    created_at: String(row.created_at),
  };
}

export async function getBusinessDateContext(supabase: SupabaseClientLike): Promise<BusinessDateContext> {
  const { data, error } = await supabase
    .from("hotel_settings")
    .select("business_date, hotel_timezone")
    .eq("id", 1)
    .maybeSingle();

  if (error) throw new Error(error.message);

  const timezone = String(data?.hotel_timezone ?? "Asia/Bangkok");
  const calendarDate = formatCalendarDate(new Date(), timezone);
  const businessDate = String(data?.business_date ?? calendarDate);

  return { businessDate, calendarDate, timezone };
}

export async function readAlertSettings(supabase: SupabaseClientLike): Promise<AlertSettings> {
  const { data, error } = await supabase
    .from("app_settings")
    .select("key, value_json")
    .in("key", [
      "alert.start_time",
      "alert.snooze_minutes",
      "alert.prepayment_lead_days",
    ]);

  if (error) throw new Error(error.message);

  const map = new Map<string, unknown>();
  for (const row of data ?? []) {
    map.set(String((row as any).key ?? ""), (row as any).value_json);
  }

  return {
    start_time: normalizeTime(map.get("alert.start_time"), "07:30"),
    snooze_minutes: Math.max(5, Math.min(480, Math.round(toNumber(map.get("alert.snooze_minutes"), 60)))),
    prepayment_lead_days: Math.max(1, Math.min(30, Math.round(toNumber(map.get("alert.prepayment_lead_days"), 7)))),
  };
}

async function upsertAppSetting(params: {
  supabase: SupabaseClientLike;
  userId: string;
  key: string;
  value: unknown;
  description: string;
}) {
  const { error } = await params.supabase.from("app_settings").upsert(
    {
      key: params.key,
      value_json: params.value,
      description: params.description,
      updated_at: new Date().toISOString(),
      updated_by: params.userId,
    },
    { onConflict: "key" }
  );

  if (error) throw new Error(error.message);
}

export async function updateAlertSettings(
  supabase: SupabaseClientLike,
  actorUserId: string,
  patch: AlertSettingsPatch
) {
  if (patch.start_time !== undefined) {
    const normalized = normalizeTime(patch.start_time, "");
    if (!normalized) throw new Error("alert.start_time must be in HH:mm format.");
    await upsertAppSetting({
      supabase,
      userId: actorUserId,
      key: "alert.start_time",
      value: normalized,
      description: "Phase 74: Time of day when pending alerts begin escalating.",
    });
  }

  if (patch.snooze_minutes !== undefined) {
    const nextValue = Math.round(toNumber(patch.snooze_minutes, NaN));
    if (!Number.isFinite(nextValue) || nextValue < 5 || nextValue > 480) {
      throw new Error("alert.snooze_minutes must be between 5 and 480.");
    }
    await upsertAppSetting({
      supabase,
      userId: actorUserId,
      key: "alert.snooze_minutes",
      value: nextValue,
      description: "Phase 74: Minutes between alert reminder re-triggers.",
    });
  }

  if (patch.prepayment_lead_days !== undefined) {
    const nextValue = Math.round(toNumber(patch.prepayment_lead_days, NaN));
    if (!Number.isFinite(nextValue) || nextValue < 1 || nextValue > 30) {
      throw new Error("alert.prepayment_lead_days must be between 1 and 30.");
    }
    await upsertAppSetting({
      supabase,
      userId: actorUserId,
      key: "alert.prepayment_lead_days",
      value: nextValue,
      description: "Phase 74: Days ahead used for pre-payment alert eligibility.",
    });
  }

  return readAlertSettings(supabase);
}

export function applyAlertSettingsToHotelSettings<T extends Record<string, unknown>>(
  settings: T,
  alertSettings: AlertSettings
) {
  return {
    ...settings,
    alert_start_time: alertSettings.start_time,
    alert_snooze_minutes: alertSettings.snooze_minutes,
    alert_prepayment_lead_days: alertSettings.prepayment_lead_days,
  };
}

async function archiveExpiredAlertRules(supabase: SupabaseClientLike, businessDate: string) {
  const { error } = await supabase
    .from("alert_rules")
    .update({ is_active: false, updated_at: new Date().toISOString() })
    .eq("is_active", true)
    .eq("trigger_mode", "date_range")
    .lt("date_end", businessDate);

  if (error) throw new Error(error.message);
}

export async function validateAlertRuleOverlap(
  supabase: SupabaseClientLike,
  input: {
    ruleId?: string | null;
    triggerMode: "all_year" | "date_range";
    dateStart: string | null;
    dateEnd: string | null;
    isActive: boolean;
  }
): Promise<AlertRuleOverlapResult> {
  const { data, error } = await supabase.rpc("alert_rules_check_overlap", {
    p_rule_id: input.ruleId ?? null,
    p_trigger: input.triggerMode,
    p_start: input.dateStart,
    p_end: input.dateEnd,
    p_is_active: input.isActive,
  });

  if (error) throw new Error(error.message);

  const conflicts = Array.isArray((data as any)?.conflicts)
    ? ((data as any).conflicts as any[])
    : Array.isArray(data)
      ? []
      : [];
  const raw = data as any;
  const safeConflicts = conflicts.map((row) => ({
    id: String(row.id),
    name: String(row.name ?? ""),
    date_start: row.date_start ? String(row.date_start) : null,
    date_end: row.date_end ? String(row.date_end) : null,
  }));

  return {
    ok: Boolean(raw?.ok ?? safeConflicts.length === 0),
    conflicts: safeConflicts,
  };
}

export async function listAlertRules(
  supabase: SupabaseClientLike,
  options?: { businessDate?: string; includeArchived?: boolean }
) {
  const businessDate = options?.businessDate ?? (await getBusinessDateContext(supabase)).businessDate;
  await archiveExpiredAlertRules(supabase, businessDate);

  const { data, error } = await supabase
    .from("alert_rules")
    .select("*")
    .order("is_active", { ascending: false })
    .order("date_start", { ascending: true, nullsFirst: true })
    .order("created_at", { ascending: false });
  if (error) throw new Error(error.message);
  const rows = (data ?? []).map(mapAlertRuleRow);
  if (options?.includeArchived) return rows;
  return rows.filter((row) => row.trigger_mode === "all_year" || row.date_end == null || row.date_end >= businessDate);
}

function normalizeAlertRuleDraft(input: AlertRuleDraft): AlertRuleInput {
  const name = String(input.name ?? "").trim();
  if (!name) throw new Error("name is required.");

  const triggerMode: AlertRuleInput["trigger_mode"] =
    input.trigger_mode === "date_range" ? "date_range" : "all_year";
  const dateStart = input.date_start && isIsoDate(input.date_start) ? input.date_start : null;
  const dateEnd = input.date_end && isIsoDate(input.date_end) ? input.date_end : null;
  const occThreshold = toNumber(input.occ_threshold, NaN);

  if (!Number.isFinite(occThreshold) || occThreshold < 0 || occThreshold > 100) {
    throw new Error("occ_threshold must be between 0 and 100.");
  }

  if (triggerMode === "date_range" && (!dateStart || !dateEnd)) {
    throw new Error("date_start and date_end are required for date_range rules.");
  }

  if (triggerMode === "all_year" && (dateStart || dateEnd)) {
    throw new Error("all_year rules cannot include date_start or date_end.");
  }

  return {
    name,
    is_active: input.is_active !== false,
    trigger_mode: triggerMode,
    date_start: triggerMode === "date_range" ? dateStart : null,
    date_end: triggerMode === "date_range" ? dateEnd : null,
    occ_threshold: occThreshold,
    scope: input.scope === "individual" || input.scope === "group" ? input.scope : "all",
  };
}

export async function createAlertRule(
  supabase: SupabaseClientLike,
  actorUserId: string,
  input: AlertRuleDraft
) {
  const payload = normalizeAlertRuleDraft(input);
  const overlap = await validateAlertRuleOverlap(supabase, {
    triggerMode: payload.trigger_mode,
    dateStart: payload.date_start,
    dateEnd: payload.date_end,
    isActive: payload.is_active,
  });
  if (!overlap.ok) {
    const error = new Error("Alert rule overlaps with existing active rule(s).");
    (error as any).conflicts = overlap.conflicts;
    throw error;
  }

  const { data, error } = await supabase
    .from("alert_rules")
    .insert({
      ...payload,
      created_by: actorUserId,
    })
    .select("*")
    .single();

  if (error) throw new Error(error.message);
  return mapAlertRuleRow(data);
}

export async function updateAlertRule(
  supabase: SupabaseClientLike,
  ruleId: string,
  input: Partial<AlertRuleDraft>
) {
  const { data: existing, error: existingError } = await supabase
    .from("alert_rules")
    .select("*")
    .eq("id", ruleId)
    .maybeSingle();

  if (existingError) throw new Error(existingError.message);
  if (!existing) throw new Error("Alert rule not found.");

  const payload = normalizeAlertRuleDraft({
    name: input.name ?? existing.name,
    is_active: input.is_active ?? existing.is_active,
    trigger_mode: (input.trigger_mode as any) ?? existing.trigger_mode,
    date_start: input.date_start === undefined ? existing.date_start : input.date_start,
    date_end: input.date_end === undefined ? existing.date_end : input.date_end,
    occ_threshold: input.occ_threshold ?? existing.occ_threshold,
    scope: (input.scope as any) ?? existing.scope,
  });

  const overlap = await validateAlertRuleOverlap(supabase, {
    ruleId,
    triggerMode: payload.trigger_mode,
    dateStart: payload.date_start,
    dateEnd: payload.date_end,
    isActive: payload.is_active,
  });
  if (!overlap.ok) {
    const error = new Error("Alert rule overlaps with existing active rule(s).");
    (error as any).conflicts = overlap.conflicts;
    throw error;
  }

  const { data, error } = await supabase
    .from("alert_rules")
    .update({
      ...payload,
      updated_at: new Date().toISOString(),
    })
    .eq("id", ruleId)
    .select("*")
    .single();

  if (error) throw new Error(error.message);
  return mapAlertRuleRow(data);
}

export async function deleteAlertRule(supabase: SupabaseClientLike, ruleId: string) {
  const { error } = await supabase.from("alert_rules").delete().eq("id", ruleId);
  if (error) throw new Error(error.message);
}

export async function listBookingAlarms(supabase: SupabaseClientLike, reservationId: string) {
  const { data, error } = await supabase
    .from("booking_alarms")
    .select("*")
    .eq("reservation_id", reservationId)
    .order("alarm_date", { ascending: true })
    .order("created_at", { ascending: false });

  if (error) throw new Error(error.message);
  return (data ?? []).map(mapBookingAlarmRow);
}

export async function createBookingAlarm(
  supabase: SupabaseClientLike,
  actorUserId: string,
  input: BookingAlarmInput
) {
  if (!input.reservation_id) throw new Error("reservation_id is required.");
  if (!isIsoDate(input.alarm_date)) throw new Error("alarm_date must be YYYY-MM-DD.");
  if (String(input.note ?? "").trim().length < 5) throw new Error("note must be at least 5 characters.");

  const { data, error } = await supabase
    .from("booking_alarms")
    .insert({
      reservation_id: input.reservation_id,
      alarm_date: input.alarm_date,
      note: String(input.note).trim(),
      created_by: actorUserId,
    })
    .select("*")
    .single();

  if (error) throw new Error(error.message);
  return mapBookingAlarmRow(data);
}

export async function updateBookingAlarm(
  supabase: SupabaseClientLike,
  actorUserId: string,
  alarmId: string,
  input: BookingAlarmPatch
) {
  const { data: existing, error: existingError } = await supabase
    .from("booking_alarms")
    .select("*")
    .eq("id", alarmId)
    .maybeSingle();

  if (existingError) throw new Error(existingError.message);
  if (!existing) throw new Error("Alarm not found.");

  if (input.action === "complete") {
    const completionNote = String(input.completion_note ?? "").trim();
    if (!completionNote) throw new Error("completion_note is required.");

    const { data, error } = await supabase
      .from("booking_alarms")
      .update({
        status: "completed",
        completed_at: new Date().toISOString(),
        completed_by: actorUserId,
        completion_note: completionNote,
      })
      .eq("id", alarmId)
      .select("*")
      .single();

    if (error) throw new Error(error.message);
    return mapBookingAlarmRow(data);
  }

  const updates: Record<string, unknown> = {};
  if (input.alarm_date !== undefined) {
    if (!isIsoDate(input.alarm_date)) throw new Error("alarm_date must be YYYY-MM-DD.");
    updates.alarm_date = input.alarm_date;
  }
  if (input.note !== undefined) {
    const nextNote = String(input.note ?? "").trim();
    if (nextNote.length < 5) throw new Error("note must be at least 5 characters.");
    updates.note = nextNote;
  }

  const { data, error } = await supabase
    .from("booking_alarms")
    .update(updates)
    .eq("id", alarmId)
    .select("*")
    .single();

  if (error) throw new Error(error.message);
  return mapBookingAlarmRow(data);
}

export async function softDeleteBookingAlarm(
  supabase: SupabaseClientLike,
  actorUserId: string,
  alarmId: string
) {
  const { data, error } = await supabase
    .from("booking_alarms")
    .update({
      status: "deleted",
      deleted_at: new Date().toISOString(),
      deleted_by: actorUserId,
    })
    .eq("id", alarmId)
    .select("*")
    .single();

  if (error) throw new Error(error.message);
  return mapBookingAlarmRow(data);
}

async function fetchAlertSourceMaps(
  supabase: SupabaseClientLike,
  rows: AlertDailyStateRow[]
): Promise<AlertSourceMaps> {
  const ruleIds = Array.from(
    new Set(rows.filter((row) => row.alert_type === "prepayment").map((row) => row.source_id))
  );
  const alarmIds = Array.from(
    new Set(rows.filter((row) => row.alert_type === "custom").map((row) => row.source_id))
  );

  const [ruleResult, alarmResult] = await Promise.all([
    ruleIds.length
      ? supabase.from("alert_rules").select("id, name").in("id", ruleIds)
      : Promise.resolve({ data: [], error: null } as any),
    alarmIds.length
      ? supabase.from("booking_alarms").select("id, note").in("id", alarmIds)
      : Promise.resolve({ data: [], error: null } as any),
  ]);

  if (ruleResult.error) throw new Error(ruleResult.error.message);
  if (alarmResult.error) throw new Error(alarmResult.error.message);

  return {
    ruleNames: new Map((ruleResult.data ?? []).map((row: any) => [String(row.id), String(row.name ?? "")])),
    alarmNotes: new Map((alarmResult.data ?? []).map((row: any) => [String(row.id), String(row.note ?? "")])),
  };
}

async function fetchReservationMap(
  supabase: SupabaseClientLike,
  reservationIds: string[]
) {
  if (reservationIds.length === 0) return new Map<string, ReservationAlertRow>();

  const { data, error } = await supabase
    .from("reservations")
    .select(`
      id,
      booking_code,
      guest_name,
      guest_profile_id,
      booking_group_id,
      is_thai_manual,
      checkin_date,
      checkout_date,
      total_price,
      source,
      guest_profiles(phone, nationality, nationality_code, first_name, last_name),
      reservation_nights(stay_date, cancelled_at, rooms(room_number))
    `)
    .in("id", reservationIds);

  if (error) throw new Error(error.message);

  return new Map((data ?? []).map((row: any) => [String(row.id), row as ReservationAlertRow]));
}

async function fetchPaymentTotals(
  supabase: SupabaseClientLike,
  reservationIds: string[]
) {
  const totals = new Map<string, number>();
  if (reservationIds.length === 0) return totals;

  const { data, error } = await supabase
    .from("folio_payments")
    .select("reservation_id, amount, tx_type, is_record_only")
    .in("reservation_id", reservationIds)
    .eq("tx_type", "payment");

  if (error) throw new Error(error.message);

  for (const row of data ?? []) {
    if ((row as any).is_record_only === true) continue;
    const key = String((row as any).reservation_id ?? "");
    totals.set(key, (totals.get(key) ?? 0) + toNumber((row as any).amount));
  }

  return totals;
}

async function fetchOccPercentByDate(
  supabase: SupabaseClientLike,
  dates: string[]
) {
  const uniqueDates = Array.from(new Set(dates.filter(isIsoDate)));
  const result = new Map<string, number>(uniqueDates.map((date) => [date, 0]));
  if (uniqueDates.length === 0) return result;

  const { data: settings, error: settingsError } = await supabase
    .from("hotel_settings")
    .select("sellable_rooms")
    .eq("id", 1)
    .maybeSingle();

  if (settingsError) throw new Error(settingsError.message);

  const sellable = toNumber((settings as any)?.sellable_rooms);
  if (sellable <= 0) return result;

  const { data: nights, error: nightsError } = await supabase
    .from("reservation_nights")
    .select("stay_date")
    .in("stay_date", uniqueDates)
    .is("cancelled_at", null);

  if (nightsError) throw new Error(nightsError.message);

  const occupiedByDate = new Map<string, number>();
  for (const row of (nights ?? []) as any[]) {
    const stayDate = String(row.stay_date ?? "");
    if (!result.has(stayDate)) continue;
    occupiedByDate.set(stayDate, (occupiedByDate.get(stayDate) ?? 0) + 1);
  }

  for (const date of uniqueDates) {
    const occupied = occupiedByDate.get(date) ?? 0;
    result.set(date, Math.round((occupied / sellable) * 10000) / 100);
  }

  return result;
}

function buildAlertItem(
  row: AlertDailyStateRow,
  reservation: ReservationAlertRow | undefined,
  paymentTotals: Map<string, number>,
  sourceMaps: AlertSourceMaps
): AlertItem {
  const totalPaid = paymentTotals.get(String(reservation?.id ?? row.reservation_id)) ?? 0;
  const profile = firstRow(reservation?.guest_profiles) as any;

  return {
    daily_state_id: row.id,
    alert_type: row.alert_type,
    status: row.status,
    booking: {
      id: String(reservation?.id ?? row.reservation_id),
      booking_code: toNullableString((reservation as any)?.booking_code),
      guest_name: String(reservation?.guest_name ?? "Unknown Guest"),
      has_phone: Boolean(toNullableString(profile?.phone)),
      channel: toNullableString((reservation as any)?.source),
      nationality: toNullableString(profile?.nationality ?? profile?.nationality_code),
      is_thai: reservation ? isThaiCustomer(reservation) : false,
      check_in_date: String(reservation?.checkin_date ?? row.alert_date),
      nights: reservation ? diffDays(reservation.checkin_date, reservation.checkout_date) : 0,
      total_amount: toNumber((reservation as any)?.total_price),
      total_paid: Math.round(totalPaid * 100) / 100,
      room_label: reservation ? buildRoomLabel(reservation) : null,
      booking_group_id: reservation?.booking_group_id ? String(reservation.booking_group_id) : null,
    },
    note:
      row.alert_type === "prepayment"
        ? sourceMaps.ruleNames.get(row.source_id) ?? null
        : sourceMaps.alarmNotes.get(row.source_id) ?? null,
    snoozed_from: row.snoozed_from,
    cleared_at: row.cleared_at,
    cleared_by: row.cleared_by,
    clear_note: row.clear_note,
  };
}

function buildProjectedAlertItem(params: {
  date: string;
  alertType: "prepayment" | "custom";
  reservation: ReservationAlertRow;
  paymentTotals: Map<string, number>;
  sourceId: string;
  sourceLabel: string | null;
  note: string | null;
}) {
  const profile = firstRow(params.reservation.guest_profiles) as any;
  const totalPaid = params.paymentTotals.get(params.reservation.id) ?? 0;

  return {
    daily_state_id: `projected:${params.alertType}:${params.date}:${params.reservation.id}:${params.sourceId}`,
    alert_type: params.alertType,
    status: "pending" as const,
    booking: {
      id: String(params.reservation.id),
      booking_code: toNullableString((params.reservation as any)?.booking_code),
      guest_name: String(params.reservation.guest_name ?? "Unknown Guest"),
      has_phone: Boolean(toNullableString(profile?.phone)),
      channel: toNullableString((params.reservation as any)?.source),
      nationality: toNullableString(profile?.nationality ?? profile?.nationality_code),
      is_thai: isThaiCustomer(params.reservation),
      check_in_date: String(params.reservation.checkin_date),
      nights: diffDays(params.reservation.checkin_date, params.reservation.checkout_date),
      total_amount: toNumber((params.reservation as any)?.total_price),
      total_paid: Math.round(totalPaid * 100) / 100,
      room_label: buildRoomLabel(params.reservation),
      booking_group_id: params.reservation.booking_group_id ? String(params.reservation.booking_group_id) : null,
    },
    note: params.note ?? params.sourceLabel,
    snoozed_from: null,
    cleared_at: null,
    cleared_by: null,
    clear_note: null,
  } satisfies AlertItem;
}

async function buildProjectedAlertItemsForDate(
  supabase: SupabaseClientLike,
  date: string,
  context: BusinessDateContext,
  existingRows: AlertDailyStateRow[]
) {
  if (date <= context.businessDate) return [] as AlertItem[];

  const settings = await readAlertSettings(supabase);
  const existingProjectedKeys = new Set(
    existingRows.map((row) => `${row.alert_type}:${row.reservation_id}:${row.source_id}`)
  );
  const paymentTargetDate = addDays(date, settings.prepayment_lead_days);

  const [rulesData, reservationsData, alarmsData] = await Promise.all([
    supabase
      .from("alert_rules")
      .select("id, name, trigger_mode, date_start, date_end, occ_threshold, scope")
      .eq("is_active", true),
    supabase
      .from("reservations")
      .select(`
        id,
        booking_code,
        guest_name,
        guest_profile_id,
        booking_group_id,
        is_thai_manual,
        checkin_date,
        checkout_date,
        total_price,
        source,
        prepayment_admin_cleared_at,
        guest_profiles(phone, nationality, nationality_code, first_name, last_name),
        reservation_nights(stay_date, cancelled_at, rooms(room_number))
      `)
      .eq("status", "active")
      .eq("checkin_date", paymentTargetDate)
      .is("prepayment_admin_cleared_at", null),
    supabase
      .from("booking_alarms")
      .select(`
        id,
        reservation_id,
        note,
        reservations(
          id,
          booking_code,
          guest_name,
          guest_profile_id,
          booking_group_id,
          is_thai_manual,
          checkin_date,
          checkout_date,
          total_price,
          source,
          prepayment_admin_cleared_at,
          guest_profiles(phone, nationality, nationality_code, first_name, last_name),
          reservation_nights(stay_date, cancelled_at, rooms(room_number))
        )
      `)
      .eq("status", "active")
      .eq("alarm_date", date),
  ]);

  if (rulesData.error) throw new Error(rulesData.error.message);
  if (reservationsData.error) throw new Error(reservationsData.error.message);
  if (alarmsData.error) throw new Error(alarmsData.error.message);

  const reservations = ((reservationsData.data ?? []) as any[]).map((row) => row as ReservationAlertRow);
  const paymentTotals = await fetchPaymentTotals(
    supabase,
    Array.from(
      new Set([
        ...reservations.map((row) => row.id),
        ...((alarmsData.data ?? []) as any[]).map((row) => String((row as any)?.reservation_id ?? "")),
      ].filter(Boolean))
    )
  );
  const occValue = reservations.length
    ? toNumber((await supabase.rpc("fn_alert_occ_for_date", { p_date: paymentTargetDate })).data)
    : 0;

  const items: AlertItem[] = [];
  const rules = (rulesData.data ?? []) as any[];
  for (const reservation of reservations) {
    if (!isThaiCustomer(reservation)) continue;
    if ((paymentTotals.get(reservation.id) ?? 0) > 0) continue;

    const matchingRule = rules.find((rule) => {
      if (rule.trigger_mode === "date_range") {
        const dateStart = toNullableString(rule.date_start);
        const dateEnd = toNullableString(rule.date_end);
        if (!dateStart || !dateEnd) return false;
        if (reservation.checkin_date < dateStart || reservation.checkin_date > dateEnd) return false;
      }
      if (rule.scope === "individual" && reservation.booking_group_id) return false;
      if (rule.scope === "group" && !reservation.booking_group_id) return false;
      const occThreshold = toNumber(rule.occ_threshold);
      if (occThreshold > 0 && occValue < occThreshold) return false;
      return true;
    });

    if (!matchingRule) continue;
    const key = `prepayment:${reservation.id}:${String(matchingRule.id)}`;
    if (existingProjectedKeys.has(key)) continue;

    items.push(
      buildProjectedAlertItem({
        date,
        alertType: "prepayment",
        reservation,
        paymentTotals,
        sourceId: String(matchingRule.id),
        sourceLabel: String(matchingRule.name ?? ""),
        note: String(matchingRule.name ?? ""),
      })
    );
  }

  for (const row of (alarmsData.data ?? []) as any[]) {
    const reservation = firstRow((row as any)?.reservations) as ReservationAlertRow | null;
    if (!reservation) continue;
    if (reservation.checkin_date === date) continue;
    const sourceId = String((row as any)?.id ?? "");
    const key = `custom:${reservation.id}:${sourceId}`;
    if (existingProjectedKeys.has(key)) continue;

    items.push(
      buildProjectedAlertItem({
        date,
        alertType: "custom",
        reservation,
        paymentTotals,
        sourceId,
        sourceLabel: null,
        note: toNullableString((row as any)?.note),
      })
    );
  }

  return items;
}

async function fetchAlertJobLogForDate(supabase: SupabaseClientLike, date: string) {
  const { data, error } = await supabase
    .from("alert_job_log")
    .select("id, finished_at, finished_by")
    .eq("job_date", date)
    .maybeSingle();

  if (error) throw new Error(error.message);
  return data as { id: string; finished_at: string | null; finished_by: string | null } | null;
}

async function buildAlertsSummary(
  supabase: SupabaseClientLike,
  date: string,
  rows: AlertDailyStateRow[],
  context: BusinessDateContext
): Promise<AlertsSummary> {
  const pendingPrepayment = rows.filter((row) => row.alert_type === "prepayment" && row.status === "pending").length;
  const pendingCustom = rows.filter((row) => row.alert_type === "custom" && row.status === "pending").length;
  const cleared = rows.filter((row) => row.status !== "pending").length;
  const jobLog = await fetchAlertJobLogForDate(supabase, date);

  return {
    date,
    business_date: context.businessDate,
    calendar_date: context.calendarDate,
    total: rows.length,
    cleared,
    pending_prepayment: pendingPrepayment,
    pending_custom: pendingCustom,
    ready_to_finish: pendingPrepayment + pendingCustom === 0 && !jobLog,
    is_finished: Boolean(jobLog),
    finished_at: jobLog?.finished_at ? String(jobLog.finished_at) : null,
    finished_by: jobLog?.finished_by ? String(jobLog.finished_by) : null,
  };
}

async function fetchEarlierOpenPrepaymentReservationIds(
  supabase: SupabaseClientLike,
  reservationIds: string[],
  businessDate: string,
  beforeDate: string
) {
  const ids = Array.from(new Set(reservationIds.filter(Boolean)));
  if (ids.length === 0) return new Set<string>();
  if (beforeDate <= businessDate) return new Set<string>();

  const { data, error } = await supabase
    .from("alert_daily_state")
    .select("reservation_id, alert_date")
    .eq("alert_type", "prepayment")
    .in("status", ["pending", "snoozed"])
    .in("reservation_id", ids)
    .gte("alert_date", businessDate)
    .lt("alert_date", beforeDate);

  if (error) throw new Error(error.message);

  return new Set((data ?? []).map((row: any) => String(row.reservation_id ?? "")));
}

function filterVisibleAlertRows(
  rows: AlertDailyStateRow[],
  context: BusinessDateContext,
  hiddenFuturePrepaymentReservationIds = new Set<string>()
) {
  return rows.filter((row) => {
    if (row.alert_type !== "prepayment") return true;
    if (row.alert_date <= context.businessDate) return true;
    return Boolean(row.snoozed_from) && !hiddenFuturePrepaymentReservationIds.has(row.reservation_id);
  });
}

async function getQueuedPrepaymentCountsForRange(
  supabase: SupabaseClientLike,
  from: string,
  to: string,
  context: BusinessDateContext
) {
  const counts = new Map<string, number>();
  const queryFrom = from < context.businessDate ? from : context.businessDate;

  const { data, error } = await supabase
    .from("alert_daily_state")
    .select("alert_date, reservation_id, snoozed_from, status")
    .eq("alert_type", "prepayment")
    .in("status", ["pending", "snoozed"])
    .gte("alert_date", queryFrom)
    .lte("alert_date", to)
    .order("alert_date", { ascending: true })
    .order("created_at", { ascending: true });

  if (error) throw new Error(error.message);

  const seenEarlierOpen = new Set<string>();
  for (const raw of (data ?? []) as any[]) {
    const rowDate = String(raw.alert_date ?? "");
    const reservationId = String(raw.reservation_id ?? "");
    const snoozedFrom = toNullableString(raw.snoozed_from);
    const status = String(raw.status ?? "");
    const hiddenFutureDuplicate =
      rowDate > context.businessDate && (!snoozedFrom || seenEarlierOpen.has(reservationId));

    if (!hiddenFutureDuplicate && status === "pending" && rowDate >= from && rowDate <= to) {
      counts.set(rowDate, (counts.get(rowDate) ?? 0) + 1);
    }

    seenEarlierOpen.add(reservationId);
  }

  return counts;
}

async function getProjectedFirstEligiblePrepaymentCountsForRange(
  supabase: SupabaseClientLike,
  from: string,
  to: string,
  context: BusinessDateContext
) {
  const results = new Map<string, Set<string>>();
  const settings = await readAlertSettings(supabase);
  const { data: rulesData, error: rulesError } = await supabase
    .from("alert_rules")
    .select("id, trigger_mode, date_start, date_end, occ_threshold, scope")
    .eq("is_active", true);

  if (rulesError) throw new Error(rulesError.message);

  const rules = (rulesData ?? []) as any[];
  if (rules.length === 0) return new Map<string, number>();

  const reservationWindowStart = addDays(from, 1);
  const reservationWindowEnd = addDays(to, settings.prepayment_lead_days);
  const { data: reservationsData, error: reservationsError } = await supabase
    .from("reservations")
    .select(`
      id,
      booking_code,
      guest_name,
      guest_profile_id,
      booking_group_id,
      is_thai_manual,
      checkin_date,
      checkout_date,
      total_price,
      source,
      prepayment_admin_cleared_at,
      guest_profiles(phone, nationality, nationality_code, first_name, last_name)
    `)
    .eq("status", "active")
    .is("prepayment_admin_cleared_at", null)
    .gt("checkin_date", context.businessDate)
    .gte("checkin_date", reservationWindowStart)
    .lte("checkin_date", reservationWindowEnd);

  if (reservationsError) throw new Error(reservationsError.message);

  const reservations = ((reservationsData ?? []) as any[]).map((row) => row as ReservationAlertRow);
  if (reservations.length === 0) return new Map<string, number>();

  const reservationIds = reservations.map((row) => row.id);
  const paymentTotals = await fetchPaymentTotals(supabase, reservationIds);
  const openRowDatesByReservation = new Map<string, string[]>();
  const { data: openRows, error: openRowsError } = await supabase
    .from("alert_daily_state")
    .select("reservation_id, alert_date, status")
    .eq("alert_type", "prepayment")
    .in("status", ["pending", "snoozed"])
    .in("reservation_id", reservationIds)
    .gte("alert_date", context.businessDate)
    .lte("alert_date", to);

  if (openRowsError) throw new Error(openRowsError.message);

  for (const row of (openRows ?? []) as any[]) {
    const reservationId = String(row.reservation_id ?? "");
    const alertDate = String(row.alert_date ?? "");
    const existing = openRowDatesByReservation.get(reservationId) ?? [];
    existing.push(alertDate);
    openRowDatesByReservation.set(reservationId, existing);
  }

  const occByDate = await fetchOccPercentByDate(
    supabase,
    reservations.map((reservation) => reservation.checkin_date)
  );

  for (const reservation of reservations) {
    if (!isThaiCustomer(reservation)) continue;
    if (paymentTotals.get(reservation.id) && (paymentTotals.get(reservation.id) ?? 0) > 0) continue;

    const firstEligibleDate = addDays(reservation.checkin_date, -settings.prepayment_lead_days);
    if (firstEligibleDate < from || firstEligibleDate > to) continue;
    if (firstEligibleDate <= context.businessDate) continue;

    const hasOpenRowOnOrBeforeFirstEligible = (openRowDatesByReservation.get(reservation.id) ?? []).some(
      (alertDate) => alertDate <= firstEligibleDate
    );
    if (hasOpenRowOnOrBeforeFirstEligible) continue;

    const matchesAnyRule = rules.some((rule) => {
      if (rule.trigger_mode === "date_range") {
        const dateStart = toNullableString(rule.date_start);
        const dateEnd = toNullableString(rule.date_end);
        if (!dateStart || !dateEnd) return false;
        if (reservation.checkin_date < dateStart || reservation.checkin_date > dateEnd) return false;
      }

      if (rule.scope === "individual" && reservation.booking_group_id) return false;
      if (rule.scope === "group" && !reservation.booking_group_id) return false;

      const occThreshold = toNumber(rule.occ_threshold);
      if (occThreshold > 0 && (occByDate.get(reservation.checkin_date) ?? 0) < occThreshold) return false;
      return true;
    });

    if (!matchesAnyRule) continue;

    const bucket = results.get(firstEligibleDate) ?? new Set<string>();
    bucket.add(reservation.id);
    results.set(firstEligibleDate, bucket);
  }

  return new Map(Array.from(results.entries()).map(([date, ids]) => [date, ids.size]));
}

export async function listAlertsForDate(
  supabase: SupabaseClientLike,
  date: string,
  options?: { materialize?: boolean; context?: BusinessDateContext }
): Promise<AlertsTodayResponse> {
  if (!isIsoDate(date)) throw new Error("date must be YYYY-MM-DD.");
  const context = options?.context ?? (await getBusinessDateContext(supabase));

  if (options?.materialize) {
    const { error } = await supabase.rpc("alert_materialize_daily", { p_date: date });
    if (error) throw new Error(error.message);
  }

  const { data, error } = await supabase
    .from("alert_daily_state")
    .select("*")
    .eq("alert_date", date)
    .order("alert_type", { ascending: true })
    .order("created_at", { ascending: true });

  if (error) throw new Error(error.message);

  const allRows: AlertDailyStateRow[] = ((data ?? []) as any[]).map(mapAlertDailyStateRow);
  const hiddenFuturePrepaymentReservationIds = await fetchEarlierOpenPrepaymentReservationIds(
    supabase,
    allRows.filter((row) => row.alert_type === "prepayment").map((row) => row.reservation_id),
    context.businessDate,
    date
  );
  const rows = filterVisibleAlertRows(allRows, context, hiddenFuturePrepaymentReservationIds);
  const reservationIds: string[] = Array.from(new Set(rows.map((row) => row.reservation_id)));
  let reservationMap = new Map<string, ReservationAlertRow>();
  let paymentTotals = new Map<string, number>();
  let sourceMaps: AlertSourceMaps = {
    ruleNames: new Map<string, string>(),
    alarmNotes: new Map<string, string>(),
  };

  try {
    [reservationMap, paymentTotals, sourceMaps] = await Promise.all([
      fetchReservationMap(supabase, reservationIds),
      fetchPaymentTotals(supabase, reservationIds),
      fetchAlertSourceMaps(supabase, rows),
    ]);
  } catch (enrichmentError) {
    console.error("[alerts] failed to enrich alert rows", enrichmentError);
  }

  const items = rows.map((row) =>
    buildAlertItem(row, reservationMap.get(row.reservation_id), paymentTotals, sourceMaps)
  );
  const projectedItems =
    date > context.businessDate ? await buildProjectedAlertItemsForDate(supabase, date, context, rows) : [];
  const allItems = [...items, ...projectedItems];
  const summaryRows = [
    ...rows,
    ...projectedItems.map((item, index) => ({
      id: item.daily_state_id || `projected-${index}`,
      alert_date: date,
      reservation_id: item.booking.id,
      alert_type: item.alert_type,
      source_id: item.note ?? `projected-${index}`,
      status: item.status,
      snoozed_from: null,
      snooze_note: null,
      cleared_at: null,
      cleared_by: null,
      clear_note: null,
      created_at: new Date(0).toISOString(),
    })),
  ];

  return {
    summary: await buildAlertsSummary(supabase, date, summaryRows, context),
    items: allItems,
  };
}

export async function projectAlertCountsForRange(
  supabase: SupabaseClientLike,
  from: string,
  to: string,
  context?: BusinessDateContext
) {
  if (!isIsoDate(from) || !isIsoDate(to)) throw new Error("from/to must be YYYY-MM-DD.");
  const startTime = Date.parse(`${from}T00:00:00Z`);
  const endTime = Date.parse(`${to}T00:00:00Z`);
  if (endTime < startTime) throw new Error("to must be on or after from.");
  const days = Math.round((endTime - startTime) / 86400000) + 1;
  if (days > 14) throw new Error("Range is limited to 14 days.");

  const activeContext = context ?? (await getBusinessDateContext(supabase));
  const queuedPrepaymentCounts = await getQueuedPrepaymentCountsForRange(supabase, from, to, activeContext);
  const projectedPrepaymentCounts = await getProjectedFirstEligiblePrepaymentCountsForRange(
    supabase,
    from,
    to,
    activeContext
  );
  const results: AlertsRangeDay[] = [];
  for (let offset = 0; offset < days; offset += 1) {
    const date = addDays(from, offset);
    const { data, error } = await supabase.rpc("alert_project_daily_counts", { p_date: date });
    if (error) throw new Error(error.message);

    let prepaymentCount = (queuedPrepaymentCounts.get(date) ?? 0) + (projectedPrepaymentCounts.get(date) ?? 0);
    let customCount = 0;
    for (const row of (data as any[]) ?? []) {
      const alertType = String((row as any)?.alert_type ?? "");
      const pendingCount = Math.max(0, Math.round(toNumber((row as any)?.pending_count)));
      if (alertType === "custom") customCount = pendingCount;
    }

    results.push({
      date,
      prepayment_count: prepaymentCount,
      custom_count: customCount,
      total: prepaymentCount + customCount,
    });
  }

  return results;
}

export async function snoozeAlert(
  supabase: SupabaseClientLike,
  dailyStateId: string,
  note: string
) {
  const trimmed = String(note ?? "").trim();

  const { data, error } = await supabase
    .from("alert_daily_state")
    .update({
      status: "snoozed",
      snooze_note: trimmed || null,
    })
    .eq("id", dailyStateId)
    .in("status", ["pending", "snoozed"])
    .select("*")
    .maybeSingle();

  if (error) throw new Error(error.message);
  if (!data) throw new Error("Alert not found or cannot be snoozed.");
  return mapAlertDailyStateRow(data);
}

export async function clearAlert(
  supabase: SupabaseClientLike,
  actorUserId: string,
  dailyStateId: string,
  note: string
) {
  const trimmed = String(note ?? "").trim();
  if (!trimmed) throw new Error("note is required.");

  const { data: existing, error: existingError } = await supabase
    .from("alert_daily_state")
    .select("*")
    .eq("id", dailyStateId)
    .maybeSingle();

  if (existingError) throw new Error(existingError.message);
  if (!existing) throw new Error("Alert not found.");

  const nowIso = new Date().toISOString();
  const { data, error } = await supabase
    .from("alert_daily_state")
    .update({
      status: "cleared_manual",
      cleared_at: nowIso,
      cleared_by: actorUserId,
      clear_note: trimmed,
    })
    .eq("id", dailyStateId)
    .select("*")
    .single();

  if (error) throw new Error(error.message);

  if (existing.alert_type === "custom") {
    const { error: alarmError } = await supabase
      .from("booking_alarms")
      .update({
        status: "completed",
        completed_at: nowIso,
        completed_by: actorUserId,
        completion_note: trimmed,
      })
      .eq("id", existing.source_id);

    if (alarmError) throw new Error(alarmError.message);
  }

  return mapAlertDailyStateRow(data);
}

export async function adminForceClearAlert(
  supabase: SupabaseClientLike,
  actorUserId: string,
  dailyStateId: string,
  note: string
) {
  const trimmed = String(note ?? "").trim();
  if (!trimmed) throw new Error("note is required.");

  const { data, error } = await supabase.rpc("alert_admin_force_clear", {
    p_daily_state_id: dailyStateId,
    p_note: trimmed,
    p_user: actorUserId,
  });

  if (error) throw new Error(error.message);
  return data as Record<string, unknown>;
}

export async function finishAlertJob(
  supabase: SupabaseClientLike,
  actorUserId: string,
  businessDate: string
) {
  if (!isIsoDate(businessDate)) throw new Error("business date must be YYYY-MM-DD.");
  const existingJobLog = await fetchAlertJobLogForDate(supabase, businessDate);
  if (existingJobLog) {
    throw new Error(`Alert job already finished for ${businessDate}.`);
  }
  const { data, error } = await supabase.rpc("alert_finish_job", {
    p_business_date: businessDate,
    p_user: actorUserId,
  });

  if (error) throw new Error(error.message);
  return data as Record<string, unknown>;
}

export async function updateAlertJobTelegramStatus(params: {
  supabase: SupabaseClientLike;
  jobLogId: string;
  messageText: string | null;
  sentAt?: string | null;
  errorText?: string | null;
}) {
  const { error } = await params.supabase
    .from("alert_job_log")
    .update({
      telegram_sent_at: params.sentAt ?? null,
      telegram_message: params.messageText,
      telegram_error: params.errorText ?? null,
    })
    .eq("id", params.jobLogId);

  if (error) throw new Error(error.message);
}

export async function getNightAuditAlertCheck(
  supabase: SupabaseClientLike,
  date: string
): Promise<NightAuditAlertCheckResponse> {
  const context = await getBusinessDateContext(supabase);
  const payload = await listAlertsForDate(supabase, date, { materialize: true, context });
  const items = payload.items.filter((item) => item.status === "pending" || item.status === "snoozed");
  return {
    business_date: date,
    pending: items.filter((item) => item.status === "pending").length,
    items,
  };
}

export async function bulkSnoozeNightAuditAlerts(
  supabase: SupabaseClientLike,
  actorUserId: string,
  businessDate: string,
  nextDate: string,
  note: string
) {
  if (!isIsoDate(businessDate) || !isIsoDate(nextDate)) {
    throw new Error("date and next_date must be YYYY-MM-DD.");
  }
  const trimmed = String(note ?? "").trim();
  if (!trimmed) throw new Error("note is required.");

  const { data, error } = await supabase.rpc("alert_night_audit_bulk_snooze", {
    p_business_date: businessDate,
    p_next_date: nextDate,
    p_note: trimmed,
    p_user: actorUserId,
  });

  if (error) throw new Error(error.message);
  return Math.max(0, Math.round(toNumber(data)));
}
