import { linenApiError, requireLinenAccess } from "@/lib/linen/api-auth";
import { listPendingItems } from "@/lib/linen/pending-service";
import { NextRequest, NextResponse } from "next/server";

export const dynamic = "force-dynamic";
export const fetchCache = "force-no-store";

export async function GET(request: NextRequest) {
  try {
    const { supabase } = await requireLinenAccess(request);
    const data = await listPendingItems(supabase);
    return NextResponse.json({ success: true, data });
  } catch (error) {
    console.error("api/linen/pending GET failed", error);
    const { status, message } = linenApiError(error, "Failed to load pending linen.");
    return NextResponse.json({ success: false, error: message }, { status });
  }
}
