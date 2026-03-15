import { createServerSupabaseClient } from "@/lib/supabase/server";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

const paramsSchema = z.object({ id: z.string().uuid("Invalid note id") });
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

    const noteId = parsedParams.data.id;
    const supabase = createServerSupabaseClient();

    const { data: note, error: fetchError } = await supabase
      .from("maintenance_notes")
      .select("id, is_resolved")
      .eq("id", noteId)
      .maybeSingle();

    if (fetchError) {
      return NextResponse.json({ error: fetchError.message }, { status: 500 });
    }
    if (!note) {
      return NextResponse.json({ error: "Note not found." }, { status: 404 });
    }
    if (note.is_resolved) {
      return NextResponse.json({ success: true });
    }

    const { error: updateError } = await supabase
      .from("maintenance_notes")
      .update({
        is_resolved: true,
        resolved_at: new Date().toISOString(),
      })
      .eq("id", noteId);

    if (updateError) {
      return NextResponse.json({ error: updateError.message }, { status: 500 });
    }

    return NextResponse.json({ success: true });
  } catch (err) {
    console.error("maintenance/notes/[id]/resolve POST unexpected", err);
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
