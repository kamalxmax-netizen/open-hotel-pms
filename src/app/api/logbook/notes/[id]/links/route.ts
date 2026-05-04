import {
  assertCanManageLogbookNote,
  HttpError,
  normalizeLogbookLinkInput,
} from "@/lib/logbook-api";
import { requireStaffAuth } from "@/lib/server-auth";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

export const dynamic = "force-dynamic";
export const fetchCache = "force-no-store";

const paramsSchema = z.object({
  id: z.string().uuid(),
});

const bodySchema = z.object({
  link_type: z.enum(["room", "guest", "stock", "staff"]),
  ref_id: z.string().uuid().optional().nullable(),
  ref_code: z.string().trim().max(120).optional().nullable(),
  room_link_mode: z.enum(["static", "dynamic"]).optional().nullable(),
  label: z.string().trim().max(160).optional().nullable(),
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

    const json = await request.json().catch(() => null);
    const parsed = bodySchema.safeParse(json);
    if (!parsed.success) {
      return NextResponse.json(
        { success: false, error: "Invalid payload.", details: parsed.error.flatten() },
        { status: 400 }
      );
    }

    const normalized = await normalizeLogbookLinkInput(supabase, parsed.data);

    let existingQuery = supabase
      .from("logbook_note_links")
      .select("id, note_id, link_type, ref_id, ref_code, room_link_mode, label, created_at")
      .eq("note_id", noteId)
      .eq("link_type", normalized.link_type);

    if (normalized.ref_id) {
      existingQuery = existingQuery.eq("ref_id", normalized.ref_id);
    } else {
      existingQuery = existingQuery.is("ref_id", null).eq("ref_code", normalized.ref_code);
    }

    const { data: existing, error: existingError } = await existingQuery.maybeSingle();
    if (existingError) throw new HttpError(500, existingError.message);
    if (existing) {
      return NextResponse.json({ success: true, data: existing });
    }

    const { data, error } = await supabase
      .from("logbook_note_links")
      .insert({
        note_id: noteId,
        link_type: normalized.link_type,
        ref_id: normalized.ref_id,
        ref_code: normalized.ref_code,
        room_link_mode: normalized.room_link_mode,
        label: normalized.label,
      })
      .select("id, note_id, link_type, ref_id, ref_code, room_link_mode, label, created_at")
      .maybeSingle();

    if (error) throw new HttpError(500, error.message);

    return NextResponse.json({ success: true, data });
  } catch (err) {
    if (err instanceof HttpError) {
      return NextResponse.json({ success: false, error: err.message }, { status: err.status });
    }
    console.error("api/logbook/notes/[id]/links POST failed", err);
    const message = err instanceof Error ? err.message : "Internal server error";
    return NextResponse.json({ success: false, error: message }, { status: 500 });
  }
}
