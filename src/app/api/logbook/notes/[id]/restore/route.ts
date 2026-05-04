import { assertCanManageLogbookNote, HttpError } from "@/lib/logbook-api";
import { hydrateLogbookNotes, LOGBOOK_NOTE_SELECT, LogbookNoteRow } from "@/lib/logbook-query";
import { requireStaffAuth } from "@/lib/server-auth";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

export const dynamic = "force-dynamic";
export const fetchCache = "force-no-store";

const paramsSchema = z.object({
  id: z.string().uuid(),
});

export async function POST(request: NextRequest, context: { params: { id: string } }) {
  try {
    const supabase = createServerSupabaseClient();
    const auth = await requireStaffAuth(supabase, request);
    if (auth.error) return auth.error;

    const params = paramsSchema.safeParse(context.params);
    if (!params.success) {
      return NextResponse.json(
        { success: false, error: "Invalid note id.", details: params.error.flatten() },
        { status: 400 }
      );
    }

    const noteId = params.data.id;
    await assertCanManageLogbookNote(supabase, auth.user.id, noteId);

    const { data, error } = await supabase
      .from("logbook_notes")
      .update({
        archived_at: null,
        archived_by: null,
      })
      .eq("id", noteId)
      .not("archived_at", "is", null)
      .select(LOGBOOK_NOTE_SELECT)
      .maybeSingle();

    if (error) throw new HttpError(500, error.message);
    if (!data) throw new HttpError(404, "Archived logbook note not found.");

    const hydrated = await hydrateLogbookNotes(supabase, [data as unknown as LogbookNoteRow]);
    return NextResponse.json({ success: true, data: hydrated[0] ?? null });
  } catch (err) {
    if (err instanceof HttpError) {
      return NextResponse.json({ success: false, error: err.message }, { status: err.status });
    }
    console.error("api/logbook/notes/[id]/restore POST failed", err);
    const message = err instanceof Error ? err.message : "Internal server error";
    return NextResponse.json({ success: false, error: message }, { status: 500 });
  }
}
