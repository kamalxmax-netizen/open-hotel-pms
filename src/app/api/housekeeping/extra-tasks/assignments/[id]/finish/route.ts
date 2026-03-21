import { normalizeAuditSource, toBangkokDateString } from "@/lib/audit-utils";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

const paramsSchema = z.object({ id: z.string().uuid("Invalid assignment id") });

const finishSchema = z.object({
  notes: z.string().trim().max(2000).optional(),
});

export async function POST(
  request: NextRequest,
  context: { params: { id: string } }
) {
  try {
    const parsedParams = paramsSchema.safeParse(context.params);
    if (!parsedParams.success) {
      return NextResponse.json(
        { error: "Invalid params.", details: parsedParams.error.flatten() },
        { status: 400 }
      );
    }

    const body = await request.json().catch(() => ({}));
    const parsedBody = finishSchema.safeParse(body);
    if (!parsedBody.success) {
      return NextResponse.json(
        { error: "Invalid request body.", details: parsedBody.error.flatten() },
        { status: 400 }
      );
    }

    const supabase = createServerSupabaseClient();
    const assignmentId = parsedParams.data.id;

    const { data: assignment, error: fetchError } = await supabase
      .from("extra_task_assignments")
      .select("id, status, started_at, accumulated_ms, notes")
      .eq("id", assignmentId)
      .maybeSingle();

    if (fetchError) {
      return NextResponse.json({ error: fetchError.message }, { status: 500 });
    }
    if (!assignment) {
      return NextResponse.json({ error: "Assignment not found." }, { status: 404 });
    }

    if (assignment.status !== "in_progress" && assignment.status !== "paused") {
      return NextResponse.json(
        { error: "Assignment must be in_progress or paused to finish." },
        { status: 409 }
      );
    }

    let finalAccumulatedMs = assignment.accumulated_ms ?? 0;
    if (assignment.status === "in_progress") {
      if (!assignment.started_at) {
        return NextResponse.json(
          { error: "Invalid state: started_at is required for in_progress assignment." },
          { status: 400 }
        );
      }

      const startedAtMs = new Date(assignment.started_at).getTime();
      if (Number.isNaN(startedAtMs)) {
        return NextResponse.json({ error: "Invalid started_at value." }, { status: 400 });
      }

      finalAccumulatedMs += Math.max(Date.now() - startedAtMs, 0);
    }

    const updates: Record<string, unknown> = {
      status: "done",
      started_at: null,
      finished_at: new Date().toISOString(),
      accumulated_ms: finalAccumulatedMs,
    };

    if (parsedBody.data.notes !== undefined) {
      updates.notes = parsedBody.data.notes;
    }

    const { error: updateError } = await supabase
      .from("extra_task_assignments")
      .update(updates)
      .eq("id", assignmentId);

    if (updateError) {
      return NextResponse.json({ error: updateError.message }, { status: 500 });
    }

    // Audit log (non-blocking)
    try {
      await supabase.from("audit_logs").insert({
        action: "done",
        entity_type: "extra_task",
        entity_id: assignmentId,
        before_json: { status: assignment.status },
        after_json: { status: "done", accumulated_ms: finalAccumulatedMs },
        business_date: toBangkokDateString(),
        source: normalizeAuditSource("manual"),
      });
    } catch (auditErr) {
      console.error("Extra task finish audit log failed:", auditErr);
    }

    return NextResponse.json({ success: true });
  } catch (err) {
    console.error("extra-tasks/assignments/[id]/finish POST unexpected", err);
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
