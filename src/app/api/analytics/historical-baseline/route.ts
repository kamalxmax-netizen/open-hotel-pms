import { NextRequest, NextResponse } from "next/server";
import { analyticsApiError, requireAnalyticsAccess } from "@/lib/analytics/api-auth";
import type {
    AnalyticsHistoricalAmenity,
    AnalyticsHistoricalBaselineResponse,
    AnalyticsHistoricalLinen,
    AnalyticsHistoricalRoomtype,
    HistoricalBaselineType,
} from "@/lib/analytics/types";
import type { SupabaseClient } from "@supabase/supabase-js";

const HISTORICAL_TYPES: HistoricalBaselineType[] = ["amenity", "linen", "roomtype", "all"];

class HistoricalBaselineQueryError extends Error {
    status: number;

    constructor(message: string, status = 400) {
        super(message);
        this.name = "HistoricalBaselineQueryError";
        this.status = status;
    }
}

function parseRequiredYear(params: URLSearchParams): number {
    const raw = params.get("year");
    const year = Number(raw);
    if (!raw || !Number.isInteger(year) || year < 2025 || year > 2026) {
        throw new HistoricalBaselineQueryError("year must be 2025 or 2026");
    }
    return year;
}

function parseOptionalMonth(params: URLSearchParams): number | null {
    const raw = params.get("month");
    if (!raw) return null;
    const month = Number(raw);
    if (!Number.isInteger(month) || month < 1 || month > 12) {
        throw new HistoricalBaselineQueryError("month must be between 1 and 12");
    }
    return month;
}

function parseHistoricalType(params: URLSearchParams): HistoricalBaselineType {
    const raw = (params.get("type") ?? "all").trim().toLowerCase() as HistoricalBaselineType;
    if (!HISTORICAL_TYPES.includes(raw)) {
        throw new HistoricalBaselineQueryError("type must be amenity, linen, roomtype, or all");
    }
    return raw;
}

function withMonthFilter(query: any, year: number, month: number | null) {
    const scoped = query.eq("year", year);
    return month === null ? scoped : scoped.eq("month", month);
}

async function fetchAmenity(
    supabase: SupabaseClient,
    year: number,
    month: number | null
): Promise<AnalyticsHistoricalAmenity[]> {
    const { data, error } = await withMonthFilter(
        supabase
            .from("analytics_historical_monthly_amenity")
            .select("*")
            .order("month", { ascending: true }),
        year,
        month
    );
    if (error) throw new Error(error.message);
    return (data ?? []) as AnalyticsHistoricalAmenity[];
}

async function fetchLinen(
    supabase: SupabaseClient,
    year: number,
    month: number | null
): Promise<AnalyticsHistoricalLinen[]> {
    const { data, error } = await withMonthFilter(
        supabase
            .from("analytics_historical_monthly_linen")
            .select("*, linen_items(item_number, name_th, name_en)")
            .order("month", { ascending: true }),
        year,
        month
    ).order("linen_item_id", { ascending: true });
    if (error) throw new Error(error.message);

    return (data ?? []).map((row: any) => ({
        ...row,
        linen_item_number: row.linen_items?.item_number ?? null,
        linen_item_name_th: row.linen_items?.name_th ?? null,
        linen_item_name_en: row.linen_items?.name_en ?? null,
        linen_items: undefined,
    })) as AnalyticsHistoricalLinen[];
}

async function fetchRoomtype(
    supabase: SupabaseClient,
    year: number,
    month: number | null
): Promise<AnalyticsHistoricalRoomtype[]> {
    const { data, error } = await withMonthFilter(
        supabase
            .from("analytics_historical_monthly_roomtype")
            .select("*")
            .order("month", { ascending: true }),
        year,
        month
    ).order("room_type_code", { ascending: true });
    if (error) throw new Error(error.message);
    return (data ?? []) as AnalyticsHistoricalRoomtype[];
}

export async function GET(request: NextRequest) {
    try {
        const { supabase } = await requireAnalyticsAccess(request);
        const params = request.nextUrl.searchParams;
        const year = parseRequiredYear(params);
        const month = parseOptionalMonth(params);
        const type = parseHistoricalType(params);

        const shouldFetchAmenity = type === "all" || type === "amenity";
        const shouldFetchLinen = type === "all" || type === "linen";
        const shouldFetchRoomtype = type === "all" || type === "roomtype";

        const [amenity, linen, roomtype] = await Promise.all([
            shouldFetchAmenity ? fetchAmenity(supabase, year, month) : Promise.resolve([]),
            shouldFetchLinen ? fetchLinen(supabase, year, month) : Promise.resolve([]),
            shouldFetchRoomtype ? fetchRoomtype(supabase, year, month) : Promise.resolve([]),
        ]);

        const response: AnalyticsHistoricalBaselineResponse = {
            success: true,
            amenity,
            linen,
            roomtype,
        };

        return NextResponse.json(response);
    } catch (err) {
        if (err instanceof HistoricalBaselineQueryError) {
            return NextResponse.json({ success: false, error: err.message }, { status: err.status });
        }
        const { status, message } = analyticsApiError(err);
        return NextResponse.json({ success: false, error: message }, { status });
    }
}
