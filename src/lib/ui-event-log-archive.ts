import { createHash } from "node:crypto";
import { gzipSync } from "node:zlib";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { uploadR2Object } from "@/lib/r2";
import { resolveUiEventLogCategory } from "@/lib/ui-event-log-categories";

type SupabaseServerClient = ReturnType<typeof createServerSupabaseClient>;

type UiEventLogArchiveRow = {
  id: string;
  actor_user_id: string | null;
  actor_name: string | null;
  actor_email: string | null;
  actor_role: string | null;
  pathname: string;
  event_type: string;
  event_name: string;
  severity: string;
  entity_type: string | null;
  entity_id: string | null;
  request_id: string | null;
  message: string | null;
  metadata: Record<string, unknown>;
  created_at: string;
  archived_at?: string | null;
};

export const retentionPolicy = {
  archiveAfterDays: 7,
  deleteAfterDaysByCategory: {
    activity: 7,
    device: 7,
    errors: 30,
    auth: 90,
  },
} as const;

const ARCHIVE_BATCH_SIZE = 1000;
const ARCHIVE_MAX_ROWS_PER_RUN = 5000;
const DELETE_BATCH_SIZE = 200;
const ARCHIVE_SELECT =
  "id, actor_user_id, actor_name, actor_email, actor_role, pathname, event_type, event_name, severity, entity_type, entity_id, request_id, message, metadata, created_at, archived_at";

function subtractDays(date: Date, days: number): Date {
  return new Date(date.getTime() - days * 24 * 60 * 60 * 1000);
}

function toArchiveDateParts(date: Date) {
  const [year, month, day] = date.toISOString().slice(0, 10).split("-");
  return { year, month, day };
}

function buildArchiveKey(runId: string, cutoff: Date, part: number): string {
  const { year, month, day } = toArchiveDateParts(cutoff);
  return `archives/ui_event_logs/year=${year}/month=${month}/day=${day}/run=${runId}/part-${String(part).padStart(4, "0")}.jsonl.gz`;
}

function countByEventType(rows: UiEventLogArchiveRow[]) {
  return rows.reduce<Record<string, number>>((acc, row) => {
    const key = row.event_type || "unknown";
    acc[key] = (acc[key] ?? 0) + 1;
    return acc;
  }, {});
}

function countByCategory(rows: UiEventLogArchiveRow[]) {
  return rows.reduce<Record<string, number>>((acc, row) => {
    const key = resolveUiEventLogCategory(row.event_type, row.severity);
    acc[key] = (acc[key] ?? 0) + 1;
    return acc;
  }, {});
}

function shouldDeleteRow(row: Pick<UiEventLogArchiveRow, "event_type" | "severity" | "created_at">, now: Date): boolean {
  const category = resolveUiEventLogCategory(row.event_type, row.severity);
  const deleteAfterDays = retentionPolicy.deleteAfterDaysByCategory[category];
  const created = new Date(row.created_at);
  if (Number.isNaN(created.getTime())) return false;
  return created < subtractDays(now, deleteAfterDays);
}

async function updateRowsArchived(supabase: SupabaseServerClient, ids: string[], runId: string, archivedAt: string) {
  let updated = 0;
  for (let index = 0; index < ids.length; index += DELETE_BATCH_SIZE) {
    const chunk = ids.slice(index, index + DELETE_BATCH_SIZE);
    const { error } = await supabase
      .from("ui_event_logs")
      .update({ archived_at: archivedAt, archive_run_id: runId })
      .in("id", chunk);
    if (error) throw new Error(`Failed to mark archived rows: ${error.message}`);
    updated += chunk.length;
  }
  return updated;
}

async function deleteRows(supabase: SupabaseServerClient, ids: string[]) {
  let deleted = 0;
  for (let index = 0; index < ids.length; index += DELETE_BATCH_SIZE) {
    const chunk = ids.slice(index, index + DELETE_BATCH_SIZE);
    const { error } = await supabase.from("ui_event_logs").delete().in("id", chunk);
    if (error) throw new Error(`Failed to delete archived rows: ${error.message}`);
    deleted += chunk.length;
  }
  return deleted;
}

async function createArchiveRun(supabase: SupabaseServerClient, cutoff: string) {
  const { data, error } = await supabase
    .from("ui_event_log_archive_runs")
    .insert({
      status: "started",
      archive_cutoff_at: cutoff,
      retention_policy: retentionPolicy,
      started_at: new Date().toISOString(),
    })
    .select("id")
    .single();
  if (error || !data?.id) throw new Error(error?.message ?? "Failed to create archive run.");
  return String(data.id);
}

async function markArchiveRunSuccess(
  supabase: SupabaseServerClient,
  runId: string,
  payload: {
    rowCount: number;
    archivedCount: number;
    deletedCount: number;
    r2Keys: string[];
    sha256ByKey: Record<string, string>;
    eventCounts: Record<string, number>;
    categoryCounts: Record<string, number>;
  }
) {
  const { error } = await supabase
    .from("ui_event_log_archive_runs")
    .update({
      status: "succeeded",
      row_count: payload.rowCount,
      archived_count: payload.archivedCount,
      deleted_count: payload.deletedCount,
      r2_keys: payload.r2Keys,
      sha256_by_key: payload.sha256ByKey,
      event_counts: payload.eventCounts,
      category_counts: payload.categoryCounts,
      completed_at: new Date().toISOString(),
    })
    .eq("id", runId);
  if (error) throw new Error(`Failed to mark archive run success: ${error.message}`);
}

async function markArchiveRunFailed(supabase: SupabaseServerClient, runId: string, message: string) {
  await supabase
    .from("ui_event_log_archive_runs")
    .update({
      status: "failed",
      error_message: message,
      completed_at: new Date().toISOString(),
    })
    .eq("id", runId);
}

async function loadRowsForArchive(supabase: SupabaseServerClient, cutoff: string) {
  const rows: UiEventLogArchiveRow[] = [];
  for (let offset = 0; rows.length < ARCHIVE_MAX_ROWS_PER_RUN; offset += ARCHIVE_BATCH_SIZE) {
    const remaining = ARCHIVE_MAX_ROWS_PER_RUN - rows.length;
    const limit = Math.min(ARCHIVE_BATCH_SIZE, remaining);
    const { data, error } = await supabase
      .from("ui_event_logs")
      .select(ARCHIVE_SELECT)
      .is("archived_at", null)
      .lt("created_at", cutoff)
      .order("created_at", { ascending: true })
      .range(offset, offset + limit - 1);
    if (error) throw new Error(`Failed to load ui_event_logs for archive: ${error.message}`);
    const page = (data ?? []) as UiEventLogArchiveRow[];
    rows.push(...page);
    if (page.length < limit) break;
  }
  return rows;
}

async function loadArchivedRowsForDeletion(supabase: SupabaseServerClient, now: Date) {
  const { data, error } = await supabase
    .from("ui_event_logs")
    .select("id, event_type, severity, created_at, archived_at")
    .not("archived_at", "is", null)
    .lt("created_at", subtractDays(now, retentionPolicy.archiveAfterDays).toISOString())
    .limit(ARCHIVE_MAX_ROWS_PER_RUN);
  if (error) throw new Error(`Failed to load archived rows for deletion: ${error.message}`);
  return ((data ?? []) as UiEventLogArchiveRow[]).filter((row) => shouldDeleteRow(row, now)).map((row) => row.id);
}

export async function runUiEventLogArchive(
  supabase: SupabaseServerClient,
  options: { now?: Date; dryRun?: boolean } = {}
) {
  const now = options.now ?? new Date();
  const archiveCutoff = subtractDays(now, retentionPolicy.archiveAfterDays).toISOString();
  const rows = await loadRowsForArchive(supabase, archiveCutoff);
  const runId = options.dryRun ? "dry-run" : await createArchiveRun(supabase, archiveCutoff);
  const eventCounts = countByEventType(rows);
  const categoryCounts = countByCategory(rows);
  const deleteIdsFromNewArchive = rows.filter((row) => shouldDeleteRow(row, now)).map((row) => row.id);

  if (options.dryRun) {
    const previouslyArchivedDeleteIds = await loadArchivedRowsForDeletion(supabase, now);
    return {
      run_id: runId,
      dry_run: true,
      archive_cutoff_at: archiveCutoff,
      row_count: rows.length,
      archived_count: 0,
      deleted_count: new Set([...deleteIdsFromNewArchive, ...previouslyArchivedDeleteIds]).size,
      event_counts: eventCounts,
      category_counts: categoryCounts,
      r2_keys: [],
    };
  }

  try {
    if (rows.length === 0) {
      const previouslyArchivedDeleteIds = await loadArchivedRowsForDeletion(supabase, now);
      const deletedCount = await deleteRows(supabase, previouslyArchivedDeleteIds);
      await markArchiveRunSuccess(supabase, runId, {
        rowCount: 0,
        archivedCount: 0,
        deletedCount,
        r2Keys: [],
        sha256ByKey: {},
        eventCounts,
        categoryCounts,
      });
      return {
        run_id: runId,
        dry_run: false,
        archive_cutoff_at: archiveCutoff,
        row_count: 0,
        archived_count: 0,
        deleted_count: deletedCount,
        event_counts: eventCounts,
        category_counts: categoryCounts,
        r2_keys: [],
      };
    }

    const jsonl = rows.map((row) => JSON.stringify(row)).join("\n") + "\n";
    const compressed = gzipSync(Buffer.from(jsonl));
    const key = buildArchiveKey(runId, new Date(archiveCutoff), 1);
    const sha256 = createHash("sha256").update(compressed).digest("hex");

    await uploadR2Object({
      key,
      body: compressed,
      contentType: "application/x-ndjson",
      contentEncoding: "gzip",
    });

    const archivedAt = new Date().toISOString();
    const archivedCount = await updateRowsArchived(supabase, rows.map((row) => row.id), runId, archivedAt);
    const previouslyArchivedDeleteIds = await loadArchivedRowsForDeletion(supabase, now);
    const deletedCount = await deleteRows(
      supabase,
      Array.from(new Set([...deleteIdsFromNewArchive, ...previouslyArchivedDeleteIds]))
    );

    await markArchiveRunSuccess(supabase, runId, {
      rowCount: rows.length,
      archivedCount,
      deletedCount,
      r2Keys: [key],
      sha256ByKey: { [key]: sha256 },
      eventCounts,
      categoryCounts,
    });

    return {
      run_id: runId,
      dry_run: false,
      archive_cutoff_at: archiveCutoff,
      row_count: rows.length,
      archived_count: archivedCount,
      deleted_count: deletedCount,
      event_counts: eventCounts,
      category_counts: categoryCounts,
      r2_keys: [key],
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : "UI event log archive failed.";
    await markArchiveRunFailed(supabase, runId, message);
    throw error;
  }
}
