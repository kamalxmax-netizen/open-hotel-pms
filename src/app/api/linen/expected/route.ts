import { calculateExpectedLinen, getCurrentBusinessDate } from "@/lib/linen/expected-calc";
import { linenApiError, requireLinenAccess } from "@/lib/linen/api-auth";
import { NextRequest, NextResponse } from "next/server";

export const dynamic = "force-dynamic";
export const fetchCache = "force-no-store";

export async function GET(request: NextRequest) {
  try {
    const { supabase } = await requireLinenAccess(request);
    const businessDate = request.nextUrl.searchParams.get("business_date") ?? await getCurrentBusinessDate(supabase);
    const cutoffTime = request.nextUrl.searchParams.get("cutoff_time") ?? undefined;
    const data = await calculateExpectedLinen(supabase, { businessDate, cutoffTime });
    return NextResponse.json({ success: true, data });
  } catch (error) {
    console.error("api/linen/expected GET failed", error);
    const { status, message } = linenApiError(error, "Failed to calculate expected linen.");
    return NextResponse.json({ success: false, error: message }, { status });
  }
}
