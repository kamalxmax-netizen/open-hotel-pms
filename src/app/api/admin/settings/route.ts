import type { AdminRateSettings } from "@/lib/rates/types";
import type { DynamicEngineSettings } from "@/lib/rates/dynamic-types";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireAdminRouteAccess } from "@/lib/guest-migration";
import { getAuthenticatedUser, getUserRole } from "@/lib/server-auth";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import {
  computePassportExpiryIso,
  DEFAULT_PASSPORT_RETENTION_DAYS,
  clampPassportRetentionDays,
} from "@/lib/passport-scan-retention";

export const dynamic = "force-dynamic";

const legacyUpdateSchema = z
  .object({
    passport_photo_retention_days: z.number().int().min(7).max(90).optional(),
    google_sheet_sync_enabled: z.boolean().optional(),
  })
  .refine(
    (value) =>
      value.passport_photo_retention_days !== undefined ||
      value.google_sheet_sync_enabled !== undefined,
    { message: "At least one setting must be provided." }
  );

const partialUpdateSchema = z.object({
  passport_photo_retention_days: z.number().int().min(7).max(90).optional(),
  google_sheet_sync_enabled: z.boolean().optional(),
});

const phase72PutSchema = z.object({
  key: z.string().trim().min(1),
  value: z.unknown(),
});

function isTruthy(value: string | null): boolean {
  if (!value) return false;
  const normalized = value.trim().toLowerCase();
  return normalized === "1" || normalized === "true" || normalized === "yes" || normalized === "on";
}

function isSchemaMissingError(message?: string | null): boolean {
  if (!message) return false;
  return /column .* does not exist|relation .* does not exist|passport_photo_retention_days|cleanup_logs/i.test(
    message
  );
}

function parseAppSettingNumber(value: unknown, fallback: number) {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim()) {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return fallback;
}

function parseAppSettingString(value: unknown) {
  const normalized = String(value ?? "").trim();
  return normalized || null;
}

type AdminSettingsPayload = AdminRateSettings &
  DynamicEngineSettings & {
    telegram_admin_chat_id: string | null;
  };

async function readRateSettings(supabase: any): Promise<AdminSettingsPayload> {
  const [{ data: roomTypes, error: roomTypeError }, { data: appRows, error: appError }] = await Promise.all([
    supabase
      .from("room_types")
      .select("id, min_rate_floor")
      .order("sort_order", { ascending: true })
      .order("id", { ascending: true }),
    supabase.from("app_settings").select("key, value_json").in("key", [
      "rate.price_delta_warn_threshold",
      "ota.alarm_minutes",
      "telegram.admin_chat_id",
      "rate.dynamic_max_multiplier",
      "rate.dynamic_eval_window_days",
      "rate.dynamic_undo_window_minutes",
      "rate.dynamic_suggestion_stale_minutes",
    ]),
  ]);

  if (roomTypeError) throw new Error(roomTypeError.message);
  if (appError) throw new Error(appError.message);

  const appMap = new Map<string, unknown>();
  for (const row of appRows ?? []) {
    appMap.set(String((row as any).key ?? ""), (row as any).value_json);
  }

  const min_rate_floor = Object.fromEntries(
    (roomTypes ?? []).map((row: any) => [
      String(row.id),
      row.min_rate_floor == null ? null : Number(row.min_rate_floor),
    ])
  );

  return {
    min_rate_floor,
    price_delta_warn_threshold: parseAppSettingNumber(appMap.get("rate.price_delta_warn_threshold"), 0.2),
    alarm_minutes: Math.max(30, Math.min(480, parseAppSettingNumber(appMap.get("ota.alarm_minutes"), 120))),
    dynamic_max_multiplier: Math.max(
      1,
      Math.min(3, parseAppSettingNumber(appMap.get("rate.dynamic_max_multiplier"), 1.5))
    ),
    dynamic_eval_window_days: Math.max(
      7,
      Math.min(120, Math.round(parseAppSettingNumber(appMap.get("rate.dynamic_eval_window_days"), 60)))
    ),
    dynamic_undo_window_minutes: Math.max(
      5,
      Math.min(240, Math.round(parseAppSettingNumber(appMap.get("rate.dynamic_undo_window_minutes"), 60)))
    ),
    dynamic_suggestion_stale_minutes: Math.max(
      30,
      Math.min(720, Math.round(parseAppSettingNumber(appMap.get("rate.dynamic_suggestion_stale_minutes"), 120)))
    ),
    telegram_admin_chat_id:
      parseAppSettingString(appMap.get("telegram.admin_chat_id")) ||
      parseAppSettingString(process.env.TELEGRAM_ADMIN_CHAT_ID),
  };
}

async function canReadRatesSettings(request: NextRequest) {
  const supabase = createServerSupabaseClient();
  const user = await getAuthenticatedUser(supabase, request);
  if (!user) return null;

  const role = await getUserRole(supabase, user.id);
  const allowed = role === "admin" || role === "frontdesk" || role === "supervisor" || role === "manager" || role === "owner";
  if (!allowed) return null;

  return { supabase, userId: user.id, role };
}

async function upsertAppSetting(params: {
  supabase: any;
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

async function syncTelegramAdminSubscription(supabase: any, chatId: string | null) {
  if (!chatId) {
    const { error } = await supabase
      .from("telegram_alert_subscriptions")
      .update({ is_active: false })
      .eq("role", "admin");
    if (error) throw new Error(error.message);
    return;
  }

  const numericChatId = Number(chatId);
  if (!Number.isInteger(numericChatId)) {
    throw new Error("telegram.admin_chat_id must be a valid numeric chat id.");
  }

  const { error: deactivateError } = await supabase
    .from("telegram_alert_subscriptions")
    .update({ is_active: false })
    .eq("role", "admin")
    .neq("chat_id", numericChatId);
  if (deactivateError) throw new Error(deactivateError.message);

  const { error: upsertError } = await supabase.from("telegram_alert_subscriptions").upsert(
    {
      chat_id: numericChatId,
      role: "admin",
      is_active: true,
    },
    { onConflict: "chat_id" }
  );
  if (upsertError) throw new Error(upsertError.message);
}

async function handlePhase72Put(auth: { supabase: any; userId: string }, payload: { key: string; value?: unknown }) {
  const key = payload.key;

  if (key === "rate.price_delta_warn_threshold") {
    const nextValue = Number(payload.value);
    if (!Number.isFinite(nextValue) || nextValue < 0.05 || nextValue > 0.5) {
      return NextResponse.json({ success: false, error: "Threshold must be between 0.05 and 0.50." }, { status: 400 });
    }
    await upsertAppSetting({
      supabase: auth.supabase,
      userId: auth.userId,
      key,
      value: nextValue,
      description: "Fraction. Edits above this delta show a warning modal.",
    });
  } else if (key === "ota.alarm_minutes") {
    const nextValue = Number(payload.value);
    if (!Number.isFinite(nextValue) || nextValue < 30 || nextValue > 480) {
      return NextResponse.json({ success: false, error: "Alarm minutes must be between 30 and 480." }, { status: 400 });
    }
    await upsertAppSetting({
      supabase: auth.supabase,
      userId: auth.userId,
      key,
      value: Math.round(nextValue),
      description: "Minutes before pending OTA sync tasks trigger a Telegram alert.",
    });
  } else if (key === "telegram.admin_chat_id") {
    const nextValue = String(payload.value ?? "").trim();
    await upsertAppSetting({
      supabase: auth.supabase,
      userId: auth.userId,
      key,
      value: nextValue,
      description: "Admin Telegram chat id configured from the bot /start flow.",
    });
    await syncTelegramAdminSubscription(auth.supabase, nextValue || null);
  } else if (key === "rate.dynamic_max_multiplier") {
    const nextValue = Number(payload.value);
    if (!Number.isFinite(nextValue) || nextValue < 1 || nextValue > 3) {
      return NextResponse.json({ success: false, error: "Max multiplier must be between 1.0 and 3.0." }, { status: 400 });
    }
    await upsertAppSetting({
      supabase: auth.supabase,
      userId: auth.userId,
      key,
      value: Math.round(nextValue * 10) / 10,
      description: "Max multiple of current base price a dynamic suggestion may output.",
    });
  } else if (key === "rate.dynamic_eval_window_days") {
    const nextValue = Number(payload.value);
    if (!Number.isFinite(nextValue) || nextValue < 7 || nextValue > 120) {
      return NextResponse.json({ success: false, error: "Evaluation window must be between 7 and 120 days." }, { status: 400 });
    }
    await upsertAppSetting({
      supabase: auth.supabase,
      userId: auth.userId,
      key,
      value: Math.round(nextValue),
      description: "Default look-ahead window in days for scheduled evaluations.",
    });
  } else if (key === "rate.dynamic_undo_window_minutes") {
    const nextValue = Number(payload.value);
    if (!Number.isFinite(nextValue) || nextValue < 5 || nextValue > 240) {
      return NextResponse.json({ success: false, error: "Undo window must be between 5 and 240 minutes." }, { status: 400 });
    }
    await upsertAppSetting({
      supabase: auth.supabase,
      userId: auth.userId,
      key,
      value: Math.round(nextValue),
      description: "Minutes after apply during which a dynamic rate change may be undone.",
    });
  } else if (key === "rate.dynamic_suggestion_stale_minutes") {
    const nextValue = Number(payload.value);
    if (!Number.isFinite(nextValue) || nextValue < 30 || nextValue > 720) {
      return NextResponse.json({ success: false, error: "Suggestion stale minutes must be between 30 and 720." }, { status: 400 });
    }
    await upsertAppSetting({
      supabase: auth.supabase,
      userId: auth.userId,
      key,
      value: Math.round(nextValue),
      description: "Minutes a dynamic suggestion may sit before Telegram alerts admin.",
    });
  } else if (key.startsWith("room_type.") && key.endsWith(".min_rate_floor")) {
    const roomTypeId = key.slice("room_type.".length, -".min_rate_floor".length);
    const nextValue =
      payload.value == null || String(payload.value).trim() === ""
        ? null
        : Number(payload.value);

    if (nextValue != null && (!Number.isFinite(nextValue) || nextValue < 0)) {
      return NextResponse.json({ success: false, error: "min_rate_floor must be null or >= 0." }, { status: 400 });
    }

    const { data, error } = await auth.supabase
      .from("room_types")
      .update({ min_rate_floor: nextValue })
      .eq("id", roomTypeId)
      .select("id")
      .maybeSingle();

    if (error) {
      return NextResponse.json({ success: false, error: error.message }, { status: 500 });
    }
    if (!data) {
      return NextResponse.json({ success: false, error: "Room type not found." }, { status: 404 });
    }
  } else {
    return NextResponse.json({ success: false, error: "Unsupported admin setting key." }, { status: 400 });
  }

  const rateSettings = await readRateSettings(auth.supabase);
  return NextResponse.json({
    success: true,
    key: payload.key,
    value: payload.value,
    rate_settings: rateSettings,
    ...rateSettings,
  });
}

export async function GET(request: NextRequest) {
  const action = String(request.nextUrl.searchParams.get("action") ?? "").trim().toLowerCase();
  const scope = String(request.nextUrl.searchParams.get("scope") ?? "").trim().toLowerCase();

  if (scope === "rates") {
    const actor = await canReadRatesSettings(request);
    if (!actor) {
      return NextResponse.json({ success: false, error: "Forbidden." }, { status: 403 });
    }

    const rateSettings = await readRateSettings(actor.supabase);
    return NextResponse.json({
      success: true,
      min_rate_floor: rateSettings.min_rate_floor,
      price_delta_warn_threshold: rateSettings.price_delta_warn_threshold,
      alarm_minutes: rateSettings.alarm_minutes,
    });
  }

  const auth = await requireAdminRouteAccess(request);
  if (!auth.ok) return auth.response;

  const { supabase } = auth;

  if (action === "stats") {
    const { count, error } = await supabase
      .from("passport_scans")
      .select("id", { count: "exact", head: true })
      .not("image_path", "is", null)
      .is("cleaned_at", null);

    if (error && !isSchemaMissingError(error.message)) {
      return NextResponse.json({ success: false, error: error.message }, { status: 500 });
    }

    return NextResponse.json({
      success: true,
      total_uncleaned: Number(count ?? 0),
    });
  }

  let retentionDays = DEFAULT_PASSPORT_RETENTION_DAYS;
  let cleanupMeta: Record<string, unknown> = {
    last_run_at: null,
    last_deleted_count: 0,
    last_error: null,
  };

  const { data: settings, error: settingsError } = await supabase
    .from("hotel_settings")
    .select(
      "passport_photo_retention_days, google_sheet_sync_enabled, passport_cleanup_last_run_at, passport_cleanup_last_deleted_count, passport_cleanup_last_error"
    )
    .eq("id", 1)
    .maybeSingle();

  if (settingsError && !isSchemaMissingError(settingsError.message)) {
    return NextResponse.json({ success: false, error: settingsError.message }, { status: 500 });
  }

  if (settings) {
    retentionDays = clampPassportRetentionDays(
      Number((settings as any).passport_photo_retention_days ?? DEFAULT_PASSPORT_RETENTION_DAYS)
    );
    cleanupMeta = {
      last_run_at: (settings as any).passport_cleanup_last_run_at ?? null,
      last_deleted_count: Number((settings as any).passport_cleanup_last_deleted_count ?? 0),
      last_error: (settings as any).passport_cleanup_last_error ?? null,
    };
  }

  const { data: latestLog, error: latestLogError } = await supabase
    .from("cleanup_logs")
    .select("ran_at, deleted_count, error_message, duration_ms")
    .eq("job_name", "cleanup-expired-passport-scans")
    .order("ran_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (!latestLogError && latestLog) {
    cleanupMeta = {
      last_run_at: (latestLog as any).ran_at ?? cleanupMeta.last_run_at ?? null,
      last_deleted_count: Number((latestLog as any).deleted_count ?? cleanupMeta.last_deleted_count ?? 0),
      last_error: (latestLog as any).error_message ?? cleanupMeta.last_error ?? null,
      duration_ms: Number((latestLog as any).duration_ms ?? 0),
    };
  }

  const rateSettings = await readRateSettings(supabase);

  return NextResponse.json({
    success: true,
    setting: {
      key: "passport_photo_retention_days",
      value: String(retentionDays),
    },
    settings: {
      passport_photo_retention_days: retentionDays,
      google_sheet_sync_enabled: (settings as any).google_sheet_sync_enabled !== false,
      ...cleanupMeta,
    },
    rate_settings: rateSettings,
    ...rateSettings,
  });
}

export async function PUT(request: NextRequest) {
  const auth = await requireAdminRouteAccess(request);
  if (!auth.ok) return auth.response;

  const body = await request.json().catch(() => null);
  const phase72Parsed = phase72PutSchema.safeParse(body);
  if (phase72Parsed.success) {
    return handlePhase72Put(auth, phase72Parsed.data);
  }

  const parsed = legacyUpdateSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { success: false, error: "Invalid payload.", details: parsed.error.flatten() },
      { status: 400 }
    );
  }

  const nextDays =
    parsed.data.passport_photo_retention_days != null
      ? clampPassportRetentionDays(parsed.data.passport_photo_retention_days)
      : null;
  const nextGoogleSheetSyncEnabled =
    parsed.data.google_sheet_sync_enabled != null
      ? Boolean(parsed.data.google_sheet_sync_enabled)
      : null;
  const upsertPayload: Record<string, unknown> = {
    id: 1,
    updated_at: new Date().toISOString(),
  };
  if (nextDays != null) {
    upsertPayload.passport_photo_retention_days = nextDays;
  }
  if (nextGoogleSheetSyncEnabled != null) {
    upsertPayload.google_sheet_sync_enabled = nextGoogleSheetSyncEnabled;
  }

  const { data, error } = await auth.supabase
    .from("hotel_settings")
    .upsert(upsertPayload)
    .select("passport_photo_retention_days, google_sheet_sync_enabled")
    .maybeSingle();

  if (error) {
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }

  return NextResponse.json({
    success: true,
    settings: {
      passport_photo_retention_days: Number(
        (data as any)?.passport_photo_retention_days ??
          nextDays ??
          DEFAULT_PASSPORT_RETENTION_DAYS
      ),
      google_sheet_sync_enabled:
        (data as any)?.google_sheet_sync_enabled !== false &&
        nextGoogleSheetSyncEnabled !== false,
    },
    setting: {
      key: "passport_photo_retention_days",
      value: String(
        Number(
          (data as any)?.passport_photo_retention_days ??
            nextDays ??
            DEFAULT_PASSPORT_RETENTION_DAYS
        )
      ),
    },
  });
}

export async function POST(request: NextRequest) {
  const auth = await requireAdminRouteAccess(request);
  if (!auth.ok) return auth.response;

  const applyExisting = isTruthy(request.nextUrl.searchParams.get("apply_existing"));
  const body = await request.json().catch(() => ({}));
  const parsed = partialUpdateSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { success: false, error: "Invalid payload.", details: parsed.error.flatten() },
      { status: 400 }
    );
  }

  let retentionDays = DEFAULT_PASSPORT_RETENTION_DAYS;
  const requestedDays = parsed.data.passport_photo_retention_days;
  if (requestedDays != null) {
    retentionDays = clampPassportRetentionDays(requestedDays);
  } else {
    const { data, error } = await auth.supabase
      .from("hotel_settings")
      .select("passport_photo_retention_days")
      .eq("id", 1)
      .maybeSingle();
    if (error && !isSchemaMissingError(error.message)) {
      return NextResponse.json({ success: false, error: error.message }, { status: 500 });
    }
    retentionDays = clampPassportRetentionDays(
      Number((data as any)?.passport_photo_retention_days ?? DEFAULT_PASSPORT_RETENTION_DAYS)
    );
  }

  const { data: scans, error: scansError } = await auth.supabase
    .from("passport_scans")
    .select("id, created_at, cleaned_at")
    .is("cleaned_at", null)
    .limit(5000);

  if (scansError) {
    return NextResponse.json({ success: false, error: scansError.message }, { status: 500 });
  }

  const nowIso = new Date().toISOString();
  const rows = (scans ?? []).map((scan: any) => ({
    id: scan.id,
    expires_at: computePassportExpiryIso(retentionDays, new Date(String(scan.created_at ?? nowIso))),
  }));

  if (!applyExisting) {
    return NextResponse.json({
      success: true,
      retention_days: retentionDays,
      would_delete_count: rows.length,
    });
  }

  if (rows.length > 0) {
    const { error: updateError } = await auth.supabase
      .from("passport_scans")
      .upsert(rows, { onConflict: "id" });
    if (updateError) {
      return NextResponse.json({ success: false, error: updateError.message }, { status: 500 });
    }
  }

  return NextResponse.json({
    success: true,
    retention_days: retentionDays,
    recalculated_count: rows.length,
  });
}
