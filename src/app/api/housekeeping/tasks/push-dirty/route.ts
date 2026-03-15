import { createServerSupabaseClient } from "@/lib/supabase/server";
import { NextResponse } from "next/server";
import { z } from "zod";

const pushDirtySchema = z.object({
  room_id: z.string().uuid(),
  stay_date: z.string(),
  trigger_source: z.enum(["checkout", "cancel", "manual"]),
  requested_by: z.string().optional(),
});

export async function POST(request: Request) {
  try {
    const json = await request.json().catch(() => null);
    const parsed = pushDirtySchema.safeParse(json);

    if (!parsed.success) {
      return NextResponse.json(
        { error: "Invalid payload", details: parsed.error.flatten() },
        { status: 400 }
      );
    }

    const { room_id, stay_date, trigger_source, requested_by } = parsed.data;
    const supabase = createServerSupabaseClient();

    // Upsert housekeeping_tasks with status 'dirty'
    const { data: task, error: upsertError } = await supabase
      .from("housekeeping_tasks")
      .upsert(
        {
          room_id,
          stay_date,
          status: "dirty",
          is_no_service: false,
          no_service_note: null,
          no_service_marked_at: null,
          no_service_marked_by: null,
          started_at: null,
          finished_at: null,
          approved_at: null,
          accumulated_ms: 0,
        },
        { onConflict: "room_id,stay_date" }
      )
      .select("id")
      .single();

    if (upsertError) {
      return NextResponse.json(
        { error: upsertError.message },
        { status: 500 }
      );
    }

    const task_id = task.id;

    // Insert housekeeping_logs entry
    const { error: logError } = await supabase
      .from("housekeeping_logs")
      .insert({
        task_id,
        status: "dirty",
        note: `trigger: ${trigger_source}`,
      });

    if (logError) {
      return NextResponse.json(
        { error: logError.message },
        { status: 500 }
      );
    }

    return NextResponse.json({ success: true, task_id });
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
