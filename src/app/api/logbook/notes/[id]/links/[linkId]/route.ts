import { assertCanManageLogbookNote, HttpError } from "@/lib/logbook-api";
import { getAuthenticatedUser } from "@/lib/server-auth";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

export const dynamic = "force-dynamic";
export const fetchCache = "force-no-store";

const paramsSchema = z.object({
  id: z.string().uuid(),
  linkId: z.string().uuid(),
});

export async function DELETE(
  request: NextRequest,
  context: { params: { id: string; linkId: string } }
) {
  try {
    const supabase = createServerSupabaseClient();
    const user = await getAuthenticatedUser(supabase, request);

    const params = paramsSchema.safeParse(context.params);
    if (!params.success) {
      return NextResponse.json(
        { success: false, error: "Invalid params.", details: params.error.flatten() },
        { status: 400 }
      );
    }
    const noteId = params.data.id;
    const linkId = params.data.linkId;

    await assertCanManageLogbookNote(supabase, user?.id ?? null, noteId);

    const { data: existing, error: findError } = await supabase
      .from("logbook_note_links")
      .select("id")
      .eq("id", linkId)
      .eq("note_id", noteId)
      .maybeSingle();

    if (findError) throw new HttpError(500, findError.message);
    if (!existing) throw new HttpError(404, "Link not found.");

    const { error } = await supabase
      .from("logbook_note_links")
      .delete()
      .eq("id", linkId)
      .eq("note_id", noteId);

    if (error) throw new HttpError(500, error.message);

    return NextResponse.json({ success: true });
  } catch (err) {
    if (err instanceof HttpError) {
      return NextResponse.json({ success: false, error: err.message }, { status: err.status });
    }
    console.error("api/logbook/notes/[id]/links/[linkId] DELETE failed", err);
    const message = err instanceof Error ? err.message : "Internal server error";
    return NextResponse.json({ success: false, error: message }, { status: 500 });
  }
}
