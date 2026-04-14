// @ts-nocheck
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.4";

const JOB_NAME = "cleanup-expired-passport-scans";
const BATCH_SIZE = 500;
const STORAGE_CHUNK_SIZE = 100;

type CleanupPayload = {
  dry_run?: boolean;
  source?: string;
  triggered_by?: string;
};

function jsonResponse(body: Record<string, unknown>, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function getConfiguredSecret(): string {
  return (
    Deno.env.get("CLEANUP_FUNCTION_SECRET") ??
    Deno.env.get("SUPABASE_CLEANUP_FUNCTION_SECRET") ??
    ""
  );
}

function isAuthorized(req: Request): boolean {
  const expected = getConfiguredSecret();
  if (!expected) return true;

  const authHeader = req.headers.get("authorization") ?? "";
  const bearer = authHeader.match(/^Bearer\s+(.+)$/i)?.[1] ?? "";
  const headerSecret = req.headers.get("x-cleanup-secret") ?? "";
  return bearer === expected || headerSecret === expected;
}

function nowIso(): string {
  return new Date().toISOString();
}

Deno.serve(async (req) => {
  if (req.method !== "POST") {
    return jsonResponse({ success: false, error: "Method not allowed." }, 405);
  }
  if (!isAuthorized(req)) {
    return jsonResponse({ success: false, error: "Unauthorized." }, 401);
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!supabaseUrl || !serviceRoleKey) {
    return jsonResponse(
      { success: false, error: "Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY." },
      500
    );
  }

  const payload = (await req.json().catch(() => ({}))) as CleanupPayload;
  const dryRun = Boolean(payload.dry_run);
  const startedAt = Date.now();
  const startedAtIso = nowIso();
  const supabase = createClient(supabaseUrl, serviceRoleKey);

  try {
    const { data: expired, error: selectError } = await supabase
      .from("passport_scans")
      .select("id, image_path")
      .lt("expires_at", startedAtIso)
      .not("image_path", "is", null)
      .is("cleaned_at", null)
      .limit(BATCH_SIZE);

    if (selectError) throw new Error(selectError.message);
    const rows = (expired ?? []).filter((row) => Boolean((row as any).id));
    const totalCandidates = rows.length;

    if (dryRun) {
      return jsonResponse({
        success: true,
        dry_run: true,
        candidates: totalCandidates,
      });
    }

    let deletedFromStorage = 0;
    const paths = rows
      .map((row) => String((row as any).image_path ?? "").trim())
      .filter(Boolean);
    for (let i = 0; i < paths.length; i += STORAGE_CHUNK_SIZE) {
      const chunk = paths.slice(i, i + STORAGE_CHUNK_SIZE);
      const { error: removeError } = await supabase.storage
        .from("passport-photos")
        .remove(chunk);
      if (removeError) throw new Error(`Storage remove failed: ${removeError.message}`);
      deletedFromStorage += chunk.length;
    }

    const ids = rows.map((row) => String((row as any).id));
    if (ids.length > 0) {
      const { error: updateError } = await supabase
        .from("passport_scans")
        .update({
          image_path: null,
          ocr_raw: null,
          cleaned_at: nowIso(),
        })
        .in("id", ids);
      if (updateError) throw new Error(`Row cleanup failed: ${updateError.message}`);
    }

    const durationMs = Date.now() - startedAt;
    await supabase.from("cleanup_logs").insert({
      job_name: JOB_NAME,
      ran_at: startedAtIso,
      deleted_count: ids.length,
      duration_ms: durationMs,
      error_message: null,
    });

    await supabase
      .from("hotel_settings")
      .update({
        passport_cleanup_last_run_at: startedAtIso,
        passport_cleanup_last_deleted_count: ids.length,
        passport_cleanup_last_error: null,
      })
      .eq("id", 1);

    return jsonResponse({
      success: true,
      dry_run: false,
      deleted_rows: ids.length,
      deleted_storage_files: deletedFromStorage,
      duration_ms: durationMs,
      source: payload.source ?? "unknown",
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Cleanup failed.";
    const durationMs = Date.now() - startedAt;

    await supabase.from("cleanup_logs").insert({
      job_name: JOB_NAME,
      ran_at: startedAtIso,
      deleted_count: 0,
      duration_ms: durationMs,
      error_message: message,
    });
    await supabase
      .from("hotel_settings")
      .update({
        passport_cleanup_last_run_at: startedAtIso,
        passport_cleanup_last_deleted_count: 0,
        passport_cleanup_last_error: message,
      })
      .eq("id", 1);

    return jsonResponse({ success: false, error: message }, 500);
  }
});
