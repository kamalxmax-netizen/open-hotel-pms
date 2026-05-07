import { NextRequest, NextResponse } from "next/server";
import { assertAuthorizedCronRequest, BackupHttpError, runDailyCloudBackup } from "@/lib/backup";
import { createServerSupabaseClient } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const maxDuration = 60;
export const dynamic = "force-dynamic";
export const fetchCache = "force-no-store";

export async function GET(request: NextRequest) {
  try {
    assertAuthorizedCronRequest(request);

    const supabase = createServerSupabaseClient();
    const result = await runDailyCloudBackup(supabase, { mode: "auto" });
    return NextResponse.json({ success: true, data: result });
  } catch (error) {
    const status = error instanceof BackupHttpError ? error.status : 500;
    const message = error instanceof Error ? error.message : "Daily backup failed.";
    console.error("api/cron/daily-backup GET failed", error);
    return NextResponse.json({ success: false, error: message }, { status });
  }
}
