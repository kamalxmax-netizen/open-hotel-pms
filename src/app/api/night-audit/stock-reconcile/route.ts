import { createServerSupabaseClient } from "@/lib/supabase/server";
import { getCurrentBusinessDate, getStockReconcileStatus, isBusinessDate } from "@/lib/stock-snapshot";
import { NextRequest, NextResponse } from "next/server";

export const dynamic = "force-dynamic";
export const fetchCache = "force-no-store";

export async function GET(request: NextRequest) {
  try {
    const supabase = createServerSupabaseClient();
    const queryDate = request.nextUrl.searchParams.get("business_date");
    const businessDate = queryDate && isBusinessDate(queryDate)
      ? queryDate
      : await getCurrentBusinessDate(supabase);

    const status = await getStockReconcileStatus(supabase, businessDate);
    return NextResponse.json(status);
  } catch (err) {
    console.error("night-audit/stock-reconcile GET failed", err);
    const message = err instanceof Error ? err.message : "Internal server error";
    return NextResponse.json({ success: false, error: message }, { status: 500 });
  }
}
