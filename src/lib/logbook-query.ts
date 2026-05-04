import { createServerSupabaseClient } from "@/lib/supabase/server";
import { LogbookMention, LogbookNote, LogbookNoteLink, LogbookRichBody } from "@/lib/types";

type SupabaseServerClient = ReturnType<typeof createServerSupabaseClient>;

export const LOGBOOK_NOTE_SELECT =
  "id, title, body, body_rich, note_type, status, priority, x, y, width, height, z_index, is_minimized, board_mode, remind_at, start_at, end_at, closed_at, closed_by, archived_at, archived_by, created_by, created_at, updated_at";

export type LogbookNoteRow = {
  id: string;
  title: string;
  body: string;
  note_type: string;
  status: string;
  priority: string;
  x: number;
  y: number;
  width: number;
  height: number;
  z_index: number;
  is_minimized: boolean;
  board_mode: string | null;
  remind_at: string | null;
  start_at: string;
  end_at: string | null;
  closed_at: string | null;
  closed_by: string | null;
  archived_at: string | null;
  archived_by: string | null;
  body_rich: unknown;
  created_by: string;
  created_at: string;
  updated_at: string;
};

function toNullableString(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  const text = String(value).trim();
  return text.length > 0 ? text : null;
}

function normalizeRichBody(value: unknown, fallbackBody: string): LogbookRichBody | null {
  if (!value || typeof value !== "object") return null;
  const raw = value as Record<string, unknown>;
  const html = typeof raw.html === "string" ? raw.html : fallbackBody.replace(/\n/g, "<br>");
  const stylesRaw = raw.styles && typeof raw.styles === "object" ? (raw.styles as Record<string, unknown>) : {};
  const size = stylesRaw.size === "s" || stylesRaw.size === "l" ? stylesRaw.size : "m";
  return {
    html,
    styles: {
      bold: Boolean(stylesRaw.bold),
      color: typeof stylesRaw.color === "string" && stylesRaw.color.trim().length > 0 ? stylesRaw.color : "#334155",
      size,
    },
  };
}

export async function hydrateLogbookNotes(
  supabase: SupabaseServerClient,
  rows: LogbookNoteRow[]
): Promise<LogbookNote[]> {
  if (rows.length === 0) return [];

  const noteIds = rows.map((row) => String(row.id));

  const [linksRes, mentionsRes] = await Promise.all([
    supabase
      .from("logbook_note_links")
      .select("id, note_id, link_type, ref_id, ref_code, room_link_mode, label, created_at")
      .in("note_id", noteIds)
      .order("created_at", { ascending: true }),
    supabase
      .from("logbook_note_mentions")
      .select("id, note_id, mention_type, staff_id, is_acknowledged, created_at")
      .in("note_id", noteIds)
      .order("created_at", { ascending: true }),
  ]);

  if (linksRes.error) throw new Error(linksRes.error.message);
  if (mentionsRes.error) throw new Error(mentionsRes.error.message);

  const linkRows = (linksRes.data ?? []) as Array<Record<string, unknown>>;
  const mentionRows = (mentionsRes.data ?? []) as Array<Record<string, unknown>>;

  const linksByNote = new Map<string, LogbookNoteLink[]>();
  for (const row of linkRows) {
    const noteId = String(row.note_id ?? "");
    const list = linksByNote.get(noteId) ?? [];
    list.push({
      id: String(row.id),
      note_id: noteId,
      link_type: String(row.link_type) as LogbookNoteLink["link_type"],
      ref_id: toNullableString(row.ref_id),
      ref_code: toNullableString(row.ref_code),
      room_link_mode: String(row.room_link_mode ?? "static") === "dynamic" ? "dynamic" : "static",
      label: String(row.label ?? ""),
      created_at: String(row.created_at ?? ""),
    });
    linksByNote.set(noteId, list);
  }

  const staffIds = new Set<string>();
  for (const row of rows) {
    if (row.created_by) staffIds.add(String(row.created_by));
  }
  for (const mention of mentionRows) {
    const staffId = toNullableString(mention.staff_id);
    if (staffId) staffIds.add(staffId);
  }

  const staffMap = new Map<
    string,
    {
      id: string;
      employee_code: string;
      display_name: string;
      nickname: string | null;
      department_id: string | null;
      department: { code: string; name: string } | null;
    }
  >();

  if (staffIds.size > 0) {
    const staffIdList = Array.from(staffIds);
    const { data: staffs, error: staffError } = await supabase
      .from("staff")
      .select("id, employee_code, display_name, nickname, department_id")
      .in("id", staffIdList);

    if (staffError) throw new Error(staffError.message);

    const staffRows = (staffs ?? []) as Array<Record<string, unknown>>;
    const departmentIds = Array.from(
      new Set(
        staffRows
          .map((staff) => toNullableString(staff.department_id))
          .filter((id): id is string => Boolean(id))
      )
    );

    const departmentMap = new Map<string, { code: string; name: string }>();
    if (departmentIds.length > 0) {
      const { data: departments, error: departmentError } = await supabase
        .from("departments")
        .select("id, code, name")
        .in("id", departmentIds);
      if (departmentError) throw new Error(departmentError.message);

      for (const row of (departments ?? []) as Array<Record<string, unknown>>) {
        departmentMap.set(String(row.id), {
          code: String(row.code),
          name: String(row.name),
        });
      }
    }

    for (const row of staffRows) {
      const id = String(row.id);
      const departmentId = toNullableString(row.department_id);
      staffMap.set(id, {
        id,
        employee_code: String(row.employee_code ?? ""),
        display_name: String(row.display_name ?? ""),
        nickname: toNullableString(row.nickname),
        department_id: departmentId,
        department: departmentId ? departmentMap.get(departmentId) ?? null : null,
      });
    }
  }

  const mentionsByNote = new Map<string, LogbookMention[]>();
  for (const row of mentionRows) {
    const noteId = String(row.note_id ?? "");
    const staffId = toNullableString(row.staff_id);
    const staff = staffId ? staffMap.get(staffId) : null;

    const list = mentionsByNote.get(noteId) ?? [];
    list.push({
      id: String(row.id),
      note_id: noteId,
      mention_type: String(row.mention_type) as LogbookMention["mention_type"],
      staff_id: staffId,
      is_acknowledged: Boolean(row.is_acknowledged),
      created_at: String(row.created_at ?? ""),
      staff: staff
        ? {
            id: staff.id,
            display_name: staff.display_name,
          }
        : undefined,
    });
    mentionsByNote.set(noteId, list);
  }

  return rows.map((row) => {
    const author = staffMap.get(String(row.created_by));

    return {
      id: String(row.id),
      title: String(row.title ?? ""),
      body: String(row.body ?? ""),
      body_rich: normalizeRichBody(row.body_rich, String(row.body ?? "")),
      note_type: String(row.note_type) as LogbookNote["note_type"],
      status: String(row.status) as LogbookNote["status"],
      priority: String(row.priority) as LogbookNote["priority"],
      x: Number(row.x ?? 40),
      y: Number(row.y ?? 40),
      width: Number(row.width ?? 320),
      height: Number(row.height ?? 220),
      z_index: Number(row.z_index ?? 1),
      is_minimized: Boolean(row.is_minimized),
      board_mode:
        String(row.board_mode ?? "").trim() === "minimized" || Boolean(row.is_minimized)
          ? "minimized"
          : "middle",
      remind_at: toNullableString(row.remind_at),
      start_at: String(row.start_at ?? row.created_at),
      end_at: toNullableString(row.end_at),
      closed_at: toNullableString(row.closed_at),
      closed_by: toNullableString(row.closed_by),
      archived_at: toNullableString(row.archived_at),
      archived_by: toNullableString(row.archived_by),
      created_by: String(row.created_by),
      created_at: String(row.created_at),
      updated_at: String(row.updated_at),
      links: linksByNote.get(String(row.id)) ?? [],
      mentions: mentionsByNote.get(String(row.id)) ?? [],
      author: author
        ? {
            id: author.id,
            employee_code: author.employee_code,
            display_name: author.display_name,
            nickname: author.nickname,
          }
        : undefined,
    };
  });
}
