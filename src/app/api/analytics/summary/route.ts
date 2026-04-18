import { NextRequest, NextResponse } from "next/server";
import { analyticsApiError, requireAnalyticsAccess } from "@/lib/analytics/api-auth";
import { AnalyticsQueryError, parseAnalyticsQuery } from "@/lib/analytics/query";
import { mockAmenityMetric } from "@/lib/analytics/mock";
import { worstTier } from "@/lib/analytics/variance";
import { fetchLinenTrend, fetchLinenVariance } from "@/lib/analytics/linen/service";

function percent(actual: number, baseline: number): number {
    if (baseline <= 0) return 0;
    return Math.round((actual / baseline) * 100);
}

export async function GET(request: NextRequest) {
    try {
        const { supabase } = await requireAnalyticsAccess(request);
        const query = parseAnalyticsQuery(request.nextUrl.searchParams);
        const [linen, linenTrend] = await Promise.all([
            fetchLinenVariance(supabase, query),
            fetchLinenTrend(supabase, query),
        ]);
        const amenity = mockAmenityMetric(query);

        const linenActual = linen.buckets.reduce((sum, bucket) => sum + bucket.actual, 0);
        const linenMax = linen.buckets.reduce((sum, bucket) => sum + bucket.baselines.max.value, 0);
        const amenityActual = amenity.buckets.reduce((sum, bucket) => sum + bucket.actual, 0);
        const amenityMax = amenity.buckets.reduce((sum, bucket) => sum + bucket.baselines.max.value, 0);
        const alerts = [...linen.buckets, ...amenity.buckets].filter((bucket) => bucket.alert).length;

        return NextResponse.json({
            success: true,
            data: {
                window: query.window,
                period_start: query.start,
                period_end: query.end,
                kpis: [
                    {
                        label: "Linen Usage",
                        value: percent(linenActual, linenMax),
                        unit: "%",
                        tier: worstTier(linen.buckets),
                        delta_pct: null,
                    },
                    {
                        label: "Amenity Usage",
                        value: percent(amenityActual, amenityMax),
                        unit: "%",
                        tier: worstTier(amenity.buckets),
                        delta_pct: null,
                    },
                    {
                        label: "Alerts",
                        value: alerts,
                        unit: "",
                        tier: alerts > 0 ? "red" : "green",
                        delta_pct: null,
                    },
                    {
                        label: "Coverage",
                        value: linenTrend.length,
                        unit: query.window === "day" ? "days" : query.window === "week" ? "weeks" : "months",
                        tier: "na",
                        delta_pct: null,
                    },
                ],
                trend: linenTrend,
            },
        });
    } catch (err) {
        if (err instanceof AnalyticsQueryError) {
            return NextResponse.json({ error: err.message }, { status: err.status });
        }
        const { status, message } = analyticsApiError(err);
        return NextResponse.json({ error: message }, { status });
    }
}
