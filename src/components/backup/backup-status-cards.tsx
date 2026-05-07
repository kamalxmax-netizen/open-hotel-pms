"use client";

import { BackupLog } from "@/lib/types";

interface BackupStatusCardsProps {
  lastCloud?: BackupLog;
  lastSync?: BackupLog;
  storageInfo?: {
    usedBytes: number;
    count: number;
  };
}

export function BackupStatusCards({ lastCloud, lastSync, storageInfo }: BackupStatusCardsProps) {
  const getCloudMode = (log?: BackupLog) => {
    const fileName = log?.file_name ?? "";
    if (fileName.startsWith("daily/incremental/")) return "Incremental";
    if (fileName.startsWith("daily/full/") || /^daily\/\d{4}-\d{2}-\d{2}_\d{4}\.json\.gz$/.test(fileName)) return "Full";
    return "Cloud";
  };

  const formatBytes = (bytes?: number) => {
    if (!bytes) return "0 B";
    const k = 1024;
    const sizes = ["B", "KB", "MB", "GB"];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + " " + sizes[i];
  };

  const formatDate = (dateStr?: string) => {
    if (!dateStr) return "Never";
    const date = new Date(dateStr);
    return date.toLocaleString("th-TH", {
      day: "2-digit",
      month: "short",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  };

  return (
    <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
      {/* Cloud Backup Card */}
      <div className="stat-card">
        <div className="flex items-center gap-3 mb-2">
          <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-blue-100 dark:bg-blue-900/30 text-blue-600 dark:text-blue-400">
            <CloudIcon />
          </div>
          <div>
            <p className="text-xs font-semibold text-[var(--text-muted)] uppercase tracking-wider">Last Cloud Backup</p>
            <p className="text-sm font-bold text-[var(--text-primary)]">{formatDate(lastCloud?.completed_at || lastCloud?.started_at)}</p>
          </div>
        </div>
        <div className="flex items-center gap-2 mt-auto">
          {lastCloud?.status === 'success' ? (
            <span className="badge status-available">✅ {getCloudMode(lastCloud)} · {formatBytes(lastCloud.file_size_bytes || 0)}</span>
          ) : lastCloud?.status === 'failed' ? (
            <span className="badge status-dirty">❌ Failed</span>
          ) : (
            <span className="badge status-closed">No Data</span>
          )}
        </div>
      </div>

      {/* Offline Sync Card */}
      <div className="stat-card">
        <div className="flex items-center gap-3 mb-2">
          <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-emerald-100 dark:bg-emerald-900/30 text-emerald-600 dark:text-emerald-400">
            <SyncIcon />
          </div>
          <div>
            <p className="text-xs font-semibold text-[var(--text-muted)] uppercase tracking-wider">Last Offline Sync</p>
            <p className="text-sm font-bold text-[var(--text-primary)]">{formatDate(lastSync?.completed_at || lastSync?.started_at)}</p>
          </div>
        </div>
        <div className="flex items-center gap-2 mt-auto">
          {lastSync?.status === 'success' ? (
            <span className="badge status-available">✅ {lastSync.record_count || 0} records</span>
          ) : lastSync?.status === 'failed' ? (
            <span className="badge status-dirty">❌ Failed</span>
          ) : (
            <span className="badge status-closed">No Data</span>
          )}
        </div>
      </div>

      {/* Storage Card */}
      <div className="stat-card">
        <div className="flex items-center gap-3 mb-2">
          <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-indigo-100 dark:bg-indigo-900/30 text-indigo-600 dark:text-indigo-400">
            <StorageIcon />
          </div>
          <div>
            <p className="text-xs font-semibold text-[var(--text-muted)] uppercase tracking-wider">R2 Storage Used</p>
            <p className="text-sm font-bold text-[var(--text-primary)]">{formatBytes(storageInfo?.usedBytes)} / 10 GB</p>
          </div>
        </div>
        <div className="mt-auto">
          <div className="w-full h-1.5 bg-[var(--bg-muted)] rounded-full overflow-hidden mb-1">
            <div 
              className="h-full bg-indigo-500" 
              style={{ width: `${Math.min(((storageInfo?.usedBytes || 0) / (10 * 1024 * 1024 * 1024)) * 100, 100)}%` }}
            />
          </div>
          <p className="text-[10px] text-[var(--text-muted)]">{storageInfo?.count || 0} backup files total</p>
        </div>
      </div>
    </div>
  );
}

function CloudIcon() {
  return (
    <svg viewBox="0 0 20 20" fill="currentColor" className="w-5 h-5">
      <path d="M5.5 16a3.5 3.5 0 01-.369-6.98 4 4 0 117.739-1.977A4.5 4.5 0 1113.5 16h-8z" />
    </svg>
  );
}

function SyncIcon() {
  return (
    <svg viewBox="0 0 20 20" fill="currentColor" className="w-5 h-5">
      <path fillRule="evenodd" d="M15.312 11.426a5 5 0 01-9.191 1.056 1 1 0 10-1.611 1.18 7 7 0 0012.868-1.478l1.415.354a1 1 0 10.485-1.94l-3.964-.991a1 1 0 00-1.212.756l-.991 3.964a1 1 0 001.94.485l.356-1.426zm-10.624-2.852a5 5 0 019.191-1.056 1 1 0 001.611-1.18 7 7 0 00-12.868 1.478l-1.415-.354a1 1 0 10-.485 1.94l3.964.991a1 1 0 001.212-.756l.991-3.964a1 1 0 00-1.94-.485l-.356 1.426z" clipRule="evenodd" />
    </svg>
  );
}

function StorageIcon() {
  return (
    <svg viewBox="0 0 20 20" fill="currentColor" className="w-5 h-5">
      <path d="M7 3a1 1 0 000 2h6a1 1 0 100-2H7zM4 7a1 1 0 011-1h10a1 1 0 110 2H5a1 1 0 01-1-1zM2 11a2 2 0 012-2h12a2 2 0 012 2v4a2 2 0 01-2 2H4a2 2 0 01-2-2v-4z" />
    </svg>
  );
}
