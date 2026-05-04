import { assertCanManageLogbookNote, HttpError } from "@/lib/logbook-api";
import { requireStaffAuth } from "@/lib/server-auth";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

export const dynamic = "force-dynamic";
export const fetchCache = "force-no-store";

const paramsSchema = z.object({
  id: z.string().uuid(),
  mentionId: z.string().uuid(),
});

export async function DELETE(
  request: NextRequest,
  context: { params: { id: string; mentionId: string } }
) {
  try {
    const supabase = createServerSupabaseClient();
    const auth = await requireStaffAuth(supabase, request);
    if (auth.error) return auth.error;

    const params = paramsSchema.safeParse(context.params);
    if (!params.success) {
      return NextResponse.json(
        { success: false, error: "Invalid params.", details: params.error.flatten() },
        { status: 400 }
      );
    }
    const noteId = params.data.id;
    const mentionId = params.data.mentionId;

    await assertCanManageLogbookNote(supabase, auth.user.id, noteId);

    const { data: existing, error: findError } = await supabase
      .from("logbook_note_mentions")
      .select("id")
      .eq("id", mentionId)
      .eq("note_id", noteId)
      .maybeSingle();

    if (findError) throw new HttpError(500, findError.message);
    if (!existing) throw new HttpError(404, "Mention not found.");

    const { error } = await supabase
      .from("logbook_note_mentions")
      .delete()
      .eq("id", mentionId)
      .eq("note_id", noteId);

    if (error) throw new HttpError(500, error.message);

    return NextResponse.json({ success: true });
  } catch (err) {
    if (err instanceof HttpError) {
      return NextResponse.json({ success: false, error: err.message }, { status: err.status });
    }
    console.error("api/logbook/notes/[id]/mentions/[mentionId] DELETE failed", err);
    const message = err instanceof Error ? err.message : "Internal server error";
    return NextResponse.json({ success: false, error: message }, { status: 500 });
  }
}
