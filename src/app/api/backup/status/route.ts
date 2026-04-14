import { NextRequest, NextResponse } from "next/server";
import { BackupHttpError, getBackupStatus, requireAdminAccess } from "@/lib/backup";
import { createServerSupabaseClient } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const fetchCache = "force-no-store";

export async function GET(request: NextRequest) {
  try {
    const supabase = createServerSupabaseClient();
    await requireAdminAccess(supabase, request);

    const status = await getBackupStatus(supabase);
    return NextResponse.json({ success: true, data: status });
  } catch (error) {
    const status = error instanceof BackupHttpError ? error.status : 500;
    const message = error instanceof Error ? error.message : "Failed to load backup status.";
    console.error("api/backup/status GET failed", error);
    return NextResponse.json({ success: false, error: message }, { status });
  }
}
