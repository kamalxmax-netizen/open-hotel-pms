import {
  buildRichBody,
  dedupeMentionInputs,
  extractLogbookInlineRefs,
  getNextLogbookZIndex,
  LOGBOOK_BOARD_MODES,
  HttpError,
  LOGBOOK_MENTION_TYPES,
  LOGBOOK_NOTE_TYPES,
  LOGBOOK_PRIORITIES,
  LOGBOOK_STATUSES,
  normalizeLogbookLinkInput,
  normalizeLogbookMentionInput,
  resolveLogbookActorStaffId,
} from "@/lib/logbook-api";
import { hydrateLogbookNotes, LogbookNoteRow } from "@/lib/logbook-query";
import { getAuthenticatedUser } from "@/lib/server-auth";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

export const dynamic = "force-dynamic";
export const fetchCache = "force-no-store";

const dateRegex = /^\d{4}-\d{2}-\d{2}$/;

const booleanQueryParam = z.preprocess((value) => {
  if (value === undefined || value === null || value === "") return undefined;
  if (typeof value === "boolean") return value;
  if (typeof value === "string") {
    const normalized = value.trim().toLowerCase();
    if (normalized === "true") return true;
    if (normalized === "false") return false;
  }
  return value;
}, z.boolean().optional());

const querySchema = z.object({
  date: z.string().regex(dateRegex, "date must be YYYY-MM-DD").optional(),
  type: z.string().optional(),
  staff_id: z.string().uuid().optional(),
  status: z.enum(LOGBOOK_STATUSES).optional(),
  archived: booleanQueryParam.default(false),
  q: z.string().trim().max(160).optional(),
  limit: z.coerce.number().int().min(1).max(200).optional().default(50),
  offset: z.coerce.number().int().min(0).optional().default(0),
});

const createLinkSchema = z.object({
  link_type: z.enum(["room", "guest", "stock", "staff"]),
  ref_id: z.string().uuid().optional().nullable(),
  ref_code: z.string().trim().max(120).optional().nullable(),
  room_link_mode: z.enum(["static", "dynamic"]).optional().nullable(),
  label: z.string().trim().max(160).optional().nullable(),
});

const createMentionSchema = z.object({
  mention_type: z.enum(LOGBOOK_MENTION_TYPES),
  staff_id: z.string().uuid().optional().nullable(),
});

const createSchema = z.object({
  title: z.string().trim().min(1).max(200),
  body: z.string().max(10000).optional().default(""),
  body_rich: z.record(z.string(), z.any()).nullable().optional(),
  note_type: z.enum(LOGBOOK_NOTE_TYPES).optional().default("general"),
  status: z.enum(LOGBOOK_STATUSES).optional().default("open"),
  priority: z.enum(LOGBOOK_PRIORITIES).optional().default("normal"),
  remind_at: z.string().datetime().optional().nullable(),
  x: z.coerce.number().int().min(-10000).max(10000).optional(),
  y: z.coerce.number().int().min(-10000).max(10000).optional(),
  width: z.coerce.number().int().min(200).max(1200).optional().default(320),
  height: z.coerce.number().int().min(120).max(1200).optional().default(220),
  z_index: z.coerce.number().int().min(1).max(2000000000).optional(),
  is_minimized: z.boolean().optional().default(false),
  board_mode: z.enum(LOGBOOK_BOARD_MODES).optional(),
  links: z.array(createLinkSchema).optional().default([]),
  mentions: z.array(createMentionSchema).optional().default([]),
});

function toUTCWindow(date: string): { from: string; to: string } {
  const from = `${date}T00:00:00.000Z`;
  const base = new Date(from);
  base.setUTCDate(base.getUTCDate() + 1);
  return {
    from,
    to: base.toISOString(),
  };
}

function parseTypeList(raw: string | undefined): Array<(typeof LOGBOOK_NOTE_TYPES)[number]> {
  if (!raw) return [];
  const set = new Set<string>();
  for (const part of raw.split(",")) {
    const value = part.trim();
    if (!value) continue;
    set.add(value);
  }

  const list = Array.from(set);
  if (list.length === 0) return [];
  const allowed = new Set<string>(LOGBOOK_NOTE_TYPES);
  for (const value of list) {
    if (!allowed.has(value)) {
      throw new HttpError(400, `Invalid note type filter: ${value}`);
    }
  }
  return list as Array<(typeof LOGBOOK_NOTE_TYPES)[number]>;
}

export async function GET(request: NextRequest) {
  try {
    const supabase = createServerSupabaseClient();
    const user = await getAuthenticatedUser(supabase, request);
    // Legacy PMS mode: allow read without strict auth gate.
    void user;

    const parsed = querySchema.safeParse({
      date: request.nextUrl.searchParams.get("date") ?? undefined,
      type: request.nextUrl.searchParams.get("type") ?? undefined,
      staff_id: request.nextUrl.searchParams.get("staff_id") ?? undefined,
      status: request.nextUrl.searchParams.get("status") ?? undefined,
      archived: request.nextUrl.searchParams.get("archived") ?? undefined,
      q: request.nextUrl.searchParams.get("q") ?? undefined,
      limit: request.nextUrl.searchParams.get("limit") ?? undefined,
      offset: request.nextUrl.searchParams.get("offset") ?? undefined,
    });

    if (!parsed.success) {
      return NextResponse.json(
        { success: false, error: "Invalid query.", details: parsed.error.flatten() },
        { status: 400 }
      );
    }

    const { date, staff_id, status, limit, offset, archived, q } = parsed.data;
    const typeList = parseTypeList(parsed.data.type);

    let query = supabase
      .from("logbook_notes")
      .select(
        "id, title, body, body_rich, note_type, status, priority, x, y, width, height, z_index, is_minimized, board_mode, remind_at, archived_at, archived_by, created_by, created_at, updated_at",
        { count: "exact" }
      )
      .order("updated_at", { ascending: false })
      .range(offset, offset + limit - 1);

    query = archived ? query.not("archived_at", "is", null) : query.is("archived_at", null);
    if (status) query = query.eq("status", status);
    if (staff_id) query = query.eq("created_by", staff_id);
    if (typeList.length === 1) query = query.eq("note_type", typeList[0]);
    if (typeList.length > 1) query = query.in("note_type", typeList);
    if (q) query = query.or(`title.ilike.%${q}%,body.ilike.%${q}%`);
    if (date) {
      const { from, to } = toUTCWindow(date);
      query = archived
        ? query.gte("archived_at", from).lt("archived_at", to)
        : query.gte("created_at", from).lt("created_at", to);
    }

    const { data, error, count } = await query;
    if (error) throw new HttpError(500, error.message);

    const notes = await hydrateLogbookNotes(supabase, (data ?? []) as LogbookNoteRow[]);

    return NextResponse.json({
      success: true,
      data: notes,
      total: count ?? 0,
      limit,
      offset,
    });
  } catch (err) {
    if (err instanceof HttpError) {
      return NextResponse.json({ success: false, error: err.message }, { status: err.status });
    }
    console.error("api/logbook/notes GET failed", err);
    const message = err instanceof Error ? err.message : "Internal server error";
    return NextResponse.json({ success: false, error: message }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const supabase = createServerSupabaseClient();
    const user = await getAuthenticatedUser(supabase, request);

    const json = await request.json().catch(() => null);
    const parsed = createSchema.safeParse(json);
    if (!parsed.success) {
      return NextResponse.json(
        { success: false, error: "Invalid payload.", details: parsed.error.flatten() },
        { status: 400 }
      );
    }

    const payload = parsed.data;
    const richBody = buildRichBody({ body: payload.body ?? "", body_rich: payload.body_rich ?? null });

    const actorStaffId = await resolveLogbookActorStaffId(supabase, user?.id ?? null);

    const zIndex = payload.z_index ?? (await getNextLogbookZIndex(supabase));
    const x = payload.x ?? 40;
    const y = payload.y ?? 40;
    const boardMode = payload.board_mode ?? (payload.is_minimized ? "minimized" : "middle");
    const width = boardMode === "minimized" ? 300 : payload.width;
    const height = boardMode === "minimized" ? 44 : payload.height;

    const { data: inserted, error: insertError } = await supabase
      .from("logbook_notes")
      .insert({
        title: payload.title,
        body: richBody.body,
        body_rich: richBody.body_rich,
        note_type: payload.note_type,
        status: payload.status,
        priority: payload.priority,
        remind_at: payload.remind_at ?? null,
        x,
        y,
        width,
        height,
        z_index: zIndex,
        is_minimized: boardMode === "minimized",
        board_mode: boardMode,
        created_by: actorStaffId,
      })
      .select(
        "id, title, body, body_rich, note_type, status, priority, x, y, width, height, z_index, is_minimized, board_mode, remind_at, archived_at, archived_by, created_by, created_at, updated_at"
      )
      .maybeSingle();

    if (insertError) throw new HttpError(500, insertError.message);
    if (!inserted) throw new HttpError(500, "Failed to create logbook note.");

    const linkRows = [];
    for (const item of payload.links) {
      linkRows.push(await normalizeLogbookLinkInput(supabase, item));
    }

    const inlineRefs = extractLogbookInlineRefs(payload.body ?? "");
    for (const link of inlineRefs.links) {
      linkRows.push(
        await normalizeLogbookLinkInput(supabase, {
          link_type: link.link_type,
          ref_id: null,
          ref_code: link.ref_code,
          label: link.label,
        })
      );
    }
    const dedupedLinkRows = Array.from(
      new Map(
        linkRows.map((row) => [
          `${row.link_type}:${row.ref_id ?? ""}:${row.ref_code ?? ""}:${row.label}`,
          row,
        ])
      ).values()
    );

    if (dedupedLinkRows.length > 0) {
      const { error: linkInsertError } = await supabase.from("logbook_note_links").insert(
        dedupedLinkRows.map((row) => ({
          note_id: String(inserted.id),
          link_type: row.link_type,
          ref_id: row.ref_id,
          ref_code: row.ref_code,
          room_link_mode: row.room_link_mode ?? "static",
          label: row.label,
        }))
      );
      if (linkInsertError) throw new HttpError(500, linkInsertError.message);
    }

    const normalizedMentions = [];
    for (const mention of payload.mentions) {
      normalizedMentions.push(await normalizeLogbookMentionInput(supabase, mention));
    }
    for (const mention of inlineRefs.mentions) {
      normalizedMentions.push(mention);
    }
    const mentionRows = dedupeMentionInputs(normalizedMentions);

    if (mentionRows.length > 0) {
      const { error: mentionInsertError } = await supabase
        .from("logbook_note_mentions")
        .insert(
          mentionRows.map((row) => ({
            note_id: String(inserted.id),
            mention_type: row.mention_type,
            staff_id: row.staff_id,
          }))
        );
      if (mentionInsertError) throw new HttpError(500, mentionInsertError.message);
    }

    const hydrated = await hydrateLogbookNotes(supabase, [
      inserted as unknown as LogbookNoteRow,
    ]);

    return NextResponse.json({ success: true, data: hydrated[0] ?? null });
  } catch (err) {
    if (err instanceof HttpError) {
      return NextResponse.json({ success: false, error: err.message }, { status: err.status });
    }
    console.error("api/logbook/notes POST failed", err);
    const message = err instanceof Error ? err.message : "Internal server error";
    return NextResponse.json({ success: false, error: message }, { status: 500 });
  }
}
