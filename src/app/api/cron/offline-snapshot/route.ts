import { NextRequest, NextResponse } from "next/server";
import { assertAuthorizedCronRequest, BackupHttpError, runOfflineSnapshotSync } from "@/lib/backup";
import { createServerSupabaseClient } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const fetchCache = "force-no-store";

export async function GET(request: NextRequest) {
  try {
    assertAuthorizedCronRequest(request);

    const supabase = createServerSupabaseClient();
    const result = await runOfflineSnapshotSync(supabase);
    return NextResponse.json({ success: true, data: result });
  } catch (error) {
    const status = error instanceof BackupHttpError ? error.status : 500;
    const message = error instanceof Error ? error.message : "Offline snapshot failed.";
    console.error("api/cron/offline-snapshot GET failed", error);
    return NextResponse.json({ success: false, error: message }, { status });
  }
}
