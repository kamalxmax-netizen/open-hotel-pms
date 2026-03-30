import { createServerSupabaseClient } from "@/lib/supabase/server";
import { resolveBusinessDate } from "@/lib/folio-fees";
import { NextRequest, NextResponse } from "next/server";

function toLocalDate(d: Date) {
    const yyyy = d.getFullYear();
    const mm = String(d.getMonth() + 1).padStart(2, "0");
    const dd = String(d.getDate()).padStart(2, "0");
    return `${yyyy}-${mm}-${dd}`;
}

export async function GET(request: NextRequest) {
    try {
        const supabase = createServerSupabaseClient();
        const sp = request.nextUrl.searchParams;

        const fallbackDate = toLocalDate(new Date());
        const businessDate = await resolveBusinessDate(supabase, fallbackDate);
        const startDate = (sp.get("start") ?? "").trim() || businessDate;
        const endDate = (sp.get("end") ?? "").trim() || businessDate;

        // ── 1. Total sellable rooms ─────────────────────────────
        const { count: totalRooms } = await supabase
            .from("rooms")
            .select("id", { count: "exact", head: true })
            .eq("is_sellable", true);

        const sellableRooms = totalRooms ?? 0;

        // ── 2. Reservation nights in date range ─────────────────
        // Join reservation_nights → reservations to get source & status
        const { data: nights, error: nightsErr } = await supabase
            .from("reservation_nights")
            .select(`
        stay_date,
        nightly_price,
        cancelled_at,
        reservations!inner (
          source,
          status
        )
      `)
            .gte("stay_date", startDate)
            .lte("stay_date", endDate)
            .is("cancelled_at", null);

        if (nightsErr) return NextResponse.json({ error: nightsErr.message }, { status: 500 });

        // ── 3. Number of distinct days in range ─────────────────
        const msPerDay = 86400000;
        const start = new Date(startDate + "T00:00:00");
        const end = new Date(endDate + "T00:00:00");
        const dayCount = Math.round((end.getTime() - start.getTime()) / msPerDay) + 1;
        const roomNights = sellableRooms * dayCount; // total available room-nights

        // ── 4. Aggregate per source and total ───────────────────
        type Source = "walkin" | "ota" | "direct" | "agent";
        const sources: Source[] = ["walkin", "ota", "direct", "agent"];

        const agg: Record<Source, { nights: number; revenue: number }> = {
            walkin: { nights: 0, revenue: 0 },
            ota: { nights: 0, revenue: 0 },
            direct: { nights: 0, revenue: 0 },
            agent: { nights: 0, revenue: 0 }
        };

        let totalRevenue = 0;
        let occupiedNights = 0;

        for (const night of nights ?? []) {
            const res = night.reservations as unknown as { source: Source; status: string };
            const price = Number(night.nightly_price ?? 0);
            const src = res?.source ?? "walkin";

            if (agg[src]) {
                agg[src].nights++;
                agg[src].revenue += price;
            }

            totalRevenue += price;
            occupiedNights += 1;
        }

        // ── 5. KPI calculations ─────────────────────────────────
        const occupancyPct = roomNights > 0
            ? Math.round((occupiedNights / roomNights) * 10000) / 100  // 2 dp %
            : 0;

        const adr = occupiedNights > 0
            ? Math.round(totalRevenue / occupiedNights)
            : 0;

        const revpar = roomNights > 0
            ? Math.round((totalRevenue / roomNights) * 100) / 100
            : 0;

        // ── 6. Per-day breakdown (for chart) ────────────────────
        const dayMap = new Map<string, { revenue: number; occupied: number }>();
        for (const night of nights ?? []) {
            const d = night.stay_date;
            const price = Number(night.nightly_price ?? 0);
            if (!dayMap.has(d)) dayMap.set(d, { revenue: 0, occupied: 0 });
            const entry = dayMap.get(d)!;
            entry.revenue += price;
            entry.occupied += 1;
        }

        // Fill in zero days
        const allDays: { date: string; revenue: number; occupied: number; occ_pct: number }[] = [];
        let cur = new Date(startDate + "T00:00:00");
        const endD = new Date(endDate + "T00:00:00");
        while (cur <= endD) {
            const ds = toLocalDate(cur);
            const d = dayMap.get(ds) ?? { revenue: 0, occupied: 0 };
            allDays.push({
                date: ds,
                revenue: d.revenue,
                occupied: d.occupied,
                occ_pct: sellableRooms > 0
                    ? Math.round((d.occupied / sellableRooms) * 10000) / 100
                    : 0
            });
            cur.setDate(cur.getDate() + 1);
        }

        return NextResponse.json({
            success: true,
            business_date: businessDate,
            start_date: startDate,
            end_date: endDate,
            day_count: dayCount,
            sellable_rooms: sellableRooms,
            kpi: {
                total_revenue: totalRevenue,
                occupied_nights: occupiedNights,
                room_nights: roomNights,
                occupancy_pct: occupancyPct,
                adr,
                revpar
            },
            by_source: sources.map((src) => ({
                source: src,
                nights: agg[src].nights,
                revenue: agg[src].revenue,
                share_pct: totalRevenue > 0
                    ? Math.round((agg[src].revenue / totalRevenue) * 1000) / 10
                    : 0
            })),
            by_day: allDays
        });
    } catch (err) {
        return NextResponse.json({ error: String(err) }, { status: 500 });
    }
}
