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
      .select("id, status, started_at, accumulated_ms")
      .eq("id", assignmentId)
      .maybeSingle();

    if (fetchError) {
      return NextResponse.json({ error: fetchError.message }, { status: 500 });
    }
    if (!assignment) {
      return NextResponse.json({ error: "Assignment not found." }, { status: 404 });
    }

    if (assignment.status !== "in_progress") {
      return NextResponse.json(
        { error: "Assignment must be in_progress to pause." },
        { status: 409 }
      );
    }

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

    const elapsedMs = Math.max(Date.now() - startedAtMs, 0);
    const nextAccumulatedMs = (assignment.accumulated_ms ?? 0) + elapsedMs;

    const { error: updateError } = await supabase
      .from("extra_task_assignments")
      .update({
        status: "paused",
        started_at: null,
        accumulated_ms: nextAccumulatedMs,
      })
      .eq("id", assignmentId);

    if (updateError) {
      return NextResponse.json({ error: updateError.message }, { status: 500 });
    }

    return NextResponse.json({ success: true, accumulated_ms: nextAccumulatedMs });
  } catch (err) {
    console.error("extra-tasks/assignments/[id]/pause POST unexpected", err);
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
