import { normalizeAuditSource, toBangkokDateString } from "@/lib/audit-utils";
import { restoreLoanItemStock } from "@/lib/loan-item-stock";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { NextRequest, NextResponse } from "next/server";

export async function POST(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const taskId = String(params.id ?? "").trim();
    if (!taskId) {
      return NextResponse.json({ error: "Missing task id." }, { status: 400 });
    }

    const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
    const traceIds = Array.isArray(body.trace_ids)
      ? body.trace_ids.map((value) => String(value ?? "").trim()).filter(Boolean)
      : [];
    const resolvedBy = typeof body.resolved_by === "string" && body.resolved_by.trim()
      ? body.resolved_by.trim()
      : "maid";

    if (traceIds.length === 0) {
      return NextResponse.json({ error: "trace_ids is required." }, { status: 400 });
    }

    const supabase = createServerSupabaseClient();
    const { data: task, error: taskError } = await supabase
      .from("housekeeping_tasks")
      .select("id, room_id")
      .eq("id", taskId)
      .maybeSingle();

    if (taskError) {
      return NextResponse.json({ error: taskError.message }, { status: 500 });
    }
    if (!task) {
      return NextResponse.json({ error: "Housekeeping task not found." }, { status: 404 });
    }

    const { data: roomNightRows, error: roomNightError } = await supabase
      .from("reservation_nights")
      .select("reservation_id")
      .eq("room_id", task.room_id)
      .is("cancelled_at", null);

    if (roomNightError) {
      return NextResponse.json({ error: roomNightError.message }, { status: 500 });
    }

    const validReservationIds = new Set(
      (roomNightRows ?? []).map((row) => String(row.reservation_id ?? "")).filter(Boolean)
    );

    const { data: traces, error: traceError } = await supabase
      .from("reservation_traces")
      .select("id, reservation_id, loan_item_code, loan_qty, status")
      .in("id", traceIds);

    if (traceError) {
      return NextResponse.json({ error: traceError.message }, { status: 500 });
    }

    const openLoanTraces = (traces ?? []).filter((trace: any) => {
      const reservationId = String(trace.reservation_id ?? "");
      return validReservationIds.has(reservationId) && trace.status === "open";
    });

    for (const trace of openLoanTraces) {
      if (trace.loan_item_code && Number(trace.loan_qty ?? 0) > 0) {
        await restoreLoanItemStock(supabase, String(trace.loan_item_code), Number(trace.loan_qty));
      }
    }

    if (openLoanTraces.length > 0) {
      const now = new Date().toISOString();
      const { error: updateError } = await supabase
        .from("reservation_traces")
        .update({
          status: "done",
          resolved_at: now,
          resolved_by: resolvedBy,
        })
        .in("id", openLoanTraces.map((trace: any) => String(trace.id)));

      if (updateError) {
        return NextResponse.json({ error: updateError.message }, { status: 500 });
      }
    }

    // Audit log (non-blocking)
    if (openLoanTraces.length > 0) {
      try {
        await supabase.from("audit_logs").insert({
          action: "collect_loan",
          entity_type: "housekeeping_task",
          entity_id: taskId,
          after_json: {
            collected_count: openLoanTraces.length,
            trace_ids: openLoanTraces.map((trace: any) => String(trace.id)),
            resolved_by: resolvedBy,
          },
          business_date: toBangkokDateString(),
          source: normalizeAuditSource("manual"),
        });
      } catch (auditErr) {
        console.error("HK collect-loan audit log failed:", auditErr);
      }
    }

    return NextResponse.json({
      success: true,
      collected_trace_ids: openLoanTraces.map((trace: any) => String(trace.id)),
    });
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
