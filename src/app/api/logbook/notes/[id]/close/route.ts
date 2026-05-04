import { assertCanManageLogbookNote, HttpError, resolveLogbookActorStaffId } from "@/lib/logbook-api";
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

    const { data: current, error: currentError } = await supabase
      .from("logbook_notes")
      .select("id, end_at, closed_at")
      .eq("id", noteId)
      .maybeSingle();

    if (currentError) throw new HttpError(500, currentError.message);
    if (!current) throw new HttpError(404, "Logbook note not found.");
    if (current.closed_at) return new NextResponse(null, { status: 204 });

    const nowIso = new Date().toISOString();
    const currentEndAt = current.end_at ? new Date(String(current.end_at)) : null;
    const nextEndAt =
      currentEndAt && !Number.isNaN(currentEndAt.getTime()) && currentEndAt.getTime() < Date.now()
        ? currentEndAt.toISOString()
        : nowIso;
    const actorStaffId = await resolveLogbookActorStaffId(supabase, auth.user.id);

    const { error } = await supabase
      .from("logbook_notes")
      .update({
        closed_at: nowIso,
        closed_by: actorStaffId,
        end_at: nextEndAt,
      })
      .eq("id", noteId);

    if (error) throw new HttpError(500, error.message);
    console.info("[logbook] note closed", { noteId, actorStaffId });
    return new NextResponse(null, { status: 204 });
  } catch (err) {
    if (err instanceof HttpError) {
      return NextResponse.json({ success: false, error: err.message }, { status: err.status });
    }
    console.error("api/logbook/notes/[id]/close POST failed", err);
    const message = err instanceof Error ? err.message : "Internal server error";
    return NextResponse.json({ success: false, error: message }, { status: 500 });
  }
}
