import { createServerSupabaseClient } from "@/lib/supabase/server";
import { restoreLoanItemStock } from "@/lib/loan-item-stock";
import { NextRequest, NextResponse } from "next/server";

export const dynamic = "force-dynamic";

/* ─── PATCH /api/traces/[id] ─────────────────────────────────
   Mark a trace as done or cancelled
   Body: { action: "done" | "cancelled", resolved_by?: string }
─────────────────────────────────────────────────────────── */
export async function PATCH(request: NextRequest, { params }: { params: { id: string } }) {
    try {
        const supabase = createServerSupabaseClient();
        const { action, resolved_by } = await request.json();

        if (!["done", "cancelled"].includes(action)) {
            return NextResponse.json({ error: "action must be 'done' or 'cancelled'" }, { status: 400 });
        }

        // Fetch the trace first (to restore stock on done)
        const { data: trace, error: fetchErr } = await supabase
            .from("reservation_traces")
            .select("loan_item_code, loan_qty, status")
            .eq("id", params.id)
            .single();

        if (fetchErr || !trace) {
            return NextResponse.json({ error: "Trace not found" }, { status: 404 });
        }
        if (trace.status !== "open") {
            return NextResponse.json({
                success: true,
                trace: {
                    id: params.id,
                    status: trace.status,
                    resolved_by: resolved_by ?? null,
                }
            });
        }

        // If marking done and had a loan item → restore stock
        if (action === "done" && trace.loan_item_code && trace.loan_qty > 0) {
            await restoreLoanItemStock(supabase, String(trace.loan_item_code), Number(trace.loan_qty));
        }

        // Update trace status
        const { data, error } = await supabase
            .from("reservation_traces")
            .update({
                status: action,
                resolved_at: new Date().toISOString(),
                resolved_by: resolved_by ?? null
            })
            .eq("id", params.id)
            .select("*")
            .single();

        if (error) return NextResponse.json({ error: error.message }, { status: 500 });

        return NextResponse.json({ success: true, trace: data });
    } catch (err) {
        return NextResponse.json({ error: String(err) }, { status: 500 });
    }
}
