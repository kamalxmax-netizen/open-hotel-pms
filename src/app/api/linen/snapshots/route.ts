import { getCurrentBusinessDate } from "@/lib/linen/expected-calc";
import { getLinenDailySnapshot } from "@/lib/linen/daily-snapshot";
import { linenApiError, requireLinenAccess } from "@/lib/linen/api-auth";
import { NextRequest, NextResponse } from "next/server";

export const dynamic = "force-dynamic";
export const fetchCache = "force-no-store";

function isBusinessDate(value: string | null): value is string {
  return /^\d{4}-\d{2}-\d{2}$/.test(String(value ?? ""));
}

export async function GET(request: NextRequest) {
  try {
    const { supabase, actor } = await requireLinenAccess(request);
    const requestedDate = request.nextUrl.searchParams.get("business_date");
    const businessDate = isBusinessDate(requestedDate) ? requestedDate : await getCurrentBusinessDate(supabase);
    const snapshot = await getLinenDailySnapshot(supabase, businessDate);

    return NextResponse.json({
      success: true,
      data: {
        business_date: businessDate,
        snapshot,
        can_recompute: actor.isAdmin,
      },
    });
  } catch (error) {
    console.error("api/linen/snapshots GET failed", error);
    const { status, message } = linenApiError(error, "Failed to load linen daily snapshot.");
    return NextResponse.json({ success: false, error: message }, { status });
  }
}
