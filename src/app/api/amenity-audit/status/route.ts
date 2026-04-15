import { getAmenityAuditStatus } from "@/lib/fo-amenity-audit";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";
export const fetchCache = "force-no-store";

export async function GET() {
  try {
    const supabase = createServerSupabaseClient();
    const status = await getAmenityAuditStatus(supabase);
    return NextResponse.json({ success: true, ...status });
  } catch (err) {
    console.error("amenity-audit/status GET failed", err);
    const message = err instanceof Error ? err.message : "Internal server error";
    return NextResponse.json({ success: false, error: message }, { status: 500 });
  }
}
