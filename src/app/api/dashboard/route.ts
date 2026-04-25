import { createServerSupabaseClient } from "@/lib/supabase/server";
import { resolveBusinessDate, toLocalDate } from "@/lib/folio-fees";
import { requireStaffAuth } from "@/lib/server-auth";
import { NextRequest, NextResponse } from "next/server";

export async function GET(request: NextRequest) {
    try {
        const supabase = createServerSupabaseClient();
        const auth = await requireStaffAuth(supabase, request);
        if (auth.error) return auth.error;

        const calendarDate = toLocalDate(new Date(), "Asia/Bangkok");
        const businessDate = await resolveBusinessDate(supabase, calendarDate);

        // Run all counts in parallel
        const [arrivalsRes, departuresRes, inHouseRes, dirtyRes, sellableRes] = await Promise.all([
            // Arrivals on business date (checkin_date = businessDate, status = active)
            supabase
                .from("reservations")
                .select("id, guest_name, source, checkin_time, total_price", { count: "exact" })
                .eq("checkin_date", businessDate)
                .eq("status", "active"),

            // Departures on business date (checkout_date = businessDate, status = active)
            supabase
                .from("reservations")
                .select("id, guest_name, total_price", { count: "exact" })
                .eq("checkout_date", businessDate)
                .eq("status", "active"),

            // In-house for business date (checkin_date <= businessDate < checkout_date, status = active)
            supabase
                .from("reservations")
                .select("id", { count: "exact" })
                .lte("checkin_date", businessDate)
                .gt("checkout_date", businessDate)
                .eq("status", "active"),

            // Dirty rooms on business date with status = dirty or in_progress
            supabase
                .from("housekeeping_tasks")
                .select("id, status", { count: "exact" })
                .eq("stay_date", businessDate)
                .in("status", ["dirty", "in_progress", "paused"]),

            // Total sellable rooms (for occupancy %)
            supabase.from("rooms").select("id", { count: "exact" }).eq("is_sellable", true)
        ]);

        const arrivalsTotal = arrivalsRes.count ?? 0;
        const departuresTotal = departuresRes.count ?? 0;
        const inHouseTotal = inHouseRes.count ?? 0;
        const dirtyTotal = dirtyRes.count ?? 0;
        const sellableTotal = sellableRes.count ?? 1;

        const occupancyPct =
            sellableTotal > 0 ? Math.round((inHouseTotal / sellableTotal) * 100) : 0;

        // Arrivals detail (top 10 for dashboard preview)
        const arrivalsPreview = (arrivalsRes.data ?? []).slice(0, 10).map((r) => ({
            id: r.id,
            guest_name: r.guest_name,
            source: r.source,
            checkin_time: r.checkin_time ?? null,
            total_price: r.total_price
        }));

        return NextResponse.json({
            success: true,
            date: businessDate,
            business_date: businessDate,
            calendar_date: calendarDate,
            tiles: {
                arrivals: arrivalsTotal,
                departures: departuresTotal,
                in_house: inHouseTotal,
                dirty: dirtyTotal,
                sellable_rooms: sellableTotal,
                occupancy_pct: occupancyPct
            },
            arrivals_preview: arrivalsPreview,
            departures_preview: (departuresRes.data ?? []).slice(0, 10).map((r) => ({
                id: r.id,
                guest_name: r.guest_name,
                total_price: r.total_price
            }))
        });
    } catch (err) {
        return NextResponse.json({ error: String(err) }, { status: 500 });
    }
}
