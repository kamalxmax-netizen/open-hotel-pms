import { NextRequest, NextResponse } from "next/server";
import { analyticsApiError, requireAnalyticsAccess } from "@/lib/analytics/api-auth";
import { fetchAmenityCategories } from "@/lib/analytics/amenity/service";

export async function GET(request: NextRequest) {
    try {
        const { supabase } = await requireAnalyticsAccess(request);
        const data = await fetchAmenityCategories(supabase);
        return NextResponse.json({ success: true, data });
    } catch (err) {
        const { status, message } = analyticsApiError(err);
        return NextResponse.json({ error: message }, { status });
    }
}
