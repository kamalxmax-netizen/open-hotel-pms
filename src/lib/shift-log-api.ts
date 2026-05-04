import { buildRichBody, HttpError, resolveLogbookActorStaffId } from "@/lib/logbook-api";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import type { ShiftLogEntry } from "@/lib/types";

type SupabaseServerClient = ReturnType<typeof createServerSupabaseClient>;

export const SHIFT_LOG_ENTRY_SELECT =
  "id, log_date, hour_slot, body, body_rich, created_by, updated_by, created_at, updated_at";

export function assertShiftLogDate(value: string): string {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    throw new HttpError(400, "date must be YYYY-MM-DD.");
  }
  return value;
}

export function assertShiftLogHour(value: string): number {
  if (!/^\d{1,2}$/.test(value)) {
    throw new HttpError(400, "hour must be 0-23.");
  }
  const hour = Number(value);
  if (!Number.isInteger(hour) || hour < 0 || hour > 23) {
    throw new HttpError(400, "hour must be 0-23.");
  }
  return hour;
}

function toShiftLogEntry(row: Record<string, unknown>): ShiftLogEntry {
  const body = String(row.body ?? "");
  const bodyRich = buildRichBody({ body, body_rich: row.body_rich }).body_rich;
  return {
    id: String(row.id),
    log_date: String(row.log_date),
    hour_slot: Number(row.hour_slot),
    body,
    body_rich: bodyRich,
    created_by: String(row.created_by),
    updated_by: row.updated_by ? String(row.updated_by) : null,
    created_at: String(row.created_at),
    updated_at: String(row.updated_at),
  };
}

export async function listShiftLogEntries(
  supabase: SupabaseServerClient,
  logDate: string
): Promise<ShiftLogEntry[]> {
  const { data, error } = await supabase
    .from("shift_log_entries")
    .select(SHIFT_LOG_ENTRY_SELECT)
    .eq("log_date", logDate)
    .order("hour_slot", { ascending: true });

  if (error) throw new HttpError(500, error.message);
  return ((data ?? []) as Array<Record<string, unknown>>).map(toShiftLogEntry);
}

export async function upsertShiftLogEntry(
  supabase: SupabaseServerClient,
  input: {
    userId: string;
    logDate: string;
    hourSlot: number;
    body: string;
    body_rich?: unknown;
  }
): Promise<ShiftLogEntry> {
  const actorStaffId = await resolveLogbookActorStaffId(supabase, input.userId);
  const richBody = buildRichBody({ body: input.body, body_rich: input.body_rich ?? null });

  const { data: existing, error: existingError } = await supabase
    .from("shift_log_entries")
    .select("id")
    .eq("log_date", input.logDate)
    .eq("hour_slot", input.hourSlot)
    .maybeSingle();

  if (existingError) throw new HttpError(500, existingError.message);

  if (existing?.id) {
    const { data, error } = await supabase
      .from("shift_log_entries")
      .update({
        body: richBody.body,
        body_rich: richBody.body_rich,
        updated_by: actorStaffId,
      })
      .eq("id", existing.id)
      .select(SHIFT_LOG_ENTRY_SELECT)
      .maybeSingle();

    if (error) throw new HttpError(500, error.message);
    if (!data) throw new HttpError(404, "Shift log entry not found.");
    return toShiftLogEntry(data as Record<string, unknown>);
  }

  const { data, error } = await supabase
    .from("shift_log_entries")
    .insert({
      log_date: input.logDate,
      hour_slot: input.hourSlot,
      body: richBody.body,
      body_rich: richBody.body_rich,
      created_by: actorStaffId,
      updated_by: actorStaffId,
    })
    .select(SHIFT_LOG_ENTRY_SELECT)
    .maybeSingle();

  if (error) throw new HttpError(500, error.message);
  if (!data) throw new HttpError(500, "Failed to save shift log entry.");
  return toShiftLogEntry(data as Record<string, unknown>);
}
