"use client";

import { useEffect, useMemo, useState } from "react";
import { BackupLog } from "@/lib/types";
import { BackupStatusCards } from "@/components/backup/backup-status-cards";
import { BackupHistoryTable } from "@/components/backup/backup-history-table";
import { OfflinePinSetup } from "@/components/backup/offline-pin-setup";

type BackupStatusResponse = {
  config: {
    retention_days: number;
    r2_bucket: string;
    updated_at: string;
    has_pin: boolean;
  };
  pin_hash: string | null;
  latest_cloud_backup: BackupLog | null;
  latest_offline_sync: BackupLog | null;
  history: BackupLog[];
  storage: {
    bucket: string;
    file_count: number;
    total_bytes: number;
    oldest_file_key: string | null;
    oldest_file_date: string | null;
  };
};

const PIN_HASH_CACHE_KEY = "pms_offline_pin_hash";

async function readJson<T>(response: Response): Promise<T> {
  const json = await response.json().catch(() => null);
  if (!response.ok || !json?.success) {
    throw new Error(String(json?.error ?? "Request failed."));
  }
  return json.data as T;
}

export default function BackupStatusPage() {
  const [status, setStatus] = useState<BackupStatusResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [triggeringAction, setTriggeringAction] = useState<"daily_cloud" | "offline_snapshot" | null>(null);
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

  const handleTriggerBackup = async (action: "daily_cloud" | "offline_snapshot") => {
    setPageError(null);
    setNotice(null);
    setTriggeringAction(action);
    try {
      await readJson(
        await fetch("/api/backup/trigger", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ action }),
        })
      );
      await refreshStatus();
      setNotice(action === "daily_cloud" ? "Cloud backup triggered." : "Offline snapshot sync triggered.");
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
            onClick={() => handleTriggerBackup("daily_cloud")}
            disabled={triggeringAction !== null}
            className="btn-secondary"
          >
            {triggeringAction === "daily_cloud" ? "Processing..." : "Backup Now"}
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
