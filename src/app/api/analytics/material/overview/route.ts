import { NextRequest, NextResponse } from "next/server";
import { analyticsApiError, requireAnalyticsAccess } from "@/lib/analytics/api-auth";
import { AnalyticsQueryError, parseAnalyticsQuery } from "@/lib/analytics/query";
import { fetchMaterialOverview } from "@/lib/analytics/overview/service";

export async function GET(request: NextRequest) {
  try {
    const { supabase } = await requireAnalyticsAccess(request);
    const query = parseAnalyticsQuery(request.nextUrl.searchParams);
    const data = await fetchMaterialOverview(supabase, query);
    return NextResponse.json({ success: true, data });
  } catch (err) {
    if (err instanceof AnalyticsQueryError) {
      return NextResponse.json({ success: false, error: err.message }, { status: err.status });
    }
    const { status, message } = analyticsApiError(err);
    return NextResponse.json({ success: false, error: message }, { status });
  }
}
