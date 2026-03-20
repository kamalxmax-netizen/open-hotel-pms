"use client";

import React, { useEffect, useState } from "react";
import Link from "next/link";
import {
  AUDIT_GROUPS,
  humanizeAction,
  humanizeKey,
  isUuidLike,
  SOURCE_BADGE,
  toBangkokDateString,
} from "@/lib/audit-utils";

type AuditGroup = "reservation" | "payment" | "housekeeping" | "night_audit" | "staff" | "configuration";

type AuditRow = {
  id: string;
  actor_user_id: string | null;
  actor_name: string;
  action: string;
  entity_type: string;
  entity_id: string;
  before_json: Record<string, unknown> | null;
  after_json: Record<string, unknown> | null;
  source: keyof typeof SOURCE_BADGE;
  note: string | null;
  business_date: string;
  created_at: string;
};

type ApiFilters = {
  available_actions: string[];
  available_entity_types: string[];
  available_actors: Array<{ user_id: string; display_name: string }>;
};

type ApiPagination = {
  page: number;
  per_page: number;
  total: number;
  total_pages: number;
};

type AuditApiResponse = {
  success: boolean;
  data?: AuditRow[];
  pagination?: ApiPagination;
  filters?: ApiFilters;
  error?: string;
};

const DEFAULT_FILTERS: ApiFilters = {
  available_actions: [],
  available_entity_types: [],
  available_actors: [],
};

const DEFAULT_PAGINATION: ApiPagination = {
  page: 1,
  per_page: 50,
  total: 0,
  total_pages: 0,
};

function formatDisplayValue(value: unknown): string {
  if (value === null || value === undefined) return "-";
  if (typeof value === "object") {
    try {
      return JSON.stringify(value);
    } catch {
      return String(value);
    }
  }
  return String(value);
}

function formatDiff(before: Record<string, unknown> | null, after: Record<string, unknown> | null) {
  const b = before ?? {};
  const a = after ?? {};
  const changes: { key: string; oldVal: string; newVal: string }[] = [];

  const allKeys = new Set([...Object.keys(b), ...Object.keys(a)]);
  for (const key of allKeys) {
    const bVal = b[key];
    const aVal = a[key];
    if (JSON.stringify(bVal) !== JSON.stringify(aVal)) {
      changes.push({
        key: humanizeKey(key),
        oldVal: formatDisplayValue(bVal),
        newVal: formatDisplayValue(aVal),
      });
    }
  }
  return changes;
}

function formatTime(isoString: string) {
  const d = new Date(isoString);
  return d.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", timeZone: "Asia/Bangkok" });
}

function buildAuditQuery(params: {
  dateFrom: string;
  dateTo: string;
  groupFilter: string;
  actionFilter: string;
  userFilter: string;
  search: string;
  page?: number;
  perPage?: number;
}) {
  const query = new URLSearchParams();
  query.set("date_from", params.dateFrom);
  query.set("date_to", params.dateTo);
  if (params.groupFilter !== "all") query.set("group", params.groupFilter);
  if (params.actionFilter !== "all") query.set("action", params.actionFilter);
  if (params.userFilter !== "all") query.set("actor_user_id", params.userFilter);
  const search = params.search.trim();
  if (search) query.set("search", search);
  if (typeof params.page === "number") query.set("page", String(params.page));
  if (typeof params.perPage === "number") query.set("per_page", String(params.perPage));
  return query;
}

function getEntityLink(row: AuditRow): string | null {
  if (!isUuidLike(row.entity_id)) return null;
  if (row.entity_type === "reservation") return `/pms/reservations/${row.entity_id}`;
  if (row.entity_type === "guest_profile") return `/pms/guests/${row.entity_id}`;
  return null;
}

export default function AuditExplorerPage() {
  const [expandedRows, setExpandedRows] = useState<Set<string>>(new Set());
  const [dateFrom, setDateFrom] = useState(() => toBangkokDateString());
  const [dateTo, setDateTo] = useState(() => toBangkokDateString());
  const [groupFilter, setGroupFilter] = useState<string>("all");
  const [actionFilter, setActionFilter] = useState<string>("all");
  const [userFilter, setUserFilter] = useState<string>("all");
  const [searchQuery, setSearchQuery] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");

  const [rows, setRows] = useState<AuditRow[]>([]);
  const [filters, setFilters] = useState<ApiFilters>(DEFAULT_FILTERS);
  const [pagination, setPagination] = useState<ApiPagination>(DEFAULT_PAGINATION);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    const controller = new AbortController();
    const loadBusinessDate = async () => {
      try {
        const response = await fetch("/api/eod/status", {
          cache: "no-store",
          credentials: "include",
          signal: controller.signal,
        });
        const payload = await response.json().catch(() => null);
        const businessDate = payload?.business_date;
        if (response.ok && typeof businessDate === "string" && /^\d{4}-\d{2}-\d{2}$/.test(businessDate)) {
          setDateFrom(businessDate);
          setDateTo(businessDate);
        }
      } catch (err) {
        if ((err as Error)?.name === "AbortError") return;
      }
    };

    void loadBusinessDate();
    return () => controller.abort();
  }, []);

  const toggleRow = (id: string) => {
    const next = new Set(expandedRows);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    setExpandedRows(next);
  };

  useEffect(() => {
    const timer = setTimeout(() => {
      setDebouncedSearch(searchQuery);
      setPagination((prev) => ({ ...prev, page: 1 }));
    }, 300);
    return () => clearTimeout(timer);
  }, [searchQuery]);

  useEffect(() => {
    const controller = new AbortController();
    const run = async () => {
      setLoading(true);
      setError("");
      try {
        const query = buildAuditQuery({
          dateFrom,
          dateTo,
          groupFilter,
          actionFilter,
          userFilter,
          search: debouncedSearch,
          page: pagination.page,
          perPage: pagination.per_page,
        });

        const response = await fetch(`/api/audit?${query.toString()}`, {
          signal: controller.signal,
          cache: "no-store",
          credentials: "include",
        });
        const payload = (await response.json()) as AuditApiResponse;
        if (!response.ok || !payload.success) {
          throw new Error(payload.error || `Failed to load audit logs (${response.status})`);
        }

        setRows(Array.isArray(payload.data) ? payload.data : []);
        if (payload.pagination) {
          setPagination(payload.pagination);
        } else {
          setPagination((prev) => ({ ...prev, total: 0, total_pages: 0 }));
        }
        if (payload.filters) {
          setFilters(payload.filters);
        }
      } catch (err) {
        if ((err as Error)?.name === "AbortError") return;
        setRows([]);
        setError(err instanceof Error ? err.message : "Failed to load audit logs.");
      } finally {
        if (!controller.signal.aborted) {
          setLoading(false);
        }
      }
    };

    run();
    return () => controller.abort();
  }, [dateFrom, dateTo, groupFilter, actionFilter, userFilter, debouncedSearch, pagination.page, pagination.per_page]);

  const total = pagination.total;
  const start = total === 0 ? 0 : (pagination.page - 1) * pagination.per_page + 1;
  const end = total === 0 ? 0 : Math.min(pagination.page * pagination.per_page, total);
  const hasPrev = pagination.page > 1;
  const hasNext = pagination.page < pagination.total_pages;

  return (
    <div className="flex flex-col gap-5 max-w-7xl mx-auto pb-10">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <p className="text-xs font-semibold uppercase tracking-widest text-slate-500">System Logs</p>
          <h1 className="text-2xl font-bold text-[var(--text-primary)] mt-0.5">Audit Explorer</h1>
          <p className="text-sm text-[var(--text-muted)] mt-0.5">View and trace system and manual actions</p>
        </div>
        <div className="flex items-center gap-3">
          <button
            className="btn btn-secondary btn-sm"
            onClick={() => {
              const query = buildAuditQuery({
                dateFrom,
                dateTo,
                groupFilter,
                actionFilter,
                userFilter,
                search: searchQuery,
              });
              window.location.assign(`/api/audit/export?${query.toString()}`);
            }}
          >
            Export CSV
          </button>
        </div>
      </div>

      <div className="card p-4 flex flex-col gap-4">
        <div className="flex flex-wrap items-center gap-4">
          <div className="flex items-center gap-2">
            <label className="text-xs font-semibold text-[var(--text-secondary)]">From</label>
            <input
              type="date"
              className="form-input py-1 text-sm w-36"
              value={dateFrom}
              onChange={(e) => {
                setDateFrom(e.target.value);
                setPagination((prev) => ({ ...prev, page: 1 }));
              }}
            />
          </div>
          <div className="flex items-center gap-2">
            <label className="text-xs font-semibold text-[var(--text-secondary)]">To</label>
            <input
              type="date"
              className="form-input py-1 text-sm w-36"
              value={dateTo}
              onChange={(e) => {
                setDateTo(e.target.value);
                setPagination((prev) => ({ ...prev, page: 1 }));
              }}
            />
          </div>

          <div className="h-6 w-px bg-[var(--border-subtle)] hidden sm:block"></div>

          <select
            className="form-input py-1 text-sm w-40"
            value={groupFilter}
            onChange={(e) => {
              setGroupFilter(e.target.value);
              setPagination((prev) => ({ ...prev, page: 1 }));
            }}
          >
            <option value="all">Every Group</option>
            {Object.entries(AUDIT_GROUPS).map(([k, v]) => (
              <option key={k} value={k}>
                {v.label}
              </option>
            ))}
          </select>

          <select
            className="form-input py-1 text-sm w-40"
            value={actionFilter}
            onChange={(e) => {
              setActionFilter(e.target.value);
              setPagination((prev) => ({ ...prev, page: 1 }));
            }}
          >
            <option value="all">Every Action</option>
            {filters.available_actions.map((action) => (
              <option key={action} value={action}>
                {humanizeAction(action)}
              </option>
            ))}
          </select>

          <select
            className="form-input py-1 text-sm w-40"
            value={userFilter}
            onChange={(e) => {
              setUserFilter(e.target.value);
              setPagination((prev) => ({ ...prev, page: 1 }));
            }}
          >
            <option value="all">Every User</option>
            {filters.available_actors.map((actor) => (
              <option key={actor.user_id} value={actor.user_id}>
                {actor.display_name}
              </option>
            ))}
          </select>
        </div>

        <div className="flex items-center gap-2">
          <div className="relative flex-1 max-w-md">
            <div className="absolute inset-y-0 left-3 flex items-center pointer-events-none">
              <svg className="w-4 h-4 text-slate-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"
                />
              </svg>
            </div>
            <input
              type="text"
              className="form-input py-1.5 pl-9 text-sm w-full"
              placeholder="Search entity ID, action, or notes..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
            />
          </div>
          <button
            className="btn btn-primary py-1.5 px-4 text-sm"
            onClick={() => {
              setDebouncedSearch(searchQuery.trim());
              setPagination((prev) => ({ ...prev, page: 1 }));
            }}
          >
            Search
          </button>
        </div>
      </div>

      <div className="card overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm text-left">
            <thead className="bg-[var(--bg-muted)] border-b border-[var(--border-subtle)] text-[var(--text-secondary)]">
              <tr>
                <th className="px-4 py-3 font-semibold w-8 text-center"></th>
                <th className="px-4 py-3 font-semibold w-24">Time</th>
                <th className="px-4 py-3 font-semibold w-32">User</th>
                <th className="px-4 py-3 font-semibold w-48">Action</th>
                <th className="px-4 py-3 font-semibold">Entity</th>
                <th className="px-4 py-3 font-semibold w-32">Source</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[var(--border-subtle)] bg-[var(--bg-surface)]">
              {loading && (
                <tr>
                  <td colSpan={6} className="px-4 py-8 text-center text-sm text-[var(--text-muted)]">
                    Loading audit logs...
                  </td>
                </tr>
              )}

              {!loading && error && (
                <tr>
                  <td colSpan={6} className="px-4 py-8 text-center text-sm text-rose-600">
                    {error}
                  </td>
                </tr>
              )}

              {!loading && !error && rows.length === 0 && (
                <tr>
                  <td colSpan={6} className="px-4 py-8 text-center text-sm text-[var(--text-muted)]">
                    No audit records found for current filters.
                  </td>
                </tr>
              )}

              {!loading &&
                !error &&
                rows.map((row) => {
                  const isExpanded = expandedRows.has(row.id);
                  const sourceBadge = SOURCE_BADGE[row.source] || SOURCE_BADGE.manual;
                  const displayName = row.actor_name || "System";
                  const entityLink = getEntityLink(row);
                  const diffs = formatDiff(row.before_json, row.after_json);

                  return (
                    <React.Fragment key={row.id}>
                      <tr
                        className={`hover:bg-[var(--bg-body)] transition-colors cursor-pointer ${isExpanded ? "bg-[var(--bg-body)]" : ""}`}
                        onClick={() => toggleRow(row.id)}
                      >
                        <td className="px-4 py-3 text-center text-[var(--text-muted)]">
                          <svg
                            className={`w-4 h-4 transition-transform ${isExpanded ? "rotate-90 text-brand-500" : ""}`}
                            fill="none"
                            viewBox="0 0 24 24"
                            stroke="currentColor"
                          >
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                          </svg>
                        </td>
                        <td className="px-4 py-3 font-medium text-[var(--text-primary)]">{formatTime(row.created_at)}</td>
                        <td className="px-4 py-3">
                          <span className="font-semibold text-slate-700 dark:text-slate-300">{displayName}</span>
                        </td>
                        <td className="px-4 py-3 text-[var(--text-table-cell)]">{humanizeAction(row.action)}</td>
                        <td className="px-4 py-3">
                          {entityLink ? (
                            <Link
                              href={entityLink}
                              className="font-semibold text-brand-600 hover:underline"
                              onClick={(e) => e.stopPropagation()}
                            >
                              {row.entity_id}
                            </Link>
                          ) : (
                            <span className="font-mono text-xs bg-[var(--bg-muted)] px-1.5 py-0.5 rounded text-[var(--text-secondary)]">
                              {row.entity_id}
                            </span>
                          )}
                          <span className="ml-2 text-[10px] uppercase tracking-wider text-[var(--text-muted)]">
                            {humanizeAction(row.entity_type)}
                          </span>
                        </td>
                        <td className="px-4 py-3">
                          <span
                            className={`px-2 py-0.5 rounded text-xs font-semibold border ${sourceBadge.lightClass} ${sourceBadge.darkClass}`}
                          >
                            {sourceBadge.label}
                          </span>
                        </td>
                      </tr>

                      {isExpanded && (
                        <tr className="bg-[var(--bg-body)] border-b-2 border-brand-100 dark:border-brand-900/30">
                          <td colSpan={6} className="px-12 py-4">
                            <div className="flex mx-auto gap-8 max-w-4xl">
                              <div className="flex-1 bg-[var(--bg-surface)] border border-[var(--border-subtle)] rounded-lg p-4 shadow-sm">
                                <h4 className="text-xs font-bold uppercase tracking-wider text-[var(--text-muted)] mb-3">
                                  Record Changes
                                </h4>

                                <div className="space-y-2">
                                  {diffs.map((change, i) => (
                                    <div key={`${row.id}-diff-${i}`} className="flex flex-col sm:flex-row sm:items-center text-sm">
                                      <span className="font-semibold text-[var(--text-secondary)] w-40 flex-shrink-0">{change.key}</span>
                                      <div className="flex items-center flex-1 font-mono text-xs">
                                        <span
                                          className="bg-rose-50 text-rose-700 border border-rose-100 dark:bg-rose-900/20 dark:text-rose-400 dark:border-rose-900 px-1.5 py-0.5 rounded line-through opacity-80 min-w-[60px] text-center max-w-[200px] truncate"
                                          title={change.oldVal}
                                        >
                                          {change.oldVal}
                                        </span>
                                        <svg className="w-4 h-4 mx-2 text-slate-400 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M14 5l7 7m0 0l-7 7m7-7H3" />
                                        </svg>
                                        <span
                                          className="bg-emerald-50 text-emerald-700 border border-emerald-100 dark:bg-emerald-900/20 dark:text-emerald-400 dark:border-emerald-900 px-1.5 py-0.5 rounded font-bold min-w-[60px] text-center max-w-[200px] truncate"
                                          title={change.newVal}
                                        >
                                          {change.newVal}
                                        </span>
                                      </div>
                                    </div>
                                  ))}

                                  {diffs.length === 0 && (
                                    <p className="text-sm text-[var(--text-muted)] italic">No specific field changes recorded.</p>
                                  )}
                                </div>
                              </div>

                              <div className="w-64 flex flex-col gap-4">
                                <div>
                                  <h4 className="text-xs font-bold uppercase tracking-wider text-[var(--text-muted)] mb-1">Business Date</h4>
                                  <p className="text-sm font-semibold text-[var(--text-primary)]">{row.business_date}</p>
                                </div>
                                <div>
                                  <h4 className="text-xs font-bold uppercase tracking-wider text-[var(--text-muted)] mb-1">Notes</h4>
                                  {row.note ? (
                                    <p className="text-sm text-[var(--text-secondary)] bg-amber-50 dark:bg-amber-900/10 p-2 rounded border border-amber-100 dark:border-amber-900/30">
                                      {row.note}
                                    </p>
                                  ) : (
                                    <p className="text-sm text-[var(--text-muted)] italic">-</p>
                                  )}
                                </div>
                              </div>
                            </div>
                          </td>
                        </tr>
                      )}
                    </React.Fragment>
                  );
                })}
            </tbody>
          </table>
        </div>

        <div className="bg-[var(--bg-muted)] border-t border-[var(--border-subtle)] px-4 py-3 flex items-center justify-between">
          <p className="text-xs text-[var(--text-secondary)]">
            Showing <span className="font-semibold text-[var(--text-primary)]">{start}</span> to{" "}
            <span className="font-semibold text-[var(--text-primary)]">{end}</span> of{" "}
            <span className="font-semibold text-[var(--text-primary)]">{total}</span> entries
          </p>
          <div className="flex gap-1 items-center">
            <button
              className={`px-2.5 py-1 min-w-[32px] rounded text-sm border ${
                hasPrev
                  ? "text-[var(--text-secondary)] bg-[var(--bg-surface)] border-[var(--border-default)] hover:bg-[var(--bg-body)]"
                  : "text-[var(--text-muted)] bg-[var(--bg-surface)] border-[var(--border-default)] opacity-50 cursor-not-allowed"
              }`}
              onClick={() => hasPrev && setPagination((prev) => ({ ...prev, page: prev.page - 1 }))}
              disabled={!hasPrev}
            >
              Prev
            </button>
            <button className="px-2.5 py-1 min-w-[32px] rounded text-sm font-semibold text-white bg-brand-600 border border-brand-600">
              {pagination.page}
            </button>
            <button
              className={`px-2.5 py-1 min-w-[32px] rounded text-sm border ${
                hasNext
                  ? "text-[var(--text-secondary)] bg-[var(--bg-surface)] border-[var(--border-default)] hover:bg-[var(--bg-body)]"
                  : "text-[var(--text-muted)] bg-[var(--bg-surface)] border-[var(--border-default)] opacity-50 cursor-not-allowed"
              }`}
              onClick={() => hasNext && setPagination((prev) => ({ ...prev, page: prev.page + 1 }))}
              disabled={!hasNext}
            >
              Next
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
