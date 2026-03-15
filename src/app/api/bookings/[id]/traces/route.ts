import { createServerSupabaseClient } from "@/lib/supabase/server";
import { decrementLoanItemStock } from "@/lib/loan-item-stock";
import { NextRequest, NextResponse } from "next/server";
import { unstable_noStore as noStore } from "next/cache";

export const dynamic = "force-dynamic";

/* ─── GET /api/bookings/[id]/traces ─────────────────────────
   List all traces for a reservation
─────────────────────────────────────────────────────────── */
export async function GET(req: NextRequest, { params }: { params: { id: string } }) {
    noStore();
    try {
        const supabase = createServerSupabaseClient();
        const kind = req.nextUrl.searchParams.get("kind") ?? "all";

        let query = supabase
            .from("reservation_traces")
            .select("*, loan_items(code, name, icon, requires_hk_collection)")
            .eq("reservation_id", params.id)
            .order("from_date")
            .order("created_at");

        if (kind === "trace") {
            query = query.is("loan_item_code", null);
        } else if (kind === "loan") {
            query = query.not("loan_item_code", "is", null);
        }

        const { data, error } = await query;

        if (error) return NextResponse.json({ error: error.message }, { status: 500 });

        return NextResponse.json({ success: true, traces: data ?? [] });
    } catch (err) {
        return NextResponse.json({ error: String(err) }, { status: 500 });
    }
}

/* ─── POST /api/bookings/[id]/traces ────────────────────────
   Add a new trace (optionally linked to a loan item)
─────────────────────────────────────────────────────────── */
export async function POST(request: NextRequest, { params }: { params: { id: string } }) {
    try {
        const supabase = createServerSupabaseClient();
        const body = await request.json();

        const {
            dept = "FD",
            trace_text,
            from_date,
            to_date,
            created_by,
            loan_item_code,
            loan_qty = 1,
            due_date = null
        } = body;

        if (!trace_text) {
            return NextResponse.json({ error: "trace_text is required" }, { status: 400 });
        }
        if (!from_date || !to_date) {
            return NextResponse.json({ error: "from_date and to_date are required" }, { status: 400 });
        }
        if (due_date != null && !/^\d{4}-\d{2}-\d{2}$/.test(String(due_date))) {
            return NextResponse.json({ error: "due_date must be YYYY-MM-DD or null" }, { status: 400 });
        }

        // If a loan item is specified, decrement available stock
        if (loan_item_code && loan_qty > 0) {
            try {
                await decrementLoanItemStock(supabase, loan_item_code, Number(loan_qty));
            } catch (error) {
                const message = error instanceof Error ? error.message : "Loan item error";
                const status = message.includes("Not enough stock") ? 400 : 404;
                return NextResponse.json({ error: message }, { status });
            }
        }

        const { data, error } = await supabase
            .from("reservation_traces")
            .insert({
                reservation_id: params.id,
                dept,
                trace_text,
                from_date,
                to_date,
                created_by,
                loan_item_code: loan_item_code || null,
                loan_qty: loan_item_code ? loan_qty : 0,
                due_date: loan_item_code ? due_date || null : null,
            })
            .select("*, loan_items(code, name, icon, requires_hk_collection)")
            .single();

        if (error) return NextResponse.json({ error: error.message }, { status: 500 });

        return NextResponse.json({ success: true, trace: data }, { status: 201 });
    } catch (err) {
        return NextResponse.json({ error: String(err) }, { status: 500 });
    }
}
