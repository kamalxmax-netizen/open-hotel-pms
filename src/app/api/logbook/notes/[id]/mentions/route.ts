import {
  assertCanManageLogbookNote,
  HttpError,
  normalizeLogbookMentionInput,
} from "@/lib/logbook-api";
import { getAuthenticatedUser } from "@/lib/server-auth";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

export const dynamic = "force-dynamic";
export const fetchCache = "force-no-store";

const paramsSchema = z.object({
  id: z.string().uuid(),
});

const bodySchema = z.object({
  mention_type: z.enum(["staff", "group_all", "group_frontdesk"]),
  staff_id: z.string().uuid().optional().nullable(),
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

    const json = await request.json().catch(() => null);
    const parsed = bodySchema.safeParse(json);
    if (!parsed.success) {
      return NextResponse.json(
        { success: false, error: "Invalid payload.", details: parsed.error.flatten() },
        { status: 400 }
      );
    }

    const normalized = await normalizeLogbookMentionInput(supabase, parsed.data);

    const { data, error } = await supabase
      .from("logbook_note_mentions")
      .insert({
        note_id: noteId,
        mention_type: normalized.mention_type,
        staff_id: normalized.staff_id,
      })
      .select("id, note_id, mention_type, staff_id, is_acknowledged, created_at")
      .maybeSingle();

    if (error) {
      if (String((error as { code?: string }).code ?? "") === "23505") {
        throw new HttpError(409, "Mention already exists on this note.");
      }
      throw new HttpError(500, error.message);
    }

    return NextResponse.json({ success: true, data });
  } catch (err) {
    if (err instanceof HttpError) {
      return NextResponse.json({ success: false, error: err.message }, { status: err.status });
    }
    console.error("api/logbook/notes/[id]/mentions POST failed", err);
    const message = err instanceof Error ? err.message : "Internal server error";
    return NextResponse.json({ success: false, error: message }, { status: 500 });
  }
}
