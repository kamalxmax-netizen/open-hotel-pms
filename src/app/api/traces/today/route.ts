import { createServerSupabaseClient } from "@/lib/supabase/server";
import { NextResponse } from "next/server";
import { unstable_noStore as noStore } from "next/cache";

export const dynamic = "force-dynamic";

/* ─── GET /api/traces/today ──────────────────────────────────
   All open traces due today (from_date <= today <= to_date)
   Used by the Dashboard widget
─────────────────────────────────────────────────────────── */
export async function GET() {
    noStore();
    try {
        const supabase = createServerSupabaseClient();
        const today = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Bangkok" }).format(new Date());

        const { data, error } = await supabase
            .from("reservation_traces")
            .select(`
                id,
                dept,
                trace_text,
                from_date,
                to_date,
                loan_item_code,
                loan_qty,
                status,
                created_at,
                created_by,
                reservation_id,
                reservations!inner(
                  booking_code,
                  guest_name,
                  checkin_date,
                  checkout_date,
                  reservation_nights!inner(
                    rooms(room_number)
                  )
                )
            `)
            .eq("status", "open")
            .lte("from_date", today)
            .gte("to_date", today);

        if (error) return NextResponse.json({ error: error.message }, { status: 500 });

        // Flatten room_number from first night
        const traces = (data ?? []).map((t) => {
            const res = t.reservations as unknown as {
                booking_code: string;
                guest_name: string;
                checkin_date: string;
                checkout_date: string;
                reservation_nights: Array<{ rooms: { room_number: string } | null }>;
            };
            const roomNum = res?.reservation_nights?.[0]?.rooms?.room_number ?? "?";
            return {
                id: t.id,
                dept: t.dept,
                trace_text: t.trace_text,
                from_date: t.from_date,
                to_date: t.to_date,
                loan_item_code: t.loan_item_code,
                loan_qty: t.loan_qty,
                created_by: t.created_by,
                reservation_id: t.reservation_id,
                booking_code: res?.booking_code,
                guest_name: res?.guest_name,
                checkin_date: res?.checkin_date,
                checkout_date: res?.checkout_date,
                room_number: roomNum
            };
        });

        // Group by dept
        const byDept: Record<string, typeof traces> = {};
        for (const t of traces) {
            if (!byDept[t.dept]) byDept[t.dept] = [];
            byDept[t.dept].push(t);
        }

        return NextResponse.json({
            success: true,
            date: today,
            total: traces.length,
            by_dept: byDept,
            traces
        });
    } catch (err) {
        return NextResponse.json({ error: String(err) }, { status: 500 });
    }
}
