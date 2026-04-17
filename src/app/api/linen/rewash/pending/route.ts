import { getCurrentBusinessDate } from "@/lib/linen/expected-calc";
import { linenApiError, requireLinenAccess } from "@/lib/linen/api-auth";
import { listPendingRewashEvents } from "@/lib/linen/rewash";
import { NextRequest, NextResponse } from "next/server";

export const dynamic = "force-dynamic";
export const fetchCache = "force-no-store";

export async function GET(request: NextRequest) {
  try {
    const { supabase } = await requireLinenAccess(request);
    const asOf = request.nextUrl.searchParams.get("as_of") ?? await getCurrentBusinessDate(supabase);
    const events = await listPendingRewashEvents(supabase, { asOf });
    return NextResponse.json({ success: true, data: { events } });
  } catch (error) {
    console.error("api/linen/rewash/pending GET failed", error);
    const { status, message } = linenApiError(error, "Failed to list pending rewash events.");
    return NextResponse.json({ success: false, error: message }, { status });
  }
}
