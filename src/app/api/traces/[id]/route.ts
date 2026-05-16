import { createServerSupabaseClient } from "@/lib/supabase/server";
import { restoreLoanItemStock } from "@/lib/loan-item-stock";
import {
    buildTraceStatusUpdate,
    parseTraceAction,
    TRACE_ACTION_ERROR,
    type TraceStatus,
} from "@/lib/trace-status";
import { NextRequest, NextResponse } from "next/server";

export const dynamic = "force-dynamic";

/* ─── PATCH /api/traces/[id] ─────────────────────────────────
   Mark a trace as done/cancelled, or restore a cancelled trace
   Body: { action: "done" | "cancelled" | "restore", resolved_by?: string }
─────────────────────────────────────────────────────────── */
export async function PATCH(request: NextRequest, { params }: { params: { id: string } }) {
    try {
        const supabase = createServerSupabaseClient();
        const { action: rawAction, resolved_by } = await request.json();
        const action = parseTraceAction(rawAction);

        if (!action) {
            return NextResponse.json({ error: TRACE_ACTION_ERROR }, { status: 400 });
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
        const transition = buildTraceStatusUpdate({
            action,
            currentStatus: String(trace.status) as TraceStatus,
            nowIso: new Date().toISOString(),
            resolvedBy: resolved_by ?? null,
        });
        if (!transition.ok) {
            return NextResponse.json({ error: transition.error }, { status: transition.status });
        }
        if (!transition.update) {
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
        if (transition.update.status === "done" && trace.loan_item_code && trace.loan_qty > 0) {
            await restoreLoanItemStock(supabase, String(trace.loan_item_code), Number(trace.loan_qty));
        }

        // Update trace status
        const { data, error } = await supabase
            .from("reservation_traces")
            .update(transition.update)
            .eq("id", params.id)
            .select("*")
            .single();

        if (error) return NextResponse.json({ error: error.message }, { status: 500 });

        return NextResponse.json({ success: true, trace: data });
    } catch (err) {
        return NextResponse.json({ error: String(err) }, { status: 500 });
    }
}
