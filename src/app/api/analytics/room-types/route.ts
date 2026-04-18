import { NextRequest, NextResponse } from "next/server";
import { analyticsApiError, requireAnalyticsAccess } from "@/lib/analytics/api-auth";

export async function GET(request: NextRequest) {
    try {
        const { supabase } = await requireAnalyticsAccess(request);
        const { data, error } = await supabase
            .from("rooms")
            .select("sort_order, room_types(code, name_en)")
            .eq("is_sellable", true)
            .eq("is_dayuse", false)
            .order("sort_order", { ascending: true });

        if (error) throw new Error(error.message);

        const optionMap = new Map<string, { value: string; label: string }>();
        for (const row of data ?? []) {
            const roomType = Array.isArray((row as any).room_types)
                ? (row as any).room_types[0]
                : (row as any).room_types;
            const value = String(roomType?.code ?? "").trim();
            const label = String(roomType?.name_en ?? value).trim();
            const normalized = `${value} ${label}`.toLowerCase();
            if (!value || !label) continue;
            if (value.toUpperCase() === "CLOSED" || normalized.includes("closed")) continue;
            if (!optionMap.has(value)) optionMap.set(value, { value, label });
        }

        const options = Array.from(optionMap.values());

        return NextResponse.json({ success: true, data: options });
    } catch (err) {
        const { status, message } = analyticsApiError(err);
        return NextResponse.json({ success: false, error: message }, { status });
    }
}
