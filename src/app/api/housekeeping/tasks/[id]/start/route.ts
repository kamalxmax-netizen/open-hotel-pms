import { normalizeAuditSource, toBangkokDateString } from "@/lib/audit-utils";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { NextResponse } from "next/server";
import { z } from "zod";

const startSchema = z.object({
  maid_name: z.string().min(1),
  is_no_service: z.boolean().optional().default(false),
});

export async function POST(
  request: Request,
  { params }: { params: { id: string } }
) {
  try {
    const json = await request.json().catch(() => null);
    const parsed = startSchema.safeParse(json);

    if (!parsed.success) {
      return NextResponse.json(
        { error: "Invalid payload", details: parsed.error.flatten() },
        { status: 400 }
      );
    }

    const { maid_name, is_no_service } = parsed.data;
    const supabase = createServerSupabaseClient();

    // 1. Get the task by id
    const { data: task, error: taskError } = await supabase
      .from("housekeeping_tasks")
      .select("*")
      .eq("id", params.id)
      .single();

    if (taskError || !task) {
      return NextResponse.json(
        { error: "Task not found" },
        { status: 404 }
      );
    }

    // 2. Validate current status
    if (task.status !== "dirty" && task.status !== "paused") {
      return NextResponse.json(
        { error: "Task must be dirty or paused to start" },
        { status: 400 }
      );
    }

    // 3. Conflict check: maid already has a room in progress for the same stay_date
    const { data: conflicting } = await supabase
      .from("housekeeping_tasks")
      .select("id")
      .eq("assigned_maid_name", maid_name)
      .eq("stay_date", task.stay_date)
      .eq("status", "in_progress")
      .neq("id", params.id)
      .limit(1);

    if (conflicting && conflicting.length > 0) {
      return NextResponse.json(
        { error: "Maid already has a room in progress" },
        { status: 409 }
      );
    }

    // 4. Build the update payload
    const updatePayload: Record<string, unknown> = {
      status: "in_progress",
      assigned_maid_name: maid_name,
      started_at: new Date().toISOString(),
    };

    if (task.status === "dirty") {
      // Starting fresh: reset accumulated_ms and set is_no_service from request
      updatePayload.accumulated_ms = 0;
      updatePayload.is_no_service = is_no_service;
    }
    // Resuming from paused: keep accumulated_ms and is_no_service as-is

    const { error: updateError } = await supabase
      .from("housekeeping_tasks")
      .update(updatePayload)
      .eq("id", params.id);

    if (updateError) {
      return NextResponse.json(
        { error: updateError.message },
        { status: 500 }
      );
    }

    // 5. Insert housekeeping_logs entry
    const logNote =
      task.status === "paused"
        ? `resumed by ${maid_name}`
        : `started by ${maid_name}`;

    const { error: logError } = await supabase
      .from("housekeeping_logs")
      .insert({
        task_id: params.id,
        status: "in_progress",
        note: logNote,
      });

    if (logError) {
      return NextResponse.json(
        { error: logError.message },
        { status: 500 }
      );
    }

    // 6. Audit log (non-blocking)
    try {
      const auditAction = task.status === "paused" ? "resume" : "start";
      await supabase.from("audit_logs").insert({
        action: auditAction,
        entity_type: "housekeeping_task",
        entity_id: params.id,
        before_json: { status: task.status },
        after_json: { status: "in_progress", assigned_maid_name: maid_name, is_no_service },
        business_date: toBangkokDateString(),
        source: normalizeAuditSource("manual"),
      });
    } catch (auditErr) {
      console.error("HK start audit log failed:", auditErr);
    }

    return NextResponse.json({ success: true });
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
