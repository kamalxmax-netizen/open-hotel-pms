import { normalizeAuditSource, toBangkokDateString } from "@/lib/audit-utils";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

const paramsSchema = z.object({ id: z.string().uuid("Invalid assignment id") });
const emptyBodySchema = z.object({}).passthrough();

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
    const parsedBody = emptyBodySchema.safeParse(body);
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
      .select("id, status, accumulated_ms")
      .eq("id", assignmentId)
      .maybeSingle();

    if (fetchError) {
      return NextResponse.json({ error: fetchError.message }, { status: 500 });
    }
    if (!assignment) {
      return NextResponse.json({ error: "Assignment not found." }, { status: 404 });
    }

    if (assignment.status !== "pending" && assignment.status !== "paused") {
      return NextResponse.json(
        { error: "Assignment must be pending or paused to start." },
        { status: 409 }
      );
    }

    const updates: Record<string, unknown> = {
      status: "in_progress",
      started_at: new Date().toISOString(),
      finished_at: null,
    };

    if (assignment.status === "pending") {
      updates.accumulated_ms = 0;
    } else {
      updates.accumulated_ms = assignment.accumulated_ms ?? 0;
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
      const auditAction = assignment.status === "paused" ? "resume" : "start";
      await supabase.from("audit_logs").insert({
        action: auditAction,
        entity_type: "extra_task",
        entity_id: assignmentId,
        before_json: { status: assignment.status },
        after_json: { status: "in_progress" },
        business_date: toBangkokDateString(),
        source: normalizeAuditSource("manual"),
      });
    } catch (auditErr) {
      console.error("Extra task start audit log failed:", auditErr);
    }

    return NextResponse.json({ success: true });
  } catch (err) {
    console.error("extra-tasks/assignments/[id]/start POST unexpected", err);
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
