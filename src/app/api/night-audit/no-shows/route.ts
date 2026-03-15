import { listPendingNoShows, getNightAuditSettings } from "@/lib/night-audit";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";
export const fetchCache = "force-no-store";

export async function GET() {
  try {
    const supabase = createServerSupabaseClient();
    const { businessDate } = await getNightAuditSettings(supabase);
    const noShows = await listPendingNoShows(supabase, businessDate);

    return NextResponse.json({
      success: true,
      business_date: businessDate,
      no_shows: noShows,
      count: noShows.length,
    });
  } catch (err) {
    console.error("night-audit/no-shows GET failed", err);
    const message = err instanceof Error ? err.message : "Internal server error";
    return NextResponse.json({ success: false, error: message }, { status: 500 });
  }
}
