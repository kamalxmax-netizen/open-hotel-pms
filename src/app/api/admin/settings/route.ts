import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireAdminRouteAccess } from "@/lib/guest-migration";
import {
  computePassportExpiryIso,
  DEFAULT_PASSPORT_RETENTION_DAYS,
  clampPassportRetentionDays,
} from "@/lib/passport-scan-retention";

export const dynamic = "force-dynamic";

const updateSchema = z.object({
  passport_photo_retention_days: z.number().int().min(7).max(90),
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

export async function GET(request: NextRequest) {
  const auth = await requireAdminRouteAccess(request);
  if (!auth.ok) return auth.response;

  const { supabase } = auth;
  const action = String(request.nextUrl.searchParams.get("action") ?? "").trim().toLowerCase();

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
      "passport_photo_retention_days, passport_cleanup_last_run_at, passport_cleanup_last_deleted_count, passport_cleanup_last_error"
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

  return NextResponse.json({
    success: true,
    setting: {
      key: "passport_photo_retention_days",
      value: String(retentionDays),
    },
    settings: {
      passport_photo_retention_days: retentionDays,
      ...cleanupMeta,
    },
  });
}

export async function PUT(request: NextRequest) {
  const auth = await requireAdminRouteAccess(request);
  if (!auth.ok) return auth.response;

  const parsed = updateSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json(
      { success: false, error: "Invalid payload.", details: parsed.error.flatten() },
      { status: 400 }
    );
  }

  const nextDays = clampPassportRetentionDays(parsed.data.passport_photo_retention_days);
  const { data, error } = await auth.supabase
    .from("hotel_settings")
    .upsert({
      id: 1,
      passport_photo_retention_days: nextDays,
      updated_at: new Date().toISOString(),
    })
    .select("passport_photo_retention_days")
    .maybeSingle();

  if (error) {
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }

  return NextResponse.json({
    success: true,
    settings: {
      passport_photo_retention_days: Number(
        (data as any)?.passport_photo_retention_days ?? nextDays
      ),
    },
    setting: {
      key: "passport_photo_retention_days",
      value: String(Number((data as any)?.passport_photo_retention_days ?? nextDays)),
    },
  });
}

export async function POST(request: NextRequest) {
  const auth = await requireAdminRouteAccess(request);
  if (!auth.ok) return auth.response;

  const applyExisting = isTruthy(request.nextUrl.searchParams.get("apply_existing"));
  const body = await request.json().catch(() => ({}));
  const parsed = updateSchema.partial().safeParse(body);
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

  const upsertPayload: Record<string, unknown> = {
    id: 1,
    passport_photo_retention_days: retentionDays,
    updated_at: new Date().toISOString(),
  };
  const { error: settingsError } = await auth.supabase
    .from("hotel_settings")
    .upsert(upsertPayload);
  if (settingsError && !isSchemaMissingError(settingsError.message)) {
    return NextResponse.json({ success: false, error: settingsError.message }, { status: 500 });
  }

  if (!applyExisting) {
    return NextResponse.json({
      success: true,
      applied_existing: false,
      setting: {
        key: "passport_photo_retention_days",
        value: String(retentionDays),
      },
    });
  }

  const { count: candidateCount, error: countError } = await auth.supabase
    .from("passport_scans")
    .select("id", { count: "exact", head: true })
    .not("image_path", "is", null)
    .is("cleaned_at", null);
  if (countError && !isSchemaMissingError(countError.message)) {
    return NextResponse.json({ success: false, error: countError.message }, { status: 500 });
  }

  const expiresAt = computePassportExpiryIso(retentionDays, new Date());
  const { error: applyError } = await auth.supabase
    .from("passport_scans")
    .update({ expires_at: expiresAt })
    .not("image_path", "is", null)
    .is("cleaned_at", null);
  if (applyError && !isSchemaMissingError(applyError.message)) {
    return NextResponse.json({ success: false, error: applyError.message }, { status: 500 });
  }

  return NextResponse.json({
    success: true,
    applied_existing: true,
    setting: {
      key: "passport_photo_retention_days",
      value: String(retentionDays),
    },
    total_updated: Number(candidateCount ?? 0),
    expires_at: expiresAt,
  });
}
