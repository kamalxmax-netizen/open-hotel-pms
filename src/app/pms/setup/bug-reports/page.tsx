"use client";

import { useEffect, useState, useCallback } from "react";

type BugReport = {
  id: string;
  reporter_email: string | null;
  page_url: string;
  description: string;
  screenshot_url: string | null;
  browser_info: any;
  status: string;
  created_at: string;
};

const STATUS_LABELS: Record<string, { label: string; color: string }> = {
  open:        { label: "Open",        color: "bg-rose-100 text-rose-700 dark:bg-rose-500/10 dark:text-rose-400" },
  in_progress: { label: "In Progress", color: "bg-amber-100 text-amber-700 dark:bg-amber-500/10 dark:text-amber-400" },
  resolved:    { label: "Resolved",    color: "bg-emerald-100 text-emerald-700 dark:bg-emerald-500/10 dark:text-emerald-400" },
  wontfix:     { label: "Won't Fix",   color: "bg-[var(--bg-surface-hover)] text-[var(--text-muted)]" },
};

export default function BugReportsPage() {
  const [reports, setReports] = useState<BugReport[]>([]);
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState<BugReport | null>(null);
  const [filter, setFilter] = useState("open");

  const load = useCallback(async () => {
    setLoading(true);
    const url = filter === "all" ? "/api/bug-reports" : `/api/bug-reports?status=${filter}`;
    const res = await fetch(url);
    const data = await res.json();
    if (data.success) setReports(data.reports);
    setLoading(false);
  }, [filter]);

  useEffect(() => { load(); }, [load]);

  async function updateStatus(id: string, status: string) {
    await fetch("/api/bug-reports", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id, status }),
    });
    setReports((prev) => prev.map((r) => r.id === id ? { ...r, status } : r));
    if (selected?.id === id) setSelected((s) => s ? { ...s, status } : s);
  }

  return (
    <div className="p-6 max-w-6xl mx-auto">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-xl font-bold text-[var(--text-primary)]">Bug Reports</h1>
          <p className="text-sm text-[var(--text-secondary)] mt-1">รายงานปัญหาจากพนักงาน</p>
        </div>
        <div className="flex gap-1.5">
          {["open", "in_progress", "resolved", "wontfix", "all"].map((s) => (
            <button
              key={s}
              onClick={() => setFilter(s)}
              className={`px-3 py-1.5 text-xs font-medium rounded-lg transition-colors ${
                filter === s
                  ? "bg-indigo-600 text-white"
                  : "bg-[var(--bg-surface-hover)] text-[var(--text-secondary)] hover:bg-[var(--bg-muted)]"
              }`}
            >
              {s === "all" ? "All" : STATUS_LABELS[s]?.label ?? s}
            </button>
          ))}
        </div>
      </div>

      {loading ? (
        <div className="text-sm text-[var(--text-muted)]">กำลังโหลด...</div>
      ) : reports.length === 0 ? (
        <div className="text-center py-16 text-[var(--text-muted)]">
          <p className="text-3xl mb-3">🎉</p>
          <p className="text-sm">ไม่มี bug reports ใน status นี้</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {/* List */}
          <div className="space-y-2">
            {reports.map((report) => {
              const meta = STATUS_LABELS[report.status] ?? { label: report.status, color: "bg-[var(--bg-surface-hover)] text-[var(--text-muted)]" };
              const isSelected = selected?.id === report.id;
              return (
                <button
                  key={report.id}
                  onClick={() => setSelected(report)}
                  className={`w-full text-left p-3.5 rounded-xl border transition-all ${
                    isSelected
                      ? "border-indigo-400 bg-indigo-50 ring-1 ring-indigo-400 dark:bg-indigo-500/10 dark:border-indigo-500/30 dark:ring-indigo-500/20"
                      : "border-[var(--border-default)] bg-[var(--bg-surface)] hover:border-[var(--border-input)] hover:bg-[var(--bg-surface-hover)]"
                  }`}
                >
                  <div className="flex items-start justify-between gap-2">
                    <p className="text-sm text-[var(--text-primary)] line-clamp-2">{report.description}</p>
                    <span className={`shrink-0 text-[10px] px-1.5 py-0.5 rounded font-medium ${meta.color}`}>
                      {meta.label}
                    </span>
                  </div>
                  <div className="flex items-center gap-3 mt-1.5">
                    <span className="text-[10px] text-[var(--text-muted)] font-mono truncate">
                      {report.page_url.replace(/^https?:\/\/[^/]+/, "")}
                    </span>
                    <span className="text-[10px] text-[var(--text-muted)]">•</span>
                    <span className="text-[10px] text-[var(--text-muted)]">
                      {new Date(report.created_at).toLocaleDateString("th-TH", {
                        day: "numeric", month: "short", hour: "2-digit", minute: "2-digit"
                      })}
                    </span>
                  </div>
                </button>
              );
            })}
          </div>

          {/* Detail */}
          {selected && (
            <div className="bg-[var(--bg-surface)] border border-[var(--border-default)] rounded-xl p-5 space-y-4">
              <div className="flex items-start justify-between gap-3">
                <h3 className="text-sm font-semibold text-[var(--text-primary)]">รายละเอียด</h3>
                <span className={`text-[10px] px-2 py-0.5 rounded font-medium ${STATUS_LABELS[selected.status]?.color ?? "bg-[var(--bg-surface-hover)] text-[var(--text-muted)]"}`}>
                  {STATUS_LABELS[selected.status]?.label ?? selected.status}
                </span>
              </div>

              <div className="text-sm text-[var(--text-table-cell)] bg-[var(--bg-body)] rounded-lg p-3 leading-relaxed">
                {selected.description}
              </div>

              {selected.screenshot_url && (
                <a href={selected.screenshot_url} target="_blank" rel="noopener noreferrer" className="block">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={selected.screenshot_url}
                    alt="Bug screenshot"
                    className="w-full rounded-lg border border-[var(--border-default)] hover:opacity-90 transition"
                  />
                </a>
              )}

              <div className="text-xs text-[var(--text-secondary)] space-y-1">
                <p><span className="font-medium">หน้า:</span> <span className="font-mono">{selected.page_url.replace(/^https?:\/\/[^/]+/, "")}</span></p>
                {selected.reporter_email && <p><span className="font-medium">รายงานโดย:</span> {selected.reporter_email}</p>}
                <p><span className="font-medium">เวลา:</span> {new Date(selected.created_at).toLocaleString("th-TH")}</p>
                {selected.browser_info?.userAgent && (
                  <p className="font-mono text-[10px] text-[var(--text-muted)] truncate">{selected.browser_info.userAgent}</p>
                )}
              </div>

              {/* Status actions */}
              <div className="flex flex-wrap gap-2 pt-1 border-t border-[var(--border-subtle)]">
                {Object.entries(STATUS_LABELS).map(([s, meta]) => (
                  <button
                    key={s}
                    onClick={() => updateStatus(selected.id, s)}
                    disabled={selected.status === s}
                    className={`text-xs px-2.5 py-1.5 rounded-lg font-medium transition-colors disabled:opacity-40 ${
                      selected.status === s
                        ? `${meta.color} cursor-default`
                        : "bg-[var(--bg-surface-hover)] text-[var(--text-secondary)] hover:bg-[var(--bg-muted)]"
                    }`}
                  >
                    → {meta.label}
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
