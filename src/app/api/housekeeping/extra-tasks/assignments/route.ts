import { normalizeAuditSource, toBangkokDateString } from "@/lib/audit-utils";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

const dateRegex = /^\d{4}-\d{2}-\d{2}$/;

const querySchema = z.object({
  date: z.string().regex(dateRegex, "date must be YYYY-MM-DD").optional(),
});

const createAssignmentSchema = z.object({
  assignment_date: z.string().regex(dateRegex, "assignment_date must be YYYY-MM-DD"),
  template_id: z.string().uuid().nullable().optional(),
  task_name: z.string().trim().min(1, "task_name is required"),
  assigned_maid: z.string().trim().min(1, "assigned_maid is required"),
  duration_min: z.number().int().positive().default(60),
  priority: z.number().int().min(1).max(9999).default(999),
  notes: z.string().trim().max(2000).nullable().optional(),
});

function getThailandDateString(date = new Date()): string {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "Asia/Bangkok",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);

  const year = parts.find((part) => part.type === "year")?.value;
  const month = parts.find((part) => part.type === "month")?.value;
  const day = parts.find((part) => part.type === "day")?.value;
  if (!year || !month || !day) return new Date().toISOString().slice(0, 10);
  return `${year}-${month}-${day}`;
}

export async function GET(request: NextRequest) {
  try {
    const parsedQuery = querySchema.safeParse({
      date: request.nextUrl.searchParams.get("date") ?? undefined,
    });

    if (!parsedQuery.success) {
      return NextResponse.json(
        { error: "Invalid query.", details: parsedQuery.error.flatten() },
        { status: 400 }
      );
    }

    const targetDate = parsedQuery.data.date ?? getThailandDateString();
    const supabase = createServerSupabaseClient();

    const { data, error } = await supabase
      .from("extra_task_assignments")
      .select(
        "id, assignment_date, template_id, task_name, assigned_maid, status, priority, duration_min, started_at, finished_at, accumulated_ms, notes, created_at, updated_at"
      )
      .eq("assignment_date", targetDate)
      .order("priority", { ascending: true })
      .order("created_at", { ascending: true });

    if (error) {
      console.error("extra-tasks/assignments GET failed", error);
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json({
      success: true,
      date: targetDate,
      assignments: data ?? [],
    });
  } catch (err) {
    console.error("extra-tasks/assignments GET unexpected", err);
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json().catch(() => null);
    const parsedBody = createAssignmentSchema.safeParse(body);

    if (!parsedBody.success) {
      return NextResponse.json(
        { error: "Invalid request body.", details: parsedBody.error.flatten() },
        { status: 400 }
      );
    }

    const payload = parsedBody.data;
    const supabase = createServerSupabaseClient();

    if (payload.template_id) {
      const { data: template, error: templateError } = await supabase
        .from("extra_task_templates")
        .select("id, is_active")
        .eq("id", payload.template_id)
        .maybeSingle();

      if (templateError) {
        return NextResponse.json({ error: templateError.message }, { status: 500 });
      }
      if (!template) {
        return NextResponse.json({ error: "Template not found." }, { status: 404 });
      }
      if (!template.is_active) {
        return NextResponse.json({ error: "Template is inactive." }, { status: 409 });
      }
    }

    const { data, error } = await supabase
      .from("extra_task_assignments")
      .insert({
        assignment_date: payload.assignment_date,
        template_id: payload.template_id ?? null,
        task_name: payload.task_name,
        assigned_maid: payload.assigned_maid,
        status: "pending",
        priority: payload.priority,
        duration_min: payload.duration_min,
        notes: payload.notes ?? null,
      })
      .select(
        "id, assignment_date, template_id, task_name, assigned_maid, status, priority, duration_min, started_at, finished_at, accumulated_ms, notes, created_at, updated_at"
      )
      .maybeSingle();

    if (error) {
      const isConflict = error.code === "23505";
      return NextResponse.json(
        {
          error: isConflict
            ? "Task name already exists for this date (run duplicate-task migration if this should be allowed)."
            : error.message,
        },
        { status: isConflict ? 409 : 500 }
      );
    }

    // Audit log (non-blocking)
    try {
      await supabase.from("audit_logs").insert({
        action: "assign",
        entity_type: "extra_task",
        entity_id: String(data?.id ?? ""),
        after_json: {
          task_name: payload.task_name,
          assigned_maid: payload.assigned_maid,
          assignment_date: payload.assignment_date,
        },
        business_date: toBangkokDateString(),
        source: normalizeAuditSource("manual"),
      });
    } catch (auditErr) {
      console.error("Extra task assign audit log failed:", auditErr);
    }

    return NextResponse.json({ success: true, assignment: data }, { status: 201 });
  } catch (err) {
    console.error("extra-tasks/assignments POST unexpected", err);
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
