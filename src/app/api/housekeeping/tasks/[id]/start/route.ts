import { normalizeAuditSource, toBangkokDateString } from "@/lib/audit-utils";
import { maidAuthErrorResponse, requireMaidOperation } from "@/lib/maid-auth";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

const startSchema = z.object({
  maid_name: z.string().min(1),
  is_no_service: z.boolean().optional().default(false),
});

export async function POST(
  request: NextRequest,
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

    const { is_no_service } = parsed.data;
    const supabase = createServerSupabaseClient();
    const maidAuth = await requireMaidOperation(supabase, request, parsed.data.maid_name);
    const maid_name = maidAuth.effectiveMaidName ?? parsed.data.maid_name;

    // 1. Get the task by id
    const { data: task, error: taskError } = await supabase
      .from("housekeeping_tasks")
      .select("id, status, stay_date, accumulated_ms, started_at, is_no_service")
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

    const logNote =
      task.status === "paused"
        ? `resumed by ${maid_name}`
        : `started by ${maid_name}`;

    const auditAction = task.status === "paused" ? "resume" : "start";
    const [logResult, auditResult] = await Promise.allSettled([
      supabase.from("housekeeping_logs").insert({
        task_id: params.id,
        status: "in_progress",
        note: logNote,
      }),
      supabase.from("audit_logs").insert({
        action: auditAction,
        entity_type: "housekeeping_task",
        entity_id: params.id,
        before_json: { status: task.status },
        after_json: {
          status: "in_progress",
          assigned_maid_name: maid_name,
          is_no_service,
          maid_auth: maidAuth.audit,
        },
        actor_user_id: maidAuth.audit.actor_user_id,
        business_date: toBangkokDateString(),
        source: normalizeAuditSource("manual"),
      }),
    ]);

    if (logResult.status === "rejected") {
      return NextResponse.json(
        { error: logResult.reason instanceof Error ? logResult.reason.message : "Failed to log start task" },
        { status: 500 }
      );
    }
    if (logResult.value.error) {
      return NextResponse.json(
        { error: logResult.value.error.message },
        { status: 500 }
      );
    }
    if (auditResult.status === "rejected") {
      console.error("HK start audit log failed:", auditResult.reason);
    } else if (auditResult.value.error) {
      console.error("HK start audit log failed:", auditResult.value.error);
    }

    return NextResponse.json({ success: true });
  } catch (err) {
    const authResponse = maidAuthErrorResponse(err);
    if (authResponse) return authResponse;
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
