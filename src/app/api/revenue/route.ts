import { createServerSupabaseClient } from "@/lib/supabase/server";
import { resolveBusinessDate } from "@/lib/folio-fees";
import {
    summarizeRevenueRange,
    type RevenueExtraRow,
    type RevenueNightRow,
    type RevenuePosOrderRow,
    type RevenueRoomRow,
} from "@/lib/revenue-reporting";
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

        const [{ data: rooms, error: roomsErr }, { data: nights, error: nightsErr }, { data: posOrders, error: posErr }, { data: extraRows, error: extraErr }] = await Promise.all([
            supabase
                .from("rooms")
                .select("id, room_number, floor_number, is_dayuse, closure_reason, is_sellable")
                .eq("is_sellable", true),
            supabase
                .from("reservation_nights")
                .select(`
        room_id,
        stay_date,
        nightly_price,
        cancelled_at,
        reservations!inner (
          id,
          source,
          status,
          is_dayuse
        )
      `)
                .gte("stay_date", startDate)
                .lte("stay_date", endDate)
                .is("cancelled_at", null)
                .neq("reservations.status", "cancelled"),
            supabase
                .from("pos_orders")
                .select("total, order_date, status")
                .gte("order_date", startDate)
                .lte("order_date", endDate)
                .eq("status", "completed"),
            supabase
                .from("folio_payments")
                .select("id, paid_date, paid_at, tx_type, amount, note, revenue_category, is_record_only, is_correction, is_void_reversal, void_of")
                .gte("paid_date", startDate)
                .lte("paid_date", endDate)
                .eq("revenue_category", "extra_charge")
                .in("tx_type", ["payment", "refund"]),
        ]);

        if (roomsErr) return NextResponse.json({ error: roomsErr.message }, { status: 500 });
        if (nightsErr) return NextResponse.json({ error: nightsErr.message }, { status: 500 });
        if (posErr) return NextResponse.json({ error: posErr.message }, { status: 500 });
        if (extraErr) return NextResponse.json({ error: extraErr.message }, { status: 500 });

        const scopedExtraRows = (extraRows ?? []) as RevenueExtraRow[];
        const extraIds = scopedExtraRows.map((row) => String(row.id ?? "").trim()).filter(Boolean);
        const laterVoidedExtraOriginalIds = new Set<string>();
        if (extraIds.length > 0) {
            const { data: laterVoidRows, error: laterVoidError } = await supabase
                .from("folio_payments")
                .select("void_of")
                .eq("is_void_reversal", true)
                .in("void_of", extraIds);
            if (laterVoidError) return NextResponse.json({ error: laterVoidError.message }, { status: 500 });
            for (const row of laterVoidRows ?? []) {
                const originalId = String((row as { void_of?: string | null }).void_of ?? "").trim();
                if (originalId) laterVoidedExtraOriginalIds.add(originalId);
            }
        }

        const report = summarizeRevenueRange({
            rooms: (rooms ?? []) as RevenueRoomRow[],
            nights: (nights ?? []) as RevenueNightRow[],
            extraRows: scopedExtraRows,
            laterVoidedExtraOriginalIds,
            posOrders: (posOrders ?? []) as RevenuePosOrderRow[],
            startDate,
            endDate,
        });

        return NextResponse.json({
            success: true,
            business_date: businessDate,
            start_date: startDate,
            end_date: endDate,
            day_count: report.day_count,
            sellable_rooms: report.sellable_rooms,
            kpi: report.kpi,
            by_source: report.by_source,
            by_day: report.by_day
        });
    } catch (err) {
        return NextResponse.json({ error: String(err) }, { status: 500 });
    }
}
