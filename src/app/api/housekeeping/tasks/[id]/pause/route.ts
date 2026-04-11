import { normalizeAuditSource, toBangkokDateString } from "@/lib/audit-utils";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { NextResponse } from "next/server";
import { z } from "zod";

const pauseTaskSchema = z.object({
  note: z.string().trim().max(500).optional(),
});

export async function POST(
  request: Request,
  { params }: { params: { id: string } }
) {
  try {
    let rawBody: unknown = {};
    try {
      rawBody = await request.json();
    } catch {
      rawBody = {};
    }

    const parsedBody = pauseTaskSchema.safeParse(rawBody);
    if (!parsedBody.success) {
      return NextResponse.json(
        { error: "Invalid request body.", details: parsedBody.error.flatten() },
        { status: 400 }
      );
    }

    const pauseNote = parsedBody.data.note?.trim();

    const supabase = createServerSupabaseClient();
    const { id } = params;

    // 1. Fetch the task by ID
    const { data: task, error: fetchError } = await supabase
      .from("housekeeping_tasks")
      .select("id, status, started_at, accumulated_ms")
      .eq("id", id)
      .single();

    if (fetchError || !task) {
      return NextResponse.json(
        { error: "Task not found" },
        { status: 404 }
      );
    }

    // 2. Ensure the task is currently in_progress
    if (task.status !== "in_progress") {
      return NextResponse.json(
        { error: "Task must be in_progress to pause", current_status: task.status },
        { status: 400 }
      );
    }

    // 3. Guard: started_at must be valid for an in_progress task
    if (!task.started_at) {
      return NextResponse.json(
        { error: "Data inconsistency: in_progress task has no started_at" },
        { status: 500 }
      );
    }

    // 4. Calculate elapsed time and accumulate
    const now = Date.now();
    const startedMs = new Date(task.started_at).getTime();
    const elapsed = now - startedMs;
    const newAccumulated = (task.accumulated_ms ?? 0) + Math.max(elapsed, 0);
    const accumulatedMin = Math.max(1, Math.round(newAccumulated / 60_000));

    // 4. Update the task: set paused, accumulate time, clear started_at
    const { error: updateError } = await supabase
      .from("housekeeping_tasks")
      .update({
        status: "paused",
        accumulated_ms: newAccumulated,
        started_at: null,
      })
      .eq("id", id);

    if (updateError) {
      return NextResponse.json(
        { error: "Failed to update task", details: updateError.message },
        { status: 500 }
      );
    }

    const [logResult, auditResult] = await Promise.allSettled([
      supabase.from("housekeeping_logs").insert({
        task_id: id,
        status: "paused" as const,
        note:
          pauseNote && pauseNote.length > 0
            ? pauseNote
            : `paused, accumulated: ${accumulatedMin} min`,
      }),
      supabase.from("audit_logs").insert({
        action: "pause",
        entity_type: "housekeeping_task",
        entity_id: id,
        before_json: { status: "in_progress" },
        after_json: { status: "paused", accumulated_ms: newAccumulated },
        business_date: toBangkokDateString(),
        source: normalizeAuditSource("manual"),
        note: pauseNote || null,
      }),
    ]);

    if (logResult.status === "rejected") {
      console.error("Failed to insert housekeeping log:", logResult.reason);
    } else if (logResult.value.error) {
      console.error("Failed to insert housekeeping log:", logResult.value.error.message);
    }
    if (auditResult.status === "rejected") {
      console.error("HK pause audit log failed:", auditResult.reason);
    } else if (auditResult.value.error) {
      console.error("HK pause audit log failed:", auditResult.value.error);
    }

    // 7. Return success
    return NextResponse.json({
      success: true,
      accumulated_ms: newAccumulated,
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Internal server error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
