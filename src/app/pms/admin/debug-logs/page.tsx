"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { createBrowserSupabaseClient } from "@/lib/supabase/client";
import {
  isUiEventLogManualCaptureEnabled,
  setUiEventLogManualCaptureEnabled,
} from "@/lib/ui-event-log-client";

type DebugLogRow = {
  id: string;
  actor_name: string | null;
  actor_email: string | null;
  actor_role: string | null;
  pathname: string;
  event_type: string;
  event_name: string;
  severity: "info" | "warning" | "error";
  message: string | null;
  metadata: Record<string, unknown> | null;
  created_at: string;
};

type Pagination = {
  page: number;
  per_page: number;
  total: number;
  total_pages: number;
};

const DEFAULT_PAGINATION: Pagination = {
  page: 1,
  per_page: 50,
  total: 0,
  total_pages: 1,
};

const EVENT_TYPE_OPTIONS = [
  { value: "all", label: "All types" },
  { value: "page_view", label: "Page view" },
  { value: "click", label: "Click" },
  { value: "submit", label: "Submit" },
  { value: "client_error", label: "Client error" },
];

const SEVERITY_OPTIONS = [
  { value: "all", label: "All severities" },
  { value: "info", label: "Info" },
  { value: "warning", label: "Warning" },
  { value: "error", label: "Error" },
];

function toBangkokDateString(date = new Date()): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Bangkok",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);
  const year = parts.find((part) => part.type === "year")?.value;
  const month = parts.find((part) => part.type === "month")?.value;
  const day = parts.find((part) => part.type === "day")?.value;
  return year && month && day ? `${year}-${month}-${day}` : new Date().toISOString().slice(0, 10);
}

function formatDateTime(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  return new Intl.DateTimeFormat("en-GB", {
    timeZone: "Asia/Bangkok",
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(date);
}

function formatMetadata(metadata: Record<string, unknown> | null): string {
  if (!metadata || Object.keys(metadata).length === 0) return "—";
  try {
    return JSON.stringify(metadata, null, 2);
  } catch {
    return "Invalid metadata";
  }
}

function severityBadge(severity: string): string {
  if (severity === "error") return "bg-rose-100 text-rose-700 border border-rose-200 dark:bg-rose-950/30 dark:text-rose-200 dark:border-rose-800/50";
  if (severity === "warning") return "bg-amber-100 text-amber-700 border border-amber-200 dark:bg-amber-950/30 dark:text-amber-200 dark:border-amber-800/50";
  return "bg-slate-100 text-slate-700 border border-slate-200 dark:bg-slate-800/50 dark:text-slate-200 dark:border-slate-700/50";
}

export default function AdminDebugLogsPage() {
  const router = useRouter();
  const [roleLoading, setRoleLoading] = useState(true);
  const [isAdmin, setIsAdmin] = useState(false);

  const [rows, setRows] = useState<DebugLogRow[]>([]);
  const [pagination, setPagination] = useState<Pagination>(DEFAULT_PAGINATION);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [captureEmails, setCaptureEmails] = useState("ops@example.com");
  const [savingCaptureEmails, setSavingCaptureEmails] = useState(false);
  const [manualCaptureEnabled, setManualCaptureEnabled] = useState(false);

  const [dateFrom, setDateFrom] = useState(() => toBangkokDateString());
  const [dateTo, setDateTo] = useState(() => toBangkokDateString());
  const [eventType, setEventType] = useState("all");
  const [severity, setSeverity] = useState("all");
  const [pathnameFilter, setPathnameFilter] = useState("");
  const [search, setSearch] = useState("");

  useEffect(() => {
    let cancelled = false;
    const boot = async () => {
      try {
        const supabase = createBrowserSupabaseClient();
        const { data: authData } = await supabase.auth.getUser();
        const authUserId = authData?.user?.id;
        if (!authUserId) {
          router.push("/login");
          return;
        }
        const { data: profileData } = await supabase
          .from("profiles")
          .select("role")
          .eq("user_id", authUserId)
          .maybeSingle();
        if (cancelled) return;
        const role = String(profileData?.role ?? "").trim().toLowerCase();
        if (role !== "admin") {
          router.push("/pms");
          return;
        }
        setIsAdmin(true);
      } catch {
        router.push("/login");
      } finally {
        if (!cancelled) setRoleLoading(false);
      }
    };

    void boot();
    return () => {
      cancelled = true;
    };
  }, [router]);

  useEffect(() => {
    setManualCaptureEnabled(isUiEventLogManualCaptureEnabled());
  }, []);

  const queryString = useMemo(() => {
    const params = new URLSearchParams();
    params.set("date_from", dateFrom);
    params.set("date_to", dateTo);
    params.set("page", String(pagination.page));
    params.set("per_page", String(pagination.per_page));
    if (eventType !== "all") params.set("event_type", eventType);
    if (severity !== "all") params.set("severity", severity);
    if (pathnameFilter.trim()) params.set("pathname", pathnameFilter.trim());
    if (search.trim()) params.set("search", search.trim());
    return params.toString();
  }, [dateFrom, dateTo, eventType, severity, pathnameFilter, search, pagination.page, pagination.per_page]);

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const res = await fetch(`/api/admin/ui-event-logs?${queryString}`, {
        cache: "no-store",
        credentials: "include",
      });
      const data = await res.json();
      if (!res.ok || !data.success) {
        throw new Error(data.error || "Failed to load debug logs.");
      }
      setRows(Array.isArray(data.rows) ? data.rows : []);
      setCaptureEmails(String(data.settings?.capture_emails ?? "ops@example.com"));
      setPagination((prev) => data.pagination ? data.pagination : prev);
    } catch (err) {
      setRows([]);
      setError(err instanceof Error ? err.message : "Failed to load debug logs.");
    } finally {
      setLoading(false);
    }
  }, [queryString]);

  useEffect(() => {
    if (roleLoading || !isAdmin) return;
    void load();
  }, [isAdmin, roleLoading, load]);

  function resetToFirstPage() {
    setPagination((prev) => ({ ...prev, page: 1 }));
  }

  async function handleDeleteOne(id: string) {
    if (!confirm("Delete this debug log permanently?")) return;
    setBusy(true);
    setError("");
    setMessage("");
    try {
      const res = await fetch("/api/admin/ui-event-logs", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ids: [id] }),
      });
      const data = await res.json();
      if (!res.ok || !data.success) {
        throw new Error(data.error || "Failed to delete log.");
      }
      setMessage("Debug log deleted permanently.");
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to delete log.");
    } finally {
      setBusy(false);
    }
  }

  async function handleDeleteFiltered() {
    const total = pagination.total;
    if (total <= 0) return;
    if (!confirm(`Delete ${total} filtered debug log(s) permanently?`)) return;
    setBusy(true);
    setError("");
    setMessage("");
    try {
      const res = await fetch("/api/admin/ui-event-logs", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          delete_filtered: true,
          date_from: dateFrom,
          date_to: dateTo,
          event_type: eventType,
          severity,
          pathname: pathnameFilter.trim(),
          search: search.trim(),
        }),
      });
      const data = await res.json();
      if (!res.ok || !data.success) {
        throw new Error(data.error || "Failed to delete filtered logs.");
      }
      setMessage(`Deleted ${Number(data.deleted_count ?? 0)} debug log(s) permanently.`);
      setPagination((prev) => ({ ...prev, page: 1 }));
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to delete filtered logs.");
    } finally {
      setBusy(false);
    }
  }

  async function handleSaveCaptureEmails() {
    setSavingCaptureEmails(true);
    setError("");
    setMessage("");
    try {
      const res = await fetch("/api/admin/ui-event-logs", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ capture_emails: captureEmails }),
      });
      const data = await res.json();
      if (!res.ok || !data.success) {
        throw new Error(data.error || "Failed to save capture emails.");
      }
      setCaptureEmails(String(data.settings?.capture_emails ?? captureEmails));
      setMessage("Capture email list updated.");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save capture emails.");
    } finally {
      setSavingCaptureEmails(false);
    }
  }

  function handleManualCaptureToggle() {
    const next = !manualCaptureEnabled;
    setUiEventLogManualCaptureEnabled(next);
    setManualCaptureEnabled(next);
    setMessage(next ? "Manual debug capture enabled for this browser." : "Manual debug capture disabled for this browser.");
    setError("");
  }

  if (roleLoading || (isAdmin !== true && loading)) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="btn-spinner" />
      </div>
    );
  }

  if (isAdmin !== true) return null;

  return (
    <div className="flex flex-col gap-5 max-w-7xl mx-auto pb-10">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <p className="text-xs font-semibold uppercase tracking-widest text-slate-500">Admin</p>
          <h1 className="text-2xl font-bold text-[var(--text-primary)] mt-0.5">Debug Logs</h1>
          <p className="text-sm text-[var(--text-muted)] mt-0.5">
            Runtime breadcrumbs for page views, clicks, submits, and client errors. This is separate from Audit Explorer.
          </p>
        </div>
        <button
          type="button"
          onClick={handleDeleteFiltered}
          disabled={busy || pagination.total === 0}
          className="btn btn-danger"
        >
          {busy ? "Deleting…" : `Delete Filtered (${pagination.total})`}
        </button>
      </div>

      <div className="rounded-xl border border-sky-200 bg-sky-50 px-4 py-3 text-sm text-sky-900 dark:bg-sky-950/30 dark:border-sky-900/50 dark:text-sky-200">
        <p className="font-semibold dark:text-sky-100">How this differs from Audit Explorer</p>
        <p className="mt-1 dark:opacity-90">
          Audit Explorer shows confirmed data changes. Debug Logs show staff actions and client-side failures between those changes, so bug trails are easier to reconstruct.
        </p>
      </div>

      <div className="card p-4 space-y-3">
        <div className="flex items-start justify-between gap-3 flex-wrap">
          <div>
            <h2 className="text-sm font-bold text-[var(--text-primary)] uppercase tracking-wide">Capture Users</h2>
            <p className="text-xs text-[var(--text-muted)] mt-1">
              Only these email(s) will be logged when manual capture is enabled.
            </p>
          </div>
          <button
            type="button"
            className={manualCaptureEnabled ? "btn btn-danger" : "btn btn-secondary"}
            onClick={handleManualCaptureToggle}
          >
            {manualCaptureEnabled ? "Turn Capture Off" : "Turn Capture On"}
          </button>
        </div>
        <div>
          <p className="text-xs text-[var(--text-muted)] mt-1">
            Current capture status: <span className={manualCaptureEnabled ? "font-semibold text-emerald-700" : "font-semibold text-slate-700"}>{manualCaptureEnabled ? "Manual On" : "Off"}</span>
          </p>
        </div>
        <textarea
          className="form-textarea min-h-[84px]"
          value={captureEmails}
          onChange={(e) => setCaptureEmails(e.target.value)}
          placeholder="ops@example.com"
        />
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <p className="text-xs text-[var(--text-muted)]">Use comma or new line to separate emails.</p>
          <button type="button" className="btn btn-primary" onClick={() => void handleSaveCaptureEmails()} disabled={savingCaptureEmails}>
            {savingCaptureEmails ? "Saving…" : "Save Capture Emails"}
          </button>
        </div>
      </div>

      {(error || message) && (
        <div className={`rounded-lg border px-3 py-2 text-sm ${error ? "bg-rose-50 border-rose-200 text-rose-700 dark:bg-rose-950/30 dark:border-rose-900/50 dark:text-rose-200" : "bg-emerald-50 border-emerald-200 text-emerald-700 dark:bg-emerald-950/30 dark:border-emerald-900/50 dark:text-emerald-200"}`}>
          {error || message}
        </div>
      )}

      <div className="card p-4 flex flex-col gap-4">
        <div className="grid gap-3 md:grid-cols-6">
          <div>
            <label className="form-label">From</label>
            <input type="date" className="form-input" value={dateFrom} onChange={(e) => { setDateFrom(e.target.value); resetToFirstPage(); }} />
          </div>
          <div>
            <label className="form-label">To</label>
            <input type="date" className="form-input" value={dateTo} onChange={(e) => { setDateTo(e.target.value); resetToFirstPage(); }} />
          </div>
          <div>
            <label className="form-label">Type</label>
            <select className="form-select" value={eventType} onChange={(e) => { setEventType(e.target.value); resetToFirstPage(); }}>
              {EVENT_TYPE_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>{option.label}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="form-label">Severity</label>
            <select className="form-select" value={severity} onChange={(e) => { setSeverity(e.target.value); resetToFirstPage(); }}>
              {SEVERITY_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>{option.label}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="form-label">Path</label>
            <input className="form-input" placeholder="/pms/board" value={pathnameFilter} onChange={(e) => { setPathnameFilter(e.target.value); resetToFirstPage(); }} />
          </div>
          <div>
            <label className="form-label">Search</label>
            <input className="form-input" placeholder="actor, action, error…" value={search} onChange={(e) => { setSearch(e.target.value); resetToFirstPage(); }} />
          </div>
        </div>

        <div className="flex items-center justify-between gap-3 flex-wrap">
          <p className="text-sm text-[var(--text-secondary)]">
            {pagination.total > 0 ? `Showing ${(pagination.page - 1) * pagination.per_page + 1}-${Math.min(pagination.page * pagination.per_page, pagination.total)} of ${pagination.total}` : "No logs found"}
          </p>
          <div className="flex items-center gap-2">
            <button className="btn btn-secondary btn-sm" onClick={() => void load()} disabled={loading}>Refresh</button>
            <button className="btn btn-secondary btn-sm" onClick={() => setPagination((prev) => ({ ...prev, page: Math.max(1, prev.page - 1) }))} disabled={pagination.page <= 1 || loading}>Prev</button>
            <span className="text-xs text-[var(--text-muted)]">Page {pagination.page} / {pagination.total_pages}</span>
            <button className="btn btn-secondary btn-sm" onClick={() => setPagination((prev) => ({ ...prev, page: Math.min(prev.total_pages, prev.page + 1) }))} disabled={pagination.page >= pagination.total_pages || loading}>Next</button>
          </div>
        </div>

        <div className="overflow-x-auto">
          <table className="min-w-full text-sm">
            <thead>
              <tr className="border-b border-[var(--border-default)]">
                <th className="px-3 py-2 text-left">Time</th>
                <th className="px-3 py-2 text-left">Actor</th>
                <th className="px-3 py-2 text-left">Type</th>
                <th className="px-3 py-2 text-left">Path</th>
                <th className="px-3 py-2 text-left">Message</th>
                <th className="px-3 py-2 text-left">Metadata</th>
                <th className="px-3 py-2 text-right">Action</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr>
                  <td colSpan={7} className="px-3 py-8 text-center text-[var(--text-muted)]">Loading debug logs…</td>
                </tr>
              ) : rows.length === 0 ? (
                <tr>
                  <td colSpan={7} className="px-3 py-8 text-center text-[var(--text-muted)]">No debug logs for the current filters.</td>
                </tr>
              ) : rows.map((row) => (
                <tr key={row.id} className="border-b border-[var(--border-subtle)] align-top">
                  <td className="px-3 py-3 whitespace-nowrap text-xs">{formatDateTime(row.created_at)}</td>
                  <td className="px-3 py-3">
                    <p className="font-medium text-[var(--text-primary)]">{row.actor_name || "Unknown"}</p>
                    <p className="text-xs text-[var(--text-muted)]">{row.actor_email || "—"}</p>
                    <p className="text-xs text-[var(--text-muted)]">{row.actor_role || "—"}</p>
                  </td>
                  <td className="px-3 py-3">
                    <span className={`inline-flex rounded-full px-2 py-0.5 text-xs font-medium ${severityBadge(row.severity)}`}>
                      {row.severity}
                    </span>
                    <p className="mt-2 font-medium text-[var(--text-primary)]">{row.event_type}</p>
                    <p className="text-xs text-[var(--text-muted)]">{row.event_name}</p>
                  </td>
                  <td className="px-3 py-3 font-mono text-xs text-[var(--text-secondary)] break-all">{row.pathname}</td>
                  <td className="px-3 py-3">
                    <p className="text-[var(--text-primary)]">{row.message || "—"}</p>
                  </td>
                  <td className="px-3 py-3">
                    <pre className="max-w-md overflow-x-auto rounded-lg bg-[var(--bg-body)] p-2 text-[11px] text-[var(--text-secondary)] whitespace-pre-wrap break-words">
                      {formatMetadata(row.metadata)}
                    </pre>
                  </td>
                  <td className="px-3 py-3 text-right">
                    <button className="btn btn-danger btn-sm" onClick={() => void handleDeleteOne(row.id)} disabled={busy}>
                      Delete
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
