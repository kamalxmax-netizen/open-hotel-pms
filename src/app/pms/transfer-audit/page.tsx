"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Archive,
  ArrowDownUp,
  CheckCircle2,
  Clock,
  Edit3,
  Link2,
  RefreshCw,
  Search,
  XCircle,
} from "lucide-react";
import { formatMoney } from "@/lib/money";

type TransferCandidate = {
  id: string;
  transfer_event_id: string | null;
  reservation_id: string;
  booking_code: string | null;
  guest_name: string | null;
  room_number: string | null;
  checkin_date: string | null;
  checkout_date: string | null;
  booking_group_id: string | null;
  group_code: string | null;
  group_name: string | null;
  paid_date: string | null;
  paid_at: string | null;
  tx_type: string | null;
  amount: number;
  note: string | null;
  cashier_name: string | null;
  revenue_category: string | null;
  search_text: string;
};

type TransferAuditRow = {
  id: string;
  kind: "grouped" | "unlinked";
  status: "grouped" | "needs_detail";
  transfer_event_id: string | null;
  payment_id: string | null;
  payment_ids: string[];
  payment_count: number;
  payments: TransferCandidate[];
  paid_date: string | null;
  transfer_at: string | null;
  recorded_at: string | null;
  amount: number;
  actual_amount: number | null;
  folio_amount: number;
  delta: number | null;
  sender_name: string | null;
  bank_ref: string | null;
  transfer_note: string | null;
  booking_codes: string[];
  guest_names: string[];
  room_numbers: string[];
  group_names: string[];
  group_codes: string[];
  booking_code: string | null;
  guest_name: string | null;
  room_number: string | null;
};

type TransferAuditSummary = {
  needs_detail_count: number;
  grouped_count: number;
  grouped_total: number;
  total_amount: number;
};

type TabKey = "needs_detail" | "grouped" | "all";

type DetailForm = {
  senderName: string;
  bankRef: string;
  transferAt: string;
  note: string;
};

const EMPTY_SUMMARY: TransferAuditSummary = {
  needs_detail_count: 0,
  grouped_count: 0,
  grouped_total: 0,
  total_amount: 0,
};

function todayInBangkok(): string {
  const base = new Date(new Date().toLocaleString("en-US", { timeZone: "Asia/Bangkok" }));
  const yyyy = base.getFullYear();
  const mm = String(base.getMonth() + 1).padStart(2, "0");
  const dd = String(base.getDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}

function formatDateTime(value: string | null): string {
  if (!value) return "-";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "-";
  return new Intl.DateTimeFormat("en-GB", {
    timeZone: "Asia/Bangkok",
    day: "2-digit",
    month: "2-digit",
    year: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(date);
}

function toBangkokDateTimeLocal(value: string | null): string {
  const date = value ? new Date(value) : new Date();
  const safeDate = Number.isNaN(date.getTime()) ? new Date() : date;
  const bangkok = new Date(safeDate.toLocaleString("en-US", { timeZone: "Asia/Bangkok" }));
  const yyyy = bangkok.getFullYear();
  const mm = String(bangkok.getMonth() + 1).padStart(2, "0");
  const dd = String(bangkok.getDate()).padStart(2, "0");
  const hh = String(bangkok.getHours()).padStart(2, "0");
  const mi = String(bangkok.getMinutes()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}T${hh}:${mi}`;
}

function compactJoin(values: Array<string | null | undefined>, fallback = "-"): string {
  const unique = Array.from(new Set(values.map((value) => String(value ?? "").trim()).filter(Boolean)));
  if (unique.length === 0) return fallback;
  if (unique.length <= 3) return unique.join(", ");
  return `${unique.slice(0, 3).join(", ")} +${unique.length - 3}`;
}

function rowSearchText(row: TransferAuditRow): string {
  return [
    row.booking_codes.join(" "),
    row.guest_names.join(" "),
    row.room_numbers.join(" "),
    row.group_names.join(" "),
    row.group_codes.join(" "),
    row.sender_name,
    row.bank_ref,
    row.transfer_note,
    row.payments.map((payment) => payment.note).join(" "),
  ].join(" ").toLowerCase();
}

function statusBadge(row: TransferAuditRow) {
  if (row.kind === "unlinked") {
    return (
      <span className="inline-flex items-center gap-1 rounded-full border border-amber-200 bg-amber-50 px-2 py-0.5 text-[10px] font-black uppercase tracking-[0.12em] text-amber-700 dark:border-amber-500/30 dark:bg-amber-500/15 dark:text-amber-300">
        <Clock className="h-3 w-3" />
        Needs Detail
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1 rounded-full border border-emerald-200 bg-emerald-50 px-2 py-0.5 text-[10px] font-black uppercase tracking-[0.12em] text-emerald-700 dark:border-emerald-500/30 dark:bg-emerald-500/15 dark:text-emerald-300">
      <CheckCircle2 className="h-3 w-3" />
      Grouped
    </span>
  );
}

function defaultFormForRow(row: TransferAuditRow | null): DetailForm {
  return {
    senderName: row?.sender_name ?? "",
    bankRef: row?.bank_ref ?? "",
    transferAt: toBangkokDateTimeLocal(row?.transfer_at ?? row?.recorded_at ?? null),
    note: row?.transfer_note ?? "",
  };
}

function candidateLabel(candidate: TransferCandidate): string {
  const booking = candidate.booking_code || "No booking";
  const room = candidate.room_number ? `Room ${candidate.room_number}` : "No room";
  return `${booking} · ${room}`;
}

function isCandidateSelectable(candidate: TransferCandidate, selectedRow: TransferAuditRow | null): boolean {
  return Boolean(candidate.id && selectedRow);
}

export default function TransferAuditPage() {
  const [from, setFrom] = useState(todayInBangkok());
  const [to, setTo] = useState(todayInBangkok());
  const [query, setQuery] = useState("");
  const [candidateQuery, setCandidateQuery] = useState("");
  const [tab, setTab] = useState<TabKey>("needs_detail");
  const [rows, setRows] = useState<TransferAuditRow[]>([]);
  const [candidates, setCandidates] = useState<TransferCandidate[]>([]);
  const [summary, setSummary] = useState<TransferAuditSummary>(EMPTY_SUMMARY);
  const [selectedRowId, setSelectedRowId] = useState<string | null>(null);
  const [selectedPaymentIds, setSelectedPaymentIds] = useState<string[]>([]);
  const [form, setForm] = useState<DetailForm>(defaultFormForRow(null));
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [drawerError, setDrawerError] = useState("");
  const focusRef = useRef<string | null>(null);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    focusRef.current = params.get("focus");
    if (focusRef.current) setTab("all");
  }, []);

  const fetchRows = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const params = new URLSearchParams({ from, to, limit: "500", _ts: String(Date.now()) });
      const response = await fetch(`/api/transfer-events?${params.toString()}`, { cache: "no-store" });
      const data = await response.json().catch(() => null);
      if (!response.ok || !data?.success) {
        throw new Error(data?.error || "Failed to load transfer audit.");
      }
      const nextRows = (data.rows ?? []) as TransferAuditRow[];
      const nextCandidates = (data.candidate_payments ?? []) as TransferCandidate[];
      setRows(nextRows);
      setCandidates(nextCandidates);
      setSummary(data.summary ?? EMPTY_SUMMARY);

      const focusId = focusRef.current;
      if (focusId) {
        const focused = nextRows.find((row) => row.transfer_event_id === focusId || row.id === focusId);
        if (focused) {
          setSelectedRowId(focused.id);
          focusRef.current = null;
        }
      }
      return nextRows;
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load transfer audit.");
      setRows([]);
      setCandidates([]);
      return [];
    } finally {
      setLoading(false);
    }
  }, [from, to]);

  useEffect(() => {
    void fetchRows();
  }, [fetchRows]);

  const selectedRow = useMemo(
    () => rows.find((row) => row.id === selectedRowId) ?? null,
    [rows, selectedRowId]
  );

  useEffect(() => {
    if (!selectedRowId) return;
    if (!rows.some((row) => row.id === selectedRowId)) setSelectedRowId(null);
  }, [rows, selectedRowId]);

  useEffect(() => {
    setForm(defaultFormForRow(selectedRow));
    setSelectedPaymentIds(selectedRow?.payment_ids ?? []);
    setCandidateQuery("");
    setDrawerError("");
  }, [selectedRow]);

  const candidateById = useMemo(() => {
    const map = new Map<string, TransferCandidate>();
    for (const candidate of candidates) map.set(candidate.id, candidate);
    return map;
  }, [candidates]);

  const filteredRows = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return rows.filter((row) => {
      if (tab === "needs_detail" && row.kind !== "unlinked") return false;
      if (tab === "grouped" && row.kind !== "grouped") return false;
      return !needle || rowSearchText(row).includes(needle);
    });
  }, [query, rows, tab]);

  const selectedTotal = useMemo(
    () => selectedPaymentIds.reduce((sum, id) => sum + Number(candidateById.get(id)?.amount ?? 0), 0),
    [candidateById, selectedPaymentIds]
  );

  const drawerCandidates = useMemo(() => {
    const needle = candidateQuery.trim().toLowerCase();
    const selectedSet = new Set(selectedPaymentIds);
    return candidates
      .filter((candidate) => {
        if (needle && !candidate.search_text.includes(needle)) return false;
        return true;
      })
      .sort((left, right) => {
        const leftSelected = selectedSet.has(left.id) ? 1 : 0;
        const rightSelected = selectedSet.has(right.id) ? 1 : 0;
        if (leftSelected !== rightSelected) return rightSelected - leftSelected;
        const leftForeign = left.transfer_event_id && left.transfer_event_id !== selectedRow?.transfer_event_id ? 1 : 0;
        const rightForeign = right.transfer_event_id && right.transfer_event_id !== selectedRow?.transfer_event_id ? 1 : 0;
        if (leftForeign !== rightForeign) return leftForeign - rightForeign;
        return String(right.paid_at ?? "").localeCompare(String(left.paid_at ?? ""));
      });
  }, [candidateQuery, candidates, selectedPaymentIds, selectedRow]);

  function selectRow(row: TransferAuditRow) {
    setSelectedRowId(row.id);
  }

  function togglePayment(candidate: TransferCandidate) {
    if (!isCandidateSelectable(candidate, selectedRow)) return;
    setSelectedPaymentIds((current) => (
      current.includes(candidate.id)
        ? current.filter((id) => id !== candidate.id)
        : [...current, candidate.id]
    ));
  }

  function selectVisibleCandidates() {
    const allowed = drawerCandidates
      .filter((candidate) => isCandidateSelectable(candidate, selectedRow))
      .map((candidate) => candidate.id);
    setSelectedPaymentIds(Array.from(new Set([...selectedPaymentIds, ...allowed])));
  }

  function selectSameGroup() {
    const groupIds = new Set(selectedRow?.payments.map((payment) => payment.booking_group_id).filter(Boolean));
    if (groupIds.size === 0) return;
    const ids = candidates
      .filter((candidate) => candidate.booking_group_id && groupIds.has(candidate.booking_group_id))
      .filter((candidate) => isCandidateSelectable(candidate, selectedRow))
      .map((candidate) => candidate.id);
    setSelectedPaymentIds(Array.from(new Set([...selectedPaymentIds, ...ids])));
  }

  function selectSameGroupName() {
    const groupNames = new Set(selectedRow?.payments.map((payment) => payment.group_name).filter(Boolean));
    if (groupNames.size === 0) return;
    const ids = candidates
      .filter((candidate) => candidate.group_name && groupNames.has(candidate.group_name))
      .filter((candidate) => isCandidateSelectable(candidate, selectedRow))
      .map((candidate) => candidate.id);
    setSelectedPaymentIds(Array.from(new Set([...selectedPaymentIds, ...ids])));
  }

  async function saveGroup() {
    if (!selectedRow) return;
    setSaving(true);
    setDrawerError("");
    try {
      const payload = {
        folio_payment_ids: selectedPaymentIds,
        detail: {
          sender_name: form.senderName,
          bank_ref: form.bankRef,
          transfer_at: form.transferAt,
          note: form.note,
        },
      };
      const url = selectedRow.kind === "grouped"
        ? `/api/transfer-events/${encodeURIComponent(selectedRow.transfer_event_id || selectedRow.id)}`
        : "/api/transfer-events/group";
      const method = selectedRow.kind === "grouped" ? "PATCH" : "POST";
      const response = await fetch(url, {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const data = await response.json().catch(() => null);
      if (!response.ok || !data?.success) {
        throw new Error(data?.error || "Failed to save transfer group.");
      }
      const nextRows = await fetchRows();
      const savedId = String(data.transfer_event_id ?? "");
      const savedRow = nextRows.find((row) => row.transfer_event_id === savedId || row.id === savedId);
      setSelectedRowId(savedRow?.id ?? null);
      setTab("all");
    } catch (err) {
      setDrawerError(err instanceof Error ? err.message : "Failed to save transfer group.");
    } finally {
      setSaving(false);
    }
  }

  async function archiveGroup() {
    if (!selectedRow?.transfer_event_id) return;
    const ok = window.confirm("Archive this transfer detail group? Payment rows stay in folio and notes are restored.");
    if (!ok) return;
    setSaving(true);
    setDrawerError("");
    try {
      const response = await fetch(`/api/transfer-events/${encodeURIComponent(selectedRow.transfer_event_id)}/archive`, {
        method: "POST",
      });
      const data = await response.json().catch(() => null);
      if (!response.ok || !data?.success) {
        throw new Error(data?.error || "Failed to archive transfer group.");
      }
      await fetchRows();
      setSelectedRowId(null);
      setTab("needs_detail");
    } catch (err) {
      setDrawerError(err instanceof Error ? err.message : "Failed to archive transfer group.");
    } finally {
      setSaving(false);
    }
  }

  const tabItems: Array<{ key: TabKey; label: string; count: number }> = [
    { key: "needs_detail", label: "Needs Detail", count: summary.needs_detail_count },
    { key: "grouped", label: "Grouped", count: summary.grouped_count },
    { key: "all", label: "All", count: rows.length },
  ];

  return (
    <div className="flex min-h-[calc(100vh-4rem)] w-full flex-col bg-[var(--bg-body)]">
      <div className="border-b border-[var(--border-default)] bg-[var(--bg-surface)] px-5 py-4">
        <div className="flex flex-col gap-4 xl:flex-row xl:items-end xl:justify-between">
          <div>
            <div className="mb-1 flex items-center gap-2 text-xs font-black uppercase tracking-[0.2em] text-[var(--text-muted)]">
              <ArrowDownUp className="h-4 w-4" />
              Audit & Finance
            </div>
            <h1 className="text-2xl font-black text-[var(--text-primary)]">Transfer Audit</h1>
          </div>

          <div className="flex flex-wrap items-end gap-2">
            <label className="block">
              <span className="form-label">From</span>
              <input className="form-input h-9 w-[150px]" type="date" value={from} onChange={(event) => setFrom(event.target.value)} />
            </label>
            <label className="block">
              <span className="form-label">To</span>
              <input className="form-input h-9 w-[150px]" type="date" value={to} onChange={(event) => setTo(event.target.value)} />
            </label>
            <label className="block min-w-[280px]">
              <span className="form-label">Search</span>
              <div className="relative">
                <Search className="pointer-events-none absolute left-2.5 top-2.5 h-4 w-4 text-[var(--text-muted)]" />
                <input
                  className="form-input h-9 pl-8"
                  type="search"
                  value={query}
                  onChange={(event) => setQuery(event.target.value)}
                  placeholder="Booking, guest, room, group, ref"
                />
              </div>
            </label>
            <button type="button" className="btn btn-secondary h-9" onClick={() => void fetchRows()} disabled={loading}>
              <RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} />
              Refresh
            </button>
          </div>
        </div>

        <div className="mt-4 flex flex-wrap items-center gap-2">
          {tabItems.map((item) => (
            <button
              key={item.key}
              type="button"
              onClick={() => setTab(item.key)}
              className={`inline-flex h-9 items-center gap-2 rounded-md border px-3 text-sm font-bold transition-colors ${
                tab === item.key
                  ? "border-sky-300 bg-sky-50 text-sky-800 dark:border-sky-500/30 dark:bg-sky-500/15 dark:text-sky-200"
                  : "border-[var(--border-default)] bg-[var(--bg-body)] text-[var(--text-secondary)] hover:bg-[var(--bg-surface-hover)]"
              }`}
            >
              {item.label}
              <span className="rounded bg-white px-1.5 py-0.5 font-mono text-xs text-[var(--text-primary)] dark:bg-black/20">
                {item.count}
              </span>
            </button>
          ))}
          <div className="ml-auto flex gap-3 text-xs font-bold text-[var(--text-secondary)]">
            <span>Total ฿{formatMoney(summary.total_amount)}</span>
            <span>Grouped ฿{formatMoney(summary.grouped_total)}</span>
          </div>
        </div>
      </div>

      {error && (
        <div className="mx-5 mt-4 rounded-md border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700 dark:border-rose-500/20 dark:bg-rose-500/10 dark:text-rose-300">
          {error}
        </div>
      )}

      <div className="grid flex-1 gap-0 xl:grid-cols-[minmax(0,1fr)_420px]">
        <main className="min-w-0 overflow-hidden">
          <div className="overflow-x-auto">
            <table className="min-w-[1060px] w-full text-sm">
              <thead className="sticky top-0 z-10 bg-[var(--bg-body)] text-left text-[11px] font-black uppercase tracking-[0.14em] text-[var(--text-muted)]">
                <tr className="border-b border-[var(--border-default)]">
                  <th className="px-4 py-3">Status</th>
                  <th className="px-4 py-3">Transfer Time</th>
                  <th className="px-4 py-3 text-right">Locked Amount</th>
                  <th className="px-4 py-3">Booking / Group</th>
                  <th className="px-4 py-3">Rooms</th>
                  <th className="px-4 py-3">Evidence</th>
                  <th className="px-4 py-3 text-right">Rows</th>
                </tr>
              </thead>
              <tbody>
                {loading ? (
                  <tr>
                    <td colSpan={7} className="px-4 py-12 text-center text-[var(--text-secondary)]">Loading transfer audit...</td>
                  </tr>
                ) : filteredRows.length === 0 ? (
                  <tr>
                    <td colSpan={7} className="px-4 py-12 text-center text-[var(--text-secondary)]">No transfer rows in this range.</td>
                  </tr>
                ) : (
                  filteredRows.map((row) => {
                    const selected = selectedRowId === row.id;
                    return (
                      <tr
                        key={`${row.kind}-${row.id}`}
                        onClick={() => selectRow(row)}
                        className={`cursor-pointer border-b border-[var(--border-subtle)] transition-colors ${
                          selected
                            ? "bg-sky-50/80 dark:bg-sky-500/10"
                            : "hover:bg-[var(--bg-surface-hover)]"
                        }`}
                      >
                        <td className="whitespace-nowrap px-4 py-3">{statusBadge(row)}</td>
                        <td className="whitespace-nowrap px-4 py-3 font-medium text-[var(--text-primary)]">
                          {formatDateTime(row.transfer_at)}
                          <div className="mt-1 text-xs text-[var(--text-muted)]">{row.paid_date || "-"}</div>
                        </td>
                        <td className="whitespace-nowrap px-4 py-3 text-right font-mono text-base font-black text-[var(--text-primary)]">
                          ฿{formatMoney(row.amount)}
                        </td>
                        <td className="max-w-[260px] px-4 py-3">
                          <div className="truncate font-bold text-[var(--text-primary)]">{compactJoin(row.booking_codes)}</div>
                          <div className="truncate text-xs text-[var(--text-secondary)]">
                            {compactJoin(row.guest_names)} · {compactJoin(row.group_names.length ? row.group_names : row.group_codes, "No group")}
                          </div>
                        </td>
                        <td className="max-w-[170px] px-4 py-3 text-[var(--text-secondary)]">
                          <div className="truncate font-semibold text-[var(--text-primary)]">{compactJoin(row.room_numbers, "No room")}</div>
                          <div className="text-xs">{row.payment_count} payment row{row.payment_count === 1 ? "" : "s"}</div>
                        </td>
                        <td className="max-w-[320px] px-4 py-3">
                          <div className="truncate font-semibold text-[var(--text-primary)]">{row.sender_name || "No sender"}</div>
                          <div className="truncate text-xs text-[var(--text-secondary)]">Ref {row.bank_ref || "-"}</div>
                          <div className="truncate text-xs text-[var(--text-muted)]" title={row.transfer_note || ""}>
                            {row.transfer_note || row.payments[0]?.note || "-"}
                          </div>
                        </td>
                        <td className="whitespace-nowrap px-4 py-3 text-right">
                          <span className="inline-flex items-center gap-1 rounded border border-[var(--border-default)] bg-[var(--bg-surface)] px-2 py-1 text-xs font-bold text-[var(--text-secondary)]">
                            <Link2 className="h-3.5 w-3.5" />
                            {row.payment_count}
                          </span>
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
        </main>

        <aside className="border-t border-[var(--border-default)] bg-[var(--bg-surface)] xl:border-l xl:border-t-0">
          {!selectedRow ? (
            <div className="flex h-full min-h-[420px] flex-col items-center justify-center px-8 text-center text-[var(--text-secondary)]">
              <Edit3 className="mb-3 h-8 w-8 text-[var(--text-muted)]" />
              <div className="text-sm font-bold text-[var(--text-primary)]">Select a transfer row</div>
            </div>
          ) : (
            <div className="flex h-full max-h-[calc(100vh-12rem)] flex-col">
              <div className="border-b border-[var(--border-default)] px-5 py-4">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <div className="mb-2">{statusBadge(selectedRow)}</div>
                    <div className="text-lg font-black text-[var(--text-primary)]">฿{formatMoney(selectedTotal)}</div>
                    <div className="text-xs text-[var(--text-muted)]">Locked from selected folio payments</div>
                  </div>
                  {selectedRow.kind === "grouped" && (
                    <button
                      type="button"
                      className="btn btn-secondary h-9 text-rose-700 hover:text-rose-800 dark:text-rose-300"
                      onClick={() => void archiveGroup()}
                      disabled={saving}
                    >
                      <Archive className="h-4 w-4" />
                      Archive
                    </button>
                  )}
                </div>
              </div>

              <div className="flex-1 overflow-y-auto px-5 py-4">
                {drawerError && (
                  <div className="mb-4 rounded-md border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700 dark:border-rose-500/20 dark:bg-rose-500/10 dark:text-rose-300">
                    {drawerError}
                  </div>
                )}

                <div className="grid gap-3">
                  <label className="block">
                    <span className="form-label">Transfer time</span>
                    <input
                      className="form-input h-10"
                      type="datetime-local"
                      value={form.transferAt}
                      onChange={(event) => setForm((current) => ({ ...current, transferAt: event.target.value }))}
                    />
                  </label>
                  <label className="block">
                    <span className="form-label">Sender / account name</span>
                    <input
                      className="form-input h-10"
                      value={form.senderName}
                      onChange={(event) => setForm((current) => ({ ...current, senderName: event.target.value }))}
                      placeholder="Optional"
                    />
                  </label>
                  <label className="block">
                    <span className="form-label">Reference no.</span>
                    <input
                      className="form-input h-10"
                      value={form.bankRef}
                      onChange={(event) => setForm((current) => ({ ...current, bankRef: event.target.value }))}
                      placeholder="Bank ref / slip no."
                    />
                  </label>
                  <label className="block">
                    <span className="form-label">Additional note</span>
                    <textarea
                      className="form-input min-h-[76px] resize-y py-2"
                      value={form.note}
                      onChange={(event) => setForm((current) => ({ ...current, note: event.target.value }))}
                      placeholder="Optional context"
                    />
                  </label>
                </div>

                <div className="mt-5 border-t border-[var(--border-default)] pt-4">
                  <div className="mb-3 rounded-md border border-sky-200 bg-sky-50 px-3 py-2 text-xs font-semibold text-sky-800 dark:border-sky-500/30 dark:bg-sky-500/15 dark:text-sky-200">
                    Selecting rows from another transfer group will merge them here and archive the old group header. Folio amounts stay unchanged.
                  </div>

                  <div className="mb-3 flex items-center justify-between gap-2">
                    <div>
                      <div className="text-sm font-black text-[var(--text-primary)]">Linked folio rows</div>
                      <div className="text-xs text-[var(--text-secondary)]">{selectedPaymentIds.length} selected</div>
                    </div>
                    <button type="button" className="text-xs font-bold text-[var(--text-secondary)] hover:text-[var(--text-primary)]" onClick={() => setSelectedPaymentIds([])}>
                      Clear
                    </button>
                  </div>

                  <div className="mb-2 grid grid-cols-2 gap-2">
                    <button type="button" className="btn btn-secondary h-8 text-xs" onClick={selectVisibleCandidates}>
                      Select visible
                    </button>
                    <button type="button" className="btn btn-secondary h-8 text-xs" onClick={selectSameGroup}>
                      Same group
                    </button>
                    <button type="button" className="btn btn-secondary h-8 text-xs" onClick={selectSameGroupName}>
                      Same group name
                    </button>
                    <button type="button" className="btn btn-secondary h-8 text-xs" onClick={() => setCandidateQuery(compactJoin(selectedRow.group_names.length ? selectedRow.group_names : selectedRow.guest_names, ""))}>
                      Focus name
                    </button>
                  </div>

                  <div className="relative mb-3">
                    <Search className="pointer-events-none absolute left-2.5 top-2.5 h-4 w-4 text-[var(--text-muted)]" />
                    <input
                      className="form-input h-9 pl-8"
                      type="search"
                      value={candidateQuery}
                      onChange={(event) => setCandidateQuery(event.target.value)}
                      placeholder="Booking, guest, room, group"
                    />
                  </div>

                  <div className="max-h-[420px] space-y-2 overflow-y-auto pr-1">
                    {drawerCandidates.map((candidate) => {
                      const checked = selectedPaymentIds.includes(candidate.id);
                      const disabled = !isCandidateSelectable(candidate, selectedRow);
                      return (
                        <label
                          key={candidate.id}
                          className={`flex cursor-pointer gap-3 rounded-md border px-3 py-2 transition-colors ${
                            checked
                              ? "border-sky-300 bg-sky-50 dark:border-sky-500/30 dark:bg-sky-500/15"
                              : "border-[var(--border-default)] bg-[var(--bg-body)] hover:bg-[var(--bg-surface-hover)]"
                          } ${disabled ? "cursor-not-allowed opacity-50" : ""}`}
                        >
                          <input
                            type="checkbox"
                            className="mt-1 h-4 w-4"
                            checked={checked}
                            disabled={disabled}
                            onChange={() => togglePayment(candidate)}
                          />
                          <div className="min-w-0 flex-1">
                            <div className="flex items-start justify-between gap-2">
                              <div className="min-w-0">
                                <div className="truncate text-sm font-bold text-[var(--text-primary)]">{candidateLabel(candidate)}</div>
                                <div className="truncate text-xs text-[var(--text-secondary)]">
                                  {candidate.guest_name || "Guest"} · {candidate.group_name || candidate.group_code || "No group"}
                                </div>
                              </div>
                              <div className="whitespace-nowrap text-right font-mono text-sm font-black text-[var(--text-primary)]">
                                ฿{formatMoney(candidate.amount)}
                              </div>
                            </div>
                            <div className="mt-1 flex items-center justify-between gap-2 text-[11px] text-[var(--text-muted)]">
                              <span className="truncate">{candidate.note || "-"}</span>
                              {candidate.transfer_event_id && candidate.transfer_event_id !== selectedRow.transfer_event_id && (
                                <span className="shrink-0 rounded bg-slate-100 px-1.5 py-0.5 font-bold text-slate-600 dark:bg-slate-800 dark:text-slate-300">
                                  Merge
                                </span>
                              )}
                            </div>
                          </div>
                        </label>
                      );
                    })}
                  </div>
                </div>
              </div>

              <div className="border-t border-[var(--border-default)] px-5 py-4">
                <div className="mb-3 flex items-center justify-between text-sm">
                  <span className="font-bold text-[var(--text-secondary)]">Selected total</span>
                  <span className="font-mono text-lg font-black text-[var(--text-primary)]">฿{formatMoney(selectedTotal)}</span>
                </div>
                <div className="flex gap-2">
                  <button
                    type="button"
                    className="btn btn-primary h-10 flex-1"
                    onClick={() => void saveGroup()}
                    disabled={saving || selectedPaymentIds.length === 0}
                  >
                    {saving ? <RefreshCw className="h-4 w-4 animate-spin" /> : <CheckCircle2 className="h-4 w-4" />}
                    {selectedRow.kind === "grouped" ? "Save / Merge Group" : "Create / Merge Group"}
                  </button>
                  <button
                    type="button"
                    className="btn btn-secondary h-10"
                    onClick={() => setSelectedRowId(null)}
                    disabled={saving}
                  >
                    <XCircle className="h-4 w-4" />
                    Close
                  </button>
                </div>
              </div>
            </div>
          )}
        </aside>
      </div>
    </div>
  );
}
