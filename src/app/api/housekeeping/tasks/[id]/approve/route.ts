import { createServerSupabaseClient } from "@/lib/supabase/server";
import { NextResponse } from "next/server";
import { z } from "zod";

const approveSchema = z.object({
  approved_by: z.string().optional(),
});

export async function POST(
  request: Request,
  { params }: { params: { id: string } }
) {
  try {
    const supabase = createServerSupabaseClient();
    const { id } = params;

    // Parse and validate request body
    const json = await request.json().catch(() => null);
    const parsed = approveSchema.safeParse(json ?? {});

    if (!parsed.success) {
      return NextResponse.json(
        { error: "Invalid payload", details: parsed.error.flatten() },
        { status: 400 }
      );
    }

    const body = parsed.data;

    // 1. Fetch the task by ID
    const { data: task, error: fetchError } = await supabase
      .from("housekeeping_tasks")
      .select("*")
      .eq("id", id)
      .single();

    if (fetchError || !task) {
      return NextResponse.json(
        { error: "Task not found" },
        { status: 404 }
      );
    }

    // 2. Ensure the task is in 'cleaned' status
    if (task.status !== "cleaned") {
      return NextResponse.json(
        {
          error: "Task must be cleaned before approval",
          current_status: task.status,
        },
        { status: 400 }
      );
    }

    const now = new Date().toISOString();

    // 3. Update the task: mark approved
    const { error: updateError } = await supabase
      .from("housekeeping_tasks")
      .update({
        status: "approved",
        approved_at: now,
      })
      .eq("id", id);

    if (updateError) {
      return NextResponse.json(
        { error: "Failed to update task", details: updateError.message },
        { status: 500 }
      );
    }

    // 4. Insert housekeeping_logs entry
    const { error: logError } = await supabase
      .from("housekeeping_logs")
      .insert({
        task_id: id,
        status: "approved" as const,
        note: `approved by ${body.approved_by ?? "unknown"}`,
      });

    if (logError) {
      console.error("Failed to insert housekeeping log:", logError.message);
    }

    // 5. Return success
    return NextResponse.json({
      success: true,
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Internal server error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
