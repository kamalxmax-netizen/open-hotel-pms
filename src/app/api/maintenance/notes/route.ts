import { createServerSupabaseClient } from "@/lib/supabase/server";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

const querySchema = z.object({
  room_id: z.string().uuid().optional(),
  resolved: z.enum(["true", "false"]).optional(),
});

const createNoteSchema = z.object({
  room_id: z.string().uuid("room_id is required"),
  task_id: z.string().uuid("task_id is required"),
  note: z.string().trim().min(1, "note is required").max(4000),
});

export async function GET(request: NextRequest) {
  try {
    const parsedQuery = querySchema.safeParse({
      room_id: request.nextUrl.searchParams.get("room_id") ?? undefined,
      resolved: request.nextUrl.searchParams.get("resolved") ?? undefined,
    });

    if (!parsedQuery.success) {
      return NextResponse.json(
        { error: "Invalid query.", details: parsedQuery.error.flatten() },
        { status: 400 }
      );
    }

    const supabase = createServerSupabaseClient();
    let query = supabase
      .from("maintenance_notes")
      .select("id, room_id, task_id, note, created_at, is_resolved, resolved_at")
      .order("created_at", { ascending: false });

    if (parsedQuery.data.room_id) {
      query = query.eq("room_id", parsedQuery.data.room_id);
    }

    if (parsedQuery.data.resolved === "true") {
      query = query.eq("is_resolved", true);
    }
    if (parsedQuery.data.resolved === "false") {
      query = query.eq("is_resolved", false);
    }

    const { data, error } = await query;

    if (error) {
      console.error("maintenance/notes GET failed", error);
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json({ success: true, notes: data ?? [] });
  } catch (err) {
    console.error("maintenance/notes GET unexpected", err);
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json().catch(() => null);
    const parsedBody = createNoteSchema.safeParse(body);

    if (!parsedBody.success) {
      return NextResponse.json(
        { error: "Invalid request body.", details: parsedBody.error.flatten() },
        { status: 400 }
      );
    }

    const payload = parsedBody.data;
    const supabase = createServerSupabaseClient();

    const { data: room, error: roomError } = await supabase
      .from("rooms")
      .select("id")
      .eq("id", payload.room_id)
      .maybeSingle();
    if (roomError) return NextResponse.json({ error: roomError.message }, { status: 500 });
    if (!room) return NextResponse.json({ error: "Room not found." }, { status: 404 });

    const { data: task, error: taskError } = await supabase
      .from("maintenance_tasks")
      .select("id")
      .eq("id", payload.task_id)
      .maybeSingle();
    if (taskError) return NextResponse.json({ error: taskError.message }, { status: 500 });
    if (!task) return NextResponse.json({ error: "Task not found." }, { status: 404 });

    const { data, error } = await supabase
      .from("maintenance_notes")
      .insert({
        room_id: payload.room_id,
        task_id: payload.task_id,
        note: payload.note,
      })
      .select("id, room_id, task_id, note, created_at, is_resolved, resolved_at")
      .maybeSingle();

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json({ success: true, note: data }, { status: 201 });
  } catch (err) {
    console.error("maintenance/notes POST unexpected", err);
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
