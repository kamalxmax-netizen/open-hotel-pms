import { assertCanManageLogbookNote, HttpError, resolveLogbookActorStaffId } from "@/lib/logbook-api";
import { getAuthenticatedUser } from "@/lib/server-auth";
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
    const user = await getAuthenticatedUser(supabase, request);

    const params = paramsSchema.safeParse(context.params);
    if (!params.success) {
      return NextResponse.json(
        { success: false, error: "Invalid note id.", details: params.error.flatten() },
        { status: 400 }
      );
    }

    const noteId = params.data.id;
    await assertCanManageLogbookNote(supabase, user?.id ?? null, noteId);
    const actorStaffId = await resolveLogbookActorStaffId(supabase, user?.id ?? null);

    const { data, error } = await supabase
      .from("logbook_notes")
      .update({
        archived_at: new Date().toISOString(),
        archived_by: actorStaffId,
      })
      .eq("id", noteId)
      .is("archived_at", null)
      .select("id, archived_at, archived_by")
      .maybeSingle();

    if (error) throw new HttpError(500, error.message);
    if (!data) throw new HttpError(404, "Active logbook note not found.");

    return NextResponse.json({ success: true, data });
  } catch (err) {
    if (err instanceof HttpError) {
      return NextResponse.json({ success: false, error: err.message }, { status: err.status });
    }
    console.error("api/logbook/notes/[id]/archive POST failed", err);
    const message = err instanceof Error ? err.message : "Internal server error";
    return NextResponse.json({ success: false, error: message }, { status: 500 });
  }
}
