import { createServerSupabaseClient } from "@/lib/supabase/server";
import { NextResponse } from "next/server";
import { z } from "zod";
import { markRoomDirtyTask } from "@/lib/hk-dirty";

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

    const { room_id, stay_date, trigger_source } = parsed.data;
    const supabase = createServerSupabaseClient();

    // Smart dirty: preserves completed tasks by inserting a new task_seq row
    const result = await markRoomDirtyTask(supabase, {
      roomId: room_id,
      stayDate: stay_date,
      logNote: `trigger: ${trigger_source}`,
    });

    return NextResponse.json({ success: true, task_id: result.task_id, task_seq: result.task_seq });
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
