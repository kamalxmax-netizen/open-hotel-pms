import { NextRequest, NextResponse } from "next/server";
import {
  authorizeOfflineSnapshotRequest,
  BackupHttpError,
  getLatestSnapshot,
} from "@/lib/backup";
import { createServerSupabaseClient } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const fetchCache = "force-no-store";

export async function GET(request: NextRequest) {
  try {
    const supabase = createServerSupabaseClient();
    await authorizeOfflineSnapshotRequest(supabase, request);

    const snapshot = await getLatestSnapshot(supabase);
    if (!snapshot) {
      return NextResponse.json({ success: false, error: "No snapshot available." }, { status: 404 });
    }

    return NextResponse.json({ success: true, data: snapshot });
  } catch (error) {
    const status = error instanceof BackupHttpError ? error.status : 500;
    const message = error instanceof Error ? error.message : "Failed to load snapshot.";
    console.error("api/backup/snapshot GET failed", error);
    return NextResponse.json({ success: false, error: message }, { status });
  }
}
