import { NextRequest, NextResponse } from "next/server";
import { analyticsApiError, requireAnalyticsAccess } from "@/lib/analytics/api-auth";
import { AnalyticsQueryError, parseAnalyticsQuery } from "@/lib/analytics/query";
import { mockAmenityMetric } from "@/lib/analytics/mock";

export async function GET(request: NextRequest) {
    try {
        await requireAnalyticsAccess(request);
        const query = parseAnalyticsQuery(request.nextUrl.searchParams);
        return NextResponse.json({ success: true, data: mockAmenityMetric(query) });
    } catch (err) {
        if (err instanceof AnalyticsQueryError) {
            return NextResponse.json({ error: err.message }, { status: err.status });
        }
        const { status, message } = analyticsApiError(err);
        return NextResponse.json({ error: message }, { status });
    }
}
