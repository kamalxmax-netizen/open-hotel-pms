"use client";

import { useEffect, useMemo, useState } from "react";
import { BackupLog } from "@/lib/types";
import { BackupStatusCards } from "@/components/backup/backup-status-cards";
import { BackupHistoryTable } from "@/components/backup/backup-history-table";
import { DevicePairingTokenCard } from "@/components/backup/device-pairing-token-card";
import { OfflinePinSetup } from "@/components/backup/offline-pin-setup";

type BackupStatusResponse = {
  config: {
    retention_days: number;
    r2_bucket: string;
    updated_at: string;
    has_pin: boolean;
    device_pairing_required: boolean;
  };
  pin_hash: string | null;
  latest_cloud_backup: BackupLog | null;
  latest_offline_sync: BackupLog | null;
  history: BackupLog[];
  activity_log_archives: Array<{
    id: string;
    status: "started" | "succeeded" | "failed";
    archive_cutoff_at: string;
    archived_count: number;
    deleted_count: number;
    r2_keys: string[];
    error_message: string | null;
    started_at: string;
    completed_at: string | null;
  }>;
  storage: {
    bucket: string;
    file_count: number;
    total_bytes: number;
    oldest_file_key: string | null;
    oldest_file_date: string | null;
  };
};

type BackupTriggerAction = "daily_cloud" | "daily_cloud_full" | "offline_snapshot";
type CloudBackupMode = "auto" | "full" | "incremental";

const PIN_HASH_CACHE_KEY = "pms_offline_pin_hash";

async function readJson<T>(response: Response): Promise<T> {
  const json = await response.json().catch(() => null);
  if (!response.ok || !json?.success) {
    throw new Error(String(json?.error ?? "Request failed."));
  }
  return json.data as T;
}

function formatBackupDate(value: string | null | undefined): string {
  if (!value) return "Never";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString("th-TH", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export default function BackupStatusPage() {
  const [status, setStatus] = useState<BackupStatusResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [triggeringAction, setTriggeringAction] = useState<BackupTriggerAction | null>(null);
  const [pageError, setPageError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const refreshStatus = async () => {
    setPageError(null);
    const data = await readJson<BackupStatusResponse>(await fetch("/api/backup/status", { cache: "no-store" }));
    setStatus(data);
    if (typeof window !== "undefined" && data.pin_hash) {
      window.localStorage.setItem(PIN_HASH_CACHE_KEY, data.pin_hash);
    }
  };

  useEffect(() => {
    let cancelled = false;

    (async () => {
      try {
        setLoading(true);
        const data = await readJson<BackupStatusResponse>(await fetch("/api/backup/status", { cache: "no-store" }));
        if (cancelled) return;
        setStatus(data);
        if (typeof window !== "undefined" && data.pin_hash) {
          window.localStorage.setItem(PIN_HASH_CACHE_KEY, data.pin_hash);
        }
      } catch (error) {
        if (cancelled) return;
        setPageError(error instanceof Error ? error.message : "Failed to load backup status.");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, []);

  const history = status?.history ?? [];
  const activityLogArchives = status?.activity_log_archives ?? [];
  const lastCloud = status?.latest_cloud_backup ?? null;
  const lastSync = status?.latest_offline_sync ?? null;
  const retentionDays = status?.config.retention_days ?? 60;
  const bucketName = status?.config.r2_bucket ?? "pms-backups";

  const retentionText = useMemo(() => {
    if (!status?.storage.oldest_file_date) {
      return `Backups are kept for ${retentionDays} days in \`${bucketName}\`. No backup files are stored yet.`;
    }
    return `Backups are kept for ${retentionDays} days in \`${bucketName}\`. Oldest available backup: ${status.storage.oldest_file_date}.`;
  }, [bucketName, retentionDays, status?.storage.oldest_file_date]);

  const handleUpdatePin = async (rawPin: string) => {
    const response = await fetch("/api/backup/config", {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ offline_pin: rawPin }),
    });
    const data = await readJson<{ pin_hash: string | null }>(response);
    if (typeof window !== "undefined" && data.pin_hash) {
      window.localStorage.setItem(PIN_HASH_CACHE_KEY, data.pin_hash);
    }
    await refreshStatus();
    setNotice("Offline PIN updated.");
  };

  const handleGeneratePairingToken = async (input: {
    device_name?: string;
    expires_in_minutes?: number;
  }) => {
    const response = await fetch("/api/backup/device-token", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(input),
    });
    const data = await readJson<{
      pairing_token: string;
      device_name: string;
      expires_at: string;
    }>(response);
    setNotice(`Pairing token generated for ${data.device_name}.`);
    return data;
  };

  const handleTriggerBackup = async (
    action: "daily_cloud" | "offline_snapshot",
    options: { mode?: CloudBackupMode; triggerKey?: BackupTriggerAction } = {}
  ) => {
    setPageError(null);
    setNotice(null);
    const triggerKey = options.triggerKey ?? action;
    setTriggeringAction(triggerKey);
    try {
      const data = await readJson<{ backup_mode?: "full" | "incremental" }>(
        await fetch("/api/backup/trigger", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ action, mode: options.mode }),
        })
      );
      await refreshStatus();
      if (action === "daily_cloud") {
        const modeLabel = data.backup_mode === "full" ? "Full cloud backup" : "Incremental cloud backup";
        setNotice(`${modeLabel} triggered.`);
      } else {
        setNotice("Offline snapshot sync triggered.");
      }
    } catch (error) {
      setPageError(error instanceof Error ? error.message : "Trigger failed.");
    } finally {
      setTriggeringAction(null);
    }
  };

  return (
    <div className="page-body space-y-8">
      <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Backup & Disaster Recovery</h1>
          <p className="text-[var(--text-secondary)]">
            Manage cloud backups, offline snapshots, retention settings, and emergency access.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => handleTriggerBackup("daily_cloud", { mode: "auto" })}
            disabled={triggeringAction !== null}
            className="btn-secondary"
          >
            {triggeringAction === "daily_cloud" ? "Processing..." : "Backup Now"}
          </button>
          <button
            onClick={() => handleTriggerBackup("daily_cloud", { mode: "full", triggerKey: "daily_cloud_full" })}
            disabled={triggeringAction !== null}
            className="btn-secondary"
            title="Full backup uses more Supabase egress. Use before risky changes or after schema changes."
          >
            {triggeringAction === "daily_cloud_full" ? "Processing..." : "Full Backup"}
          </button>
          <button
            onClick={() => handleTriggerBackup("offline_snapshot")}
            disabled={triggeringAction !== null}
            className="btn-primary"
          >
            {triggeringAction === "offline_snapshot" ? "Processing..." : "Sync Offline Now"}
          </button>
        </div>
      </div>
      <p className="text-xs text-[var(--text-muted)]">
        Backup Now runs auto mode: weekly full backup, otherwise incremental to reduce Supabase PostgREST egress. Full Backup exports every table and should be used only when needed.
      </p>

      {pageError ? (
        <div className="rounded-2xl border border-rose-200 bg-rose-50 px-5 py-4 text-sm text-rose-700 dark:border-rose-900/30 dark:bg-rose-950/20 dark:text-rose-300">
          {pageError}
        </div>
      ) : null}

      {notice ? (
        <div className="rounded-2xl border border-emerald-200 bg-emerald-50 px-5 py-4 text-sm text-emerald-700 dark:border-emerald-900/30 dark:bg-emerald-950/20 dark:text-emerald-300">
          {notice}
        </div>
      ) : null}

      <BackupStatusCards
        lastCloud={lastCloud ?? undefined}
        lastSync={lastSync ?? undefined}
        storageInfo={{
          usedBytes: status?.storage.total_bytes ?? 0,
          count: status?.storage.file_count ?? 0,
        }}
      />

      <div className="grid grid-cols-1 gap-8 lg:grid-cols-3">
        <div className="space-y-6 lg:col-span-2">
          <BackupHistoryTable logs={history} loading={loading} />

          <div className="card p-6">
            <div className="mb-4 flex items-start justify-between gap-3">
              <div>
                <h3 className="text-base font-bold text-[var(--text-primary)]">Activity Log Archive</h3>
                <p className="mt-1 text-sm text-[var(--text-secondary)]">
                  R2 archive runs for Activity Logs. Scheduler is owned by Supabase Cron.
                </p>
              </div>
              <a href="/pms/admin/debug-logs" className="btn-secondary text-xs">Open Activity Logs</a>
            </div>
            {loading ? (
              <p className="text-sm text-[var(--text-muted)]">Loading archive runs...</p>
            ) : activityLogArchives.length === 0 ? (
              <p className="text-sm text-[var(--text-muted)]">No Activity Log archive runs yet.</p>
            ) : (
              <div className="overflow-x-auto">
                <table className="min-w-full text-sm">
                  <thead>
                    <tr className="border-b border-[var(--border-default)]">
                      <th className="px-3 py-2 text-left">Run</th>
                      <th className="px-3 py-2 text-left">Status</th>
                      <th className="px-3 py-2 text-right">Archived</th>
                      <th className="px-3 py-2 text-right">Deleted</th>
                      <th className="px-3 py-2 text-left">R2 Object</th>
                    </tr>
                  </thead>
                  <tbody>
                    {activityLogArchives.map((run) => (
                      <tr key={run.id} className="border-b border-[var(--border-subtle)] align-top">
                        <td className="px-3 py-3">
                          <p className="font-medium text-[var(--text-primary)]">{formatBackupDate(run.completed_at || run.started_at)}</p>
                          <p className="text-xs text-[var(--text-muted)]">Cutoff {formatBackupDate(run.archive_cutoff_at)}</p>
                        </td>
                        <td className="px-3 py-3">
                          <span className={`badge ${run.status === "succeeded" ? "status-available" : run.status === "failed" ? "status-dirty" : "status-closed"}`}>
                            {run.status}
                          </span>
                          {run.error_message ? <p className="mt-1 text-xs text-rose-600">{run.error_message}</p> : null}
                        </td>
                        <td className="px-3 py-3 text-right">{run.archived_count}</td>
                        <td className="px-3 py-3 text-right">{run.deleted_count}</td>
                        <td className="px-3 py-3">
                          <p className="max-w-md break-all font-mono text-xs text-[var(--text-secondary)]">
                            {run.r2_keys[0] ?? "No object written"}
                          </p>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>

          <div className="rounded-2xl border border-blue-200 bg-blue-50 p-6 dark:border-blue-900/30 dark:bg-blue-950/20">
            <h4 className="mb-2 font-bold text-blue-800 dark:text-blue-300">Retention Policy</h4>
            <p className="text-sm text-blue-700 dark:text-blue-200">{retentionText}</p>
          </div>
        </div>

        <div className="space-y-8">
          <OfflinePinSetup
            currentPinSet={Boolean(status?.config.has_pin)}
            onUpdate={handleUpdatePin}
            viewerUrl="/offline"
          />

          <DevicePairingTokenCard onGenerate={handleGeneratePairingToken} />

          <div className="card border-rose-200 bg-rose-50/30 p-5 dark:border-rose-900/30 dark:bg-rose-950/10">
            <h4 className="mb-2 text-sm font-bold text-rose-800 dark:text-rose-300">Emergency Recovery</h4>
            <p className="mb-4 text-xs text-rose-700 dark:text-rose-200">
              Cloud backups are exported as compressed JSON and stored in R2. Use the archive strategy document for
              restore planning and disaster-recovery procedures.
            </p>
            <div className="rounded-xl border border-rose-200 bg-white/60 px-3 py-2 text-center text-xs text-rose-700 dark:border-rose-900/30 dark:bg-black/10 dark:text-rose-200">
              Archive strategy document is stored in the repo root as <strong>ARCHIVE_STRATEGY.md</strong>.
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
