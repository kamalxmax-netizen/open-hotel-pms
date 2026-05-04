import {
  assertCanManageLogbookNote,
  buildRichBody,
  extractLogbookInlineRefs,
  HttpError,
  LOGBOOK_BOARD_MODES,
  LOGBOOK_WINDOW_PRESETS,
  normalizeLogbookLinkInput,
  LOGBOOK_NOTE_TYPES,
  LOGBOOK_PRIORITIES,
  LOGBOOK_STATUSES,
  resolveLogbookWindow,
} from "@/lib/logbook-api";
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

const patchSchema = z
  .object({
    title: z.string().trim().min(1).max(200).optional(),
    body: z.string().max(10000).optional(),
    body_rich: z.record(z.string(), z.any()).nullable().optional(),
    note_type: z.enum(LOGBOOK_NOTE_TYPES).optional(),
    status: z.enum(LOGBOOK_STATUSES).optional(),
    priority: z.enum(LOGBOOK_PRIORITIES).optional(),
    remind_at: z.string().datetime().nullable().optional(),
    start_at: z.string().datetime().nullable().optional(),
    end_at: z.string().datetime().nullable().optional(),
    preset: z.enum(LOGBOOK_WINDOW_PRESETS).optional(),
    board_mode: z.enum(LOGBOOK_BOARD_MODES).optional(),
  })
  .refine((value) => Object.keys(value).length > 0, "At least one field is required.");

export async function GET(request: NextRequest, context: { params: { id: string } }) {
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
    const { data, error } = await supabase
      .from("logbook_notes")
      .select(LOGBOOK_NOTE_SELECT)
      .eq("id", noteId)
      .maybeSingle();

    if (error) throw new HttpError(500, error.message);
    if (!data) throw new HttpError(404, "Logbook note not found.");

    const hydrated = await hydrateLogbookNotes(supabase, [data as unknown as LogbookNoteRow]);
    return NextResponse.json({ success: true, data: hydrated[0] ?? null });
  } catch (err) {
    if (err instanceof HttpError) {
      return NextResponse.json({ success: false, error: err.message }, { status: err.status });
    }
    console.error("api/logbook/notes/[id] GET failed", err);
    const message = err instanceof Error ? err.message : "Internal server error";
    return NextResponse.json({ success: false, error: message }, { status: 500 });
  }
}

export async function PATCH(request: NextRequest, context: { params: { id: string } }) {
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
    const parsed = patchSchema.safeParse(json);
    if (!parsed.success) {
      return NextResponse.json(
        { success: false, error: "Invalid payload.", details: parsed.error.flatten() },
        { status: 400 }
      );
    }

    const payload = parsed.data;
    const updates: Record<string, unknown> = {};
    if (payload.title !== undefined) updates.title = payload.title;
    const richBody = payload.body !== undefined || payload.body_rich !== undefined
      ? buildRichBody({ body: payload.body ?? "", body_rich: payload.body_rich ?? null })
      : null;
    if (richBody) {
      updates.body = richBody.body;
      updates.body_rich = richBody.body_rich;
    }
    if (payload.note_type !== undefined) updates.note_type = payload.note_type;
    if (payload.status !== undefined) updates.status = payload.status;
    if (payload.priority !== undefined) updates.priority = payload.priority;
    if (payload.remind_at !== undefined) updates.remind_at = payload.remind_at;
    if (payload.start_at !== undefined || payload.end_at !== undefined || payload.preset !== undefined) {
      const { data: current, error: currentError } = await supabase
        .from("logbook_notes")
        .select("start_at, end_at")
        .eq("id", noteId)
        .maybeSingle();
      if (currentError) throw new HttpError(500, currentError.message);
      if (!current) throw new HttpError(404, "Logbook note not found.");
      const window = resolveLogbookWindow({
        start_at: payload.start_at === undefined ? String(current.start_at) : payload.start_at,
        end_at: payload.end_at === undefined ? String(current.end_at ?? "") || undefined : payload.end_at,
        preset: payload.preset,
      });
      updates.start_at = window.start_at;
      updates.end_at = window.end_at;
    }
    if (payload.board_mode !== undefined) {
      updates.board_mode = payload.board_mode;
      updates.is_minimized = payload.board_mode === "minimized";
      if (payload.board_mode === "minimized") {
        updates.width = 300;
        updates.height = 44;
      }
    }

    const { data: updated, error: updateError } = await supabase
      .from("logbook_notes")
      .update(updates)
      .eq("id", noteId)
      .select(LOGBOOK_NOTE_SELECT)
      .maybeSingle();

    if (updateError) throw new HttpError(500, updateError.message);
    if (!updated) throw new HttpError(404, "Logbook note not found.");

    if (payload.body !== undefined) {
      const inlineRefs = extractLogbookInlineRefs(richBody?.body ?? payload.body);

      if (inlineRefs.links.length > 0) {
        const { data: existingLinks, error: existingLinksError } = await supabase
          .from("logbook_note_links")
          .select("link_type, ref_code")
          .eq("note_id", noteId);
        if (existingLinksError) throw new HttpError(500, existingLinksError.message);

        const existingKeys = new Set(
          (existingLinks ?? []).map((row) => `${String(row.link_type)}:${String(row.ref_code ?? "")}`)
        );
        const missingLinkRows = await Promise.all(
          inlineRefs.links
            .filter((row) => !existingKeys.has(`${row.link_type}:${row.ref_code ?? ""}`))
            .map(async (row) => {
              const normalized = await normalizeLogbookLinkInput(supabase, {
                link_type: row.link_type,
                ref_id: null,
                ref_code: row.ref_code,
                label: row.label,
              });
              return {
                note_id: noteId,
                link_type: normalized.link_type,
                ref_id: normalized.ref_id,
                ref_code: normalized.ref_code,
                room_link_mode: normalized.room_link_mode,
                label: normalized.label,
              };
            })
        );

        if (missingLinkRows.length > 0) {
          const { error: insertLinkError } = await supabase.from("logbook_note_links").insert(missingLinkRows);
          if (insertLinkError) throw new HttpError(500, insertLinkError.message);
        }
      }

      if (inlineRefs.mentions.length > 0) {
        const { data: existingMentions, error: existingMentionsError } = await supabase
          .from("logbook_note_mentions")
          .select("mention_type, staff_id")
          .eq("note_id", noteId);
        if (existingMentionsError) throw new HttpError(500, existingMentionsError.message);

        const existingMentionKeys = new Set(
          (existingMentions ?? []).map((row) => `${String(row.mention_type)}:${String(row.staff_id ?? "")}`)
        );

        const missingMentionRows = inlineRefs.mentions
          .filter(
            (row) => !existingMentionKeys.has(`${row.mention_type}:`)
          )
          .map((row) => ({
            note_id: noteId,
            mention_type: row.mention_type,
            staff_id: null,
          }));

        if (missingMentionRows.length > 0) {
          const { error: insertMentionError } = await supabase
            .from("logbook_note_mentions")
            .insert(missingMentionRows);
          if (insertMentionError) throw new HttpError(500, insertMentionError.message);
        }
      }
    }

    const hydrated = await hydrateLogbookNotes(supabase, [updated as unknown as LogbookNoteRow]);
    return NextResponse.json({ success: true, data: hydrated[0] ?? null });
  } catch (err) {
    if (err instanceof HttpError) {
      return NextResponse.json({ success: false, error: err.message }, { status: err.status });
    }
    console.error("api/logbook/notes/[id] PATCH failed", err);
    const message = err instanceof Error ? err.message : "Internal server error";
    return NextResponse.json({ success: false, error: message }, { status: 500 });
  }
}

export async function DELETE(request: NextRequest, context: { params: { id: string } }) {
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

    const { data: noteRow, error: noteError } = await supabase
      .from("logbook_notes")
      .select("archived_at")
      .eq("id", noteId)
      .maybeSingle();
    if (noteError) throw new HttpError(500, noteError.message);
    if (!noteRow?.archived_at) {
      throw new HttpError(400, "Only archived notes can be permanently deleted.");
    }

    const { error } = await supabase.from("logbook_notes").delete().eq("id", noteId);
    if (error) throw new HttpError(500, error.message);

    return NextResponse.json({ success: true });
  } catch (err) {
    if (err instanceof HttpError) {
      return NextResponse.json({ success: false, error: err.message }, { status: err.status });
    }
    console.error("api/logbook/notes/[id] DELETE failed", err);
    const message = err instanceof Error ? err.message : "Internal server error";
    return NextResponse.json({ success: false, error: message }, { status: 500 });
  }
}
