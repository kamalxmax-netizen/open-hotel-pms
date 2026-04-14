import { NextRequest, NextResponse } from "next/server";
import { requireAdminRouteAccess } from "@/lib/guest-migration";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const auth = await requireAdminRouteAccess(request);
  if (!auth.ok) return auth.response;

  const limitRaw = Number(request.nextUrl.searchParams.get("limit") ?? 20);
  const limit = Number.isFinite(limitRaw) ? Math.max(1, Math.min(100, Math.trunc(limitRaw))) : 20;

  const { data, error } = await auth.supabase
    .from("cleanup_logs")
    .select("id, job_name, ran_at, deleted_count, error_message, duration_ms")
    .eq("job_name", "cleanup-expired-passport-scans")
    .order("ran_at", { ascending: false })
    .limit(limit);

  if (error) {
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }

  return NextResponse.json({
    success: true,
    logs: data ?? [],
  });
}

export async function POST(request: NextRequest) {
  const auth = await requireAdminRouteAccess(request);
  if (!auth.ok) return auth.response;

  const functionUrl = process.env.SUPABASE_CLEANUP_FUNCTION_URL;
  const functionSecret =
    process.env.CLEANUP_FUNCTION_SECRET ?? process.env.SUPABASE_CLEANUP_FUNCTION_SECRET;
  if (!functionUrl || !functionSecret) {
    return NextResponse.json(
      {
        success: false,
        error:
          "Missing SUPABASE_CLEANUP_FUNCTION_URL or CLEANUP_FUNCTION_SECRET.",
      },
      { status: 500 }
    );
  }

  const payload = await request.json().catch(() => ({}));
  const dryRun = Boolean(payload?.dry_run);

  try {
    const response = await fetch(functionUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${functionSecret}`,
      },
      body: JSON.stringify({
        source: "manual_trigger",
        triggered_by: auth.userId,
        dry_run: dryRun,
      }),
      cache: "no-store",
    });

    const result = await response.json().catch(() => null);
    if (!response.ok) {
      return NextResponse.json(
        {
          success: false,
          error: result?.error || `Cleanup function failed (${response.status}).`,
          details: result ?? null,
        },
        { status: 502 }
      );
    }

    return NextResponse.json({
      success: true,
      result,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to call cleanup function.";
    return NextResponse.json({ success: false, error: message }, { status: 500 });
  }
}
