"use client";

import { BackupLog } from "@/lib/types";

interface BackupHistoryTableProps {
  logs: BackupLog[];
  loading?: boolean;
}

export function BackupHistoryTable({ logs, loading = false }: BackupHistoryTableProps) {
  const getCloudMode = (log: BackupLog) => {
    const fileName = log.file_name ?? "";
    if (fileName.startsWith("daily/incremental/")) return "Incremental";
    if (fileName.startsWith("daily/full/") || /^daily\/\d{4}-\d{2}-\d{2}_\d{4}\.json\.gz$/.test(fileName)) return "Full";
    return "Cloud";
  };

  const formatBytes = (bytes?: number | null) => {
    if (!bytes) return "—";
    const k = 1024;
    const sizes = ["B", "KB", "MB", "GB"];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + " " + sizes[i];
  };

  const formatDate = (dateStr: string) => {
    const date = new Date(dateStr);
    return date.toLocaleString("th-TH", {
      day: "2-digit",
      month: "short",
      hour: "2-digit",
      minute: "2-digit",
    });
  };

  const getDuration = (start: string, end?: string | null) => {
    if (!end) return "—";
    const duration = new Date(end).getTime() - new Date(start).getTime();
    return `${(duration / 1000).toFixed(1)}s`;
  };

  return (
    <div className="card overflow-hidden">
      <div className="border-b border-[var(--border-default)] bg-[var(--bg-muted)]/30 px-5 py-4">
        <h3 className="text-sm font-bold">Backup History (30 Days)</h3>
      </div>
      <div className="overflow-x-auto">
        <table className="data-table">
          <thead>
            <tr>
              <th>Date</th>
              <th>Type</th>
              <th>Status</th>
              <th>Size / Records</th>
              <th>Duration</th>
              <th>Note</th>
            </tr>
          </thead>
          <tbody>
            {loading && logs.length === 0 ? (
              <tr>
                <td colSpan={6} className="py-8 text-center text-[var(--text-muted)] italic">
                  Loading backup history...
                </td>
              </tr>
            ) : logs.length === 0 ? (
              <tr>
                <td colSpan={6} className="py-8 text-center text-[var(--text-muted)] italic">
                  No backup logs found in the last 30 days.
                </td>
              </tr>
            ) : (
              logs.map((log) => (
                <tr key={log.id}>
                  <td className="font-medium">{formatDate(log.created_at)}</td>
                  <td>
                    <span
                      className={`rounded px-2 py-0.5 text-[10px] font-bold uppercase ${
                        log.backup_type === "daily_cloud"
                          ? "bg-blue-100 text-blue-600 dark:bg-blue-900/30 dark:text-blue-400"
                          : "bg-emerald-100 text-emerald-600 dark:bg-emerald-900/30 dark:text-emerald-400"
                      }`}
                    >
                      {log.backup_type === "daily_cloud" ? getCloudMode(log) : "Sync"}
                    </span>
                  </td>
                  <td>
                    <div className="flex items-center gap-1.5">
                      <div
                        className={`h-2 w-2 rounded-full ${
                          log.status === "success"
                            ? "bg-emerald-500"
                            : log.status === "failed"
                              ? "bg-rose-500"
                              : "animate-pulse bg-slate-400"
                        }`}
                      />
                      <span className="capitalize">{log.status}</span>
                    </div>
                  </td>
                  <td>{log.backup_type === "daily_cloud" ? formatBytes(log.file_size_bytes) : `${log.record_count || 0} rec`}</td>
                  <td>{getDuration(log.started_at, log.completed_at)}</td>
                  <td className="max-w-[240px] truncate text-xs text-[var(--text-muted)]" title={log.error_message || ""}>
                    {log.error_message || "—"}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
