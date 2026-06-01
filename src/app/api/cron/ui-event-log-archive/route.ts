import { NextRequest, NextResponse } from "next/server";
import { assertAuthorizedCronRequest, BackupHttpError } from "@/lib/backup";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { runUiEventLogArchive } from "@/lib/ui-event-log-archive";

export const runtime = "nodejs";
export const maxDuration = 60;
export const dynamic = "force-dynamic";
export const fetchCache = "force-no-store";

export async function GET(request: NextRequest) {
  try {
    assertAuthorizedCronRequest(request);
    const dryRun = request.nextUrl.searchParams.get("dry_run") === "1";
    const supabase = createServerSupabaseClient();
    const data = await runUiEventLogArchive(supabase, { dryRun });
    return NextResponse.json({ success: true, data });
  } catch (error) {
    const status = error instanceof BackupHttpError ? error.status : 500;
    const message = error instanceof Error ? error.message : "UI event log archive failed.";
    console.error("api/cron/ui-event-log-archive GET failed", error);
    return NextResponse.json({ success: false, error: message }, { status });
  }
}

export const POST = GET;
