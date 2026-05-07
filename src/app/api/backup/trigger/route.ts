import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import {
  BackupHttpError,
  requireAdminAccess,
  runDailyCloudBackup,
  runOfflineSnapshotSync,
} from "@/lib/backup";
import { createServerSupabaseClient } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const maxDuration = 60;
export const dynamic = "force-dynamic";
export const fetchCache = "force-no-store";

const triggerSchema = z.object({
  action: z.enum(["daily_cloud", "offline_snapshot"]).optional(),
  backup_type: z.enum(["daily_cloud", "offline_snapshot"]).optional(),
  mode: z.enum(["auto", "full", "incremental"]).optional(),
});

export async function POST(request: NextRequest) {
  try {
    const body = await request.json().catch(() => null);
    const parsed = triggerSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { success: false, error: "Invalid payload.", details: parsed.error.flatten() },
        { status: 400 }
      );
    }

    const action = parsed.data.action ?? parsed.data.backup_type;
    if (!action) {
      return NextResponse.json({ success: false, error: "action is required." }, { status: 400 });
    }

    const supabase = createServerSupabaseClient();
    await requireAdminAccess(supabase, request);

    const result =
      action === "daily_cloud"
        ? await runDailyCloudBackup(supabase, { mode: parsed.data.mode ?? "auto" })
        : await runOfflineSnapshotSync(supabase);

    return NextResponse.json({ success: true, action, data: result });
  } catch (error) {
    const status = error instanceof BackupHttpError ? error.status : 500;
    const message = error instanceof Error ? error.message : "Failed to trigger backup action.";
    console.error("api/backup/trigger POST failed", error);
    return NextResponse.json({ success: false, error: message }, { status });
  }
}
