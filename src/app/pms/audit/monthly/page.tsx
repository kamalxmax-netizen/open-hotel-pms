"use client";

import React, { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";

// ============================================================
// Types
// ============================================================

type AuditPeriod = {
  id: string;
  year: number;
  month: number;
  status: "open" | "reviewing" | "audited" | "locked";
  closed_at: string | null;
  audited_at: string | null;
};

type AuditCorrection = {
  id: string;
  entry_id: string;
  field_name: string;
  old_value: string | null;
  new_value: string | null;
  reason: string | null;
  corrected_by: string | null;
  corrected_at: string;
};

type AuditEntry = {
  id: string;
  period_id: string;
  reservation_id: string;
  booking_code: string | null;
  guest_name: string;
  source: string;
  checkin_date: string;
  checkout_date: string;
  room_number: string | null;
  room_type_name: string | null;
  total_nights: number;
  room_revenue: number;
  extra_revenue: number;
  pos_revenue: number;
  total_revenue: number;
  paid_cash: number;
  paid_transfer: number;
  paid_credit_card: number;
  paid_other: number;
  total_paid: number;
  refund_total: number;
  outstanding: number;
  tax_invoice_requested: boolean;
  tax_invoice_name: string | null;
  tax_id: string | null;
  nationality: string | null;
  passport_number: string | null;
  id_card_number: string | null;
  guest_count: number;
  corrections?: AuditCorrection[];
};

type SourceSummary = {
  count: number;
  room_revenue: number;
  extra_revenue: number;
  pos_revenue: number;
  total_revenue: number;
  paid_cash: number;
  paid_transfer: number;
  paid_credit_card: number;
  paid_other: number;
  total_paid: number;
  refund_total: number;
  outstanding: number;
  tax_invoice_count: number;
};

type AuditSummary = {
  total_reservations: number;
  by_source: Record<string, SourceSummary>;
  totals: SourceSummary;
};

// ============================================================
// Helpers
// ============================================================

const MONTHS = [
  "มกราคม", "กุมภาพันธ์", "มีนาคม", "เมษายน", "พฤษภาคม", "มิถุนายน",
  "กรกฎาคม", "สิงหาคม", "กันยายน", "ตุลาคม", "พฤศจิกายน", "ธันวาคม",
];

const STATUS_BADGE: Record<string, { label: string; className: string }> = {
  open: { label: "Open", className: "bg-gray-100 text-gray-700 dark:bg-gray-800 dark:text-gray-300" },
  reviewing: { label: "Reviewing", className: "bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300" },
  audited: { label: "Audited", className: "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300" },
  locked: { label: "Locked", className: "bg-purple-100 text-purple-700 dark:bg-purple-900/40 dark:text-purple-300" },
};

const SOURCE_LABELS: Record<string, string> = {
  ota: "OTA",
  walkin: "Walk-in",
  direct: "Direct",
  agent: "Agent",
};

function fmt(n: number): string {
  return n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function fmtDate(dateStr: string): string {
  if (!dateStr) return "-";
  const d = new Date(dateStr + "T00:00:00");
  return d.toLocaleDateString("th-TH", { day: "2-digit", month: "2-digit" });
}

function getBangkokNow(): { year: number; month: number } {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Bangkok",
    year: "numeric",
    month: "2-digit",
  }).formatToParts(new Date());
  const y = Number(parts.find((p) => p.type === "year")?.value ?? new Date().getFullYear());
  const m = Number(parts.find((p) => p.type === "month")?.value ?? new Date().getMonth() + 1);
  return { year: y, month: m };
}

// ============================================================
// Component
// ============================================================

export default function MonthlyAuditPage() {
  const now = getBangkokNow();
  // Default to previous month
  const defaultMonth = now.month === 1 ? 12 : now.month - 1;
  const defaultYear = now.month === 1 ? now.year - 1 : now.year;

  const [selectedYear, setSelectedYear] = useState(defaultYear);
  const [selectedMonth, setSelectedMonth] = useState(defaultMonth);
  const [period, setPeriod] = useState<AuditPeriod | null>(null);
  const [entries, setEntries] = useState<AuditEntry[]>([]);
  const [summary, setSummary] = useState<AuditSummary | null>(null);
  const [availableSources, setAvailableSources] = useState<string[]>([]);
  const [previewEnabled, setPreviewEnabled] = useState(false);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [previewEntries, setPreviewEntries] = useState<AuditEntry[]>([]);
  const [previewSummary, setPreviewSummary] = useState<AuditSummary | null>(null);
  const [previewSources, setPreviewSources] = useState<string[]>([]);
  const [previewGeneratedAt, setPreviewGeneratedAt] = useState<string | null>(null);

  // Filters
  const [sourceFilter, setSourceFilter] = useState("all");
  const [taxFilter, setTaxFilter] = useState("all");
  const [correctionFilter, setCorrectionFilter] = useState("all");
  const [search, setSearch] = useState("");

  // UI state
  const [loading, setLoading] = useState(false);
  const [closing, setClosing] = useState(false);
  const [approving, setApproving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [editingEntry, setEditingEntry] = useState<AuditEntry | null>(null);
  const [expandedRow, setExpandedRow] = useState<string | null>(null);

  // Correction form
  const [corrFieldName, setCorrFieldName] = useState("");
  const [corrNewValue, setCorrNewValue] = useState("");
  const [corrReason, setCorrReason] = useState("");
  const [corrSubmitting, setCorrSubmitting] = useState(false);

  // ============================================================
  // Load data
  // ============================================================

  const loadPeriodData = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams();
      if (sourceFilter !== "all") params.set("source", sourceFilter);
      if (taxFilter !== "all") params.set("tax_invoice", taxFilter);
      if (correctionFilter !== "all") params.set("has_corrections", correctionFilter);
      if (search.trim()) params.set("search", search.trim());

      const res = await fetch(
        `/api/audit/monthly/${selectedYear}/${selectedMonth}?${params.toString()}`
      );
      const json = await res.json();

      if (!json.success) {
        if (res.status === 404) {
          setPeriod(null);
          setEntries([]);
          setSummary(null);
          setAvailableSources([]);
          return;
        }
        throw new Error(json.error ?? "Failed to load");
      }

      setPeriod(json.period ?? null);
      setEntries(json.entries ?? []);
      setSummary(json.summary ?? null);
      setAvailableSources(json.filters?.available_sources ?? []);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load data");
    } finally {
      setLoading(false);
    }
  }, [selectedYear, selectedMonth, sourceFilter, taxFilter, correctionFilter, search]);

  const loadPreviewData = useCallback(async () => {
    setPreviewLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams();
      params.set("year", String(selectedYear));
      params.set("month", String(selectedMonth));
      if (sourceFilter !== "all") params.set("source", sourceFilter);
      if (taxFilter !== "all") params.set("tax_invoice", taxFilter);
      if (correctionFilter !== "all") params.set("has_corrections", correctionFilter);
      if (search.trim()) params.set("search", search.trim());

      const res = await fetch(`/api/audit/monthly/preview?${params.toString()}`);
      const json = await res.json();
      if (!json.success) throw new Error(json.error ?? "Failed to load preview");

      setPreviewEnabled(true);
      setPreviewEntries(json.entries ?? []);
      setPreviewSummary(json.summary ?? null);
      setPreviewSources(json.filters?.available_sources ?? []);
      setPreviewGeneratedAt(typeof json.generated_at === "string" ? json.generated_at : null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load preview");
    } finally {
      setPreviewLoading(false);
    }
  }, [selectedYear, selectedMonth, sourceFilter, taxFilter, correctionFilter, search]);

  useEffect(() => {
    if (previewEnabled) {
      void loadPreviewData();
      return;
    }
    void loadPeriodData();
  }, [previewEnabled, loadPreviewData, loadPeriodData]);

  // ============================================================
  // Actions
  // ============================================================

  const handleCloseMonth = async () => {
    if (!confirm(`Close month ${MONTHS[selectedMonth - 1]} ${selectedYear}?\n\nThis will generate a snapshot of all checked-out reservations.`)) return;
    setClosing(true);
    setError(null);
    try {
      const res = await fetch("/api/audit/monthly", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ year: selectedYear, month: selectedMonth }),
      });
      const json = await res.json();
      if (!json.success) throw new Error(json.error);
      setPreviewEnabled(false);
      setPreviewEntries([]);
      setPreviewSummary(null);
      setPreviewSources([]);
      setPreviewGeneratedAt(null);
      await loadPeriodData();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to close month");
    } finally {
      setClosing(false);
    }
  };

  const handleApprove = async () => {
    if (!confirm(`Approve audit for ${MONTHS[selectedMonth - 1]} ${selectedYear}?\n\nThis will lock corrections and mark as audited.`)) return;
    setApproving(true);
    setError(null);
    try {
      const res = await fetch(`/api/audit/monthly/${selectedYear}/${selectedMonth}/approve`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "approve" }),
      });
      const json = await res.json();
      if (!json.success) throw new Error(json.error);
      await loadPeriodData();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to approve");
    } finally {
      setApproving(false);
    }
  };

  const handleReopen = async () => {
    if (!confirm("Reopen this month for corrections?")) return;
    try {
      const res = await fetch(`/api/audit/monthly/${selectedYear}/${selectedMonth}/approve`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "reopen" }),
      });
      const json = await res.json();
      if (!json.success) throw new Error(json.error);
      await loadPeriodData();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to reopen");
    }
  };

  const handleExportCSV = () => {
    const params = new URLSearchParams();
    params.set("format", "csv");
    if (sourceFilter !== "all") params.set("source", sourceFilter);
    if (taxFilter !== "all") params.set("tax_invoice", taxFilter);
    window.open(`/api/audit/monthly/${selectedYear}/${selectedMonth}/export?${params.toString()}`, "_blank");
  };

  const handleSubmitCorrection = async () => {
    if (!editingEntry || !corrFieldName || !corrNewValue) return;
    setCorrSubmitting(true);
    try {
      const res = await fetch(`/api/audit/monthly/${selectedYear}/${selectedMonth}/correct`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          entry_id: editingEntry.id,
          corrections: [
            {
              field_name: corrFieldName,
              new_value: corrNewValue,
              reason: corrReason || undefined,
            },
          ],
        }),
      });
      const json = await res.json();
      if (!json.success) throw new Error(json.error);
      setEditingEntry(null);
      setCorrFieldName("");
      setCorrNewValue("");
      setCorrReason("");
      await loadPeriodData();
    } catch (err) {
      alert(err instanceof Error ? err.message : "Correction failed");
    } finally {
      setCorrSubmitting(false);
    }
  };

  // ============================================================
  // Derived
  // ============================================================

  const statusBadge = period ? STATUS_BADGE[period.status] ?? STATUS_BADGE.open : null;
  const canCorrect = period?.status === "reviewing";
  const canApprove = period?.status === "reviewing";
  const canExport = period?.status === "audited" || period?.status === "locked";
  const canReopen = period?.status === "audited";
  const isPreviewMode = previewEnabled;
  const displayedEntries = isPreviewMode ? previewEntries : entries;
  const displayedSummary = isPreviewMode ? previewSummary : summary;
  const displayedSources = isPreviewMode ? previewSources : availableSources;

  const yearOptions = useMemo(() => {
    const years: number[] = [];
    for (let y = 2025; y <= now.year + 1; y++) years.push(y);
    return years;
  }, [now.year]);

  // ============================================================
  // Render
  // ============================================================

  return (
    <div className="mx-auto max-w-[1400px] space-y-4 p-4">
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <div className="flex items-center gap-2">
            <Link
              href="/pms/audit"
              className="text-sm text-[var(--text-muted)] hover:text-[var(--text-primary)] transition-colors"
            >
              Audit Explorer
            </Link>
            <span className="text-[var(--text-muted)]">/</span>
            <h1 className="text-xl font-bold text-[var(--text-primary)]">Monthly Audit</h1>
          </div>
          <p className="text-sm text-[var(--text-muted)] mt-0.5">
            Reconcile revenue, corrections, and tax invoices
          </p>
        </div>

        <div className="flex items-center gap-2">
          <select
            className="rounded border border-[var(--border)] bg-[var(--bg-surface)] px-2 py-1.5 text-sm text-[var(--text-primary)]"
            value={selectedYear}
            onChange={(e) => setSelectedYear(Number(e.target.value))}
          >
            {yearOptions.map((y) => (
              <option key={y} value={y}>{y}</option>
            ))}
          </select>
          <select
            className="rounded border border-[var(--border)] bg-[var(--bg-surface)] px-2 py-1.5 text-sm text-[var(--text-primary)]"
            value={selectedMonth}
            onChange={(e) => setSelectedMonth(Number(e.target.value))}
          >
            {MONTHS.map((label, idx) => (
              <option key={idx} value={idx + 1}>{label}</option>
            ))}
          </select>

          {statusBadge && (
            <span className={`rounded-full px-2.5 py-0.5 text-xs font-medium ${statusBadge.className}`}>
              {statusBadge.label}
            </span>
          )}
        </div>
      </div>

      {/* Error */}
      {error && (
        <div className="rounded-lg border border-rose-200 bg-rose-50 p-3 text-sm text-rose-700 dark:border-rose-800 dark:bg-rose-900/30 dark:text-rose-300">
          {error}
        </div>
      )}

      {/* Action buttons */}
      <div className="flex flex-wrap items-center gap-2">
        <button
          onClick={() => void loadPreviewData()}
          disabled={previewLoading}
          className="rounded-lg border border-[var(--border)] bg-[var(--bg-surface)] px-4 py-2 text-sm font-medium text-[var(--text-primary)] hover:bg-[var(--bg-surface-hover)] disabled:opacity-50 transition-colors"
        >
          {previewLoading ? "Loading Preview..." : previewEnabled ? "Refresh Preview" : "Preview (Live)"}
        </button>
        {previewEnabled && (
          <button
            onClick={() => setPreviewEnabled(false)}
            className="rounded-lg border border-[var(--border)] bg-[var(--bg-surface)] px-4 py-2 text-sm font-medium text-[var(--text-primary)] hover:bg-[var(--bg-surface-hover)] transition-colors"
          >
            Back to Snapshot
          </button>
        )}
        {(!period || period.status === "reviewing") && (
          <button
            onClick={handleCloseMonth}
            disabled={closing}
            className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50 transition-colors"
          >
            {closing ? "Generating..." : period ? "Re-generate Snapshot" : `Generate Snapshot (${MONTHS[selectedMonth - 1]})`}
          </button>
        )}
        {canApprove && (
          <button
            onClick={handleApprove}
            disabled={approving}
            className="rounded-lg bg-emerald-600 px-4 py-2 text-sm font-medium text-white hover:bg-emerald-700 disabled:opacity-50 transition-colors"
          >
            {approving ? "Approving..." : "Approve Audit"}
          </button>
        )}
        {canReopen && (
          <button
            onClick={handleReopen}
            className="rounded-lg border border-amber-300 bg-amber-50 px-4 py-2 text-sm font-medium text-amber-700 hover:bg-amber-100 dark:border-amber-700 dark:bg-amber-900/30 dark:text-amber-300 transition-colors"
          >
            Reopen for Review
          </button>
        )}
        {canExport && (
          <button
            onClick={handleExportCSV}
            className="rounded-lg border border-[var(--border)] bg-[var(--bg-surface)] px-4 py-2 text-sm font-medium text-[var(--text-primary)] hover:bg-[var(--bg-surface-hover)] transition-colors"
          >
            Export CSV
          </button>
        )}
      </div>

      {isPreviewMode && (
        <div className="rounded-lg border border-blue-200 bg-blue-50 p-3 text-sm text-blue-700 dark:border-blue-800 dark:bg-blue-900/30 dark:text-blue-300">
          Preview mode: ข้อมูลนี้เป็นยอดสดจากระบบ ยังไม่ได้ freeze เดือน
          {previewGeneratedAt ? ` (refresh ${new Date(previewGeneratedAt).toLocaleString("th-TH", { timeZone: "Asia/Bangkok" })})` : ""}
        </div>
      )}

      {/* Filters */}
      {(period || isPreviewMode) && displayedEntries.length > 0 && (
        <div className="flex flex-wrap items-center gap-2 rounded-lg border border-[var(--border)] bg-[var(--bg-surface)] p-3">
          <select
            className="rounded border border-[var(--border)] bg-[var(--bg-primary)] px-2 py-1 text-sm text-[var(--text-primary)]"
            value={sourceFilter}
            onChange={(e) => setSourceFilter(e.target.value)}
          >
            <option value="all">All Sources</option>
            {displayedSources.map((s) => (
              <option key={s} value={s}>{SOURCE_LABELS[s] ?? s}</option>
            ))}
          </select>

          <select
            className="rounded border border-[var(--border)] bg-[var(--bg-primary)] px-2 py-1 text-sm text-[var(--text-primary)]"
            value={taxFilter}
            onChange={(e) => setTaxFilter(e.target.value)}
          >
            <option value="all">Tax Invoice: All</option>
            <option value="true">Requested</option>
            <option value="false">Not Requested</option>
          </select>

          <select
            className="rounded border border-[var(--border)] bg-[var(--bg-primary)] px-2 py-1 text-sm text-[var(--text-primary)]"
            value={correctionFilter}
            onChange={(e) => setCorrectionFilter(e.target.value)}
          >
            <option value="all">Corrections: All</option>
            <option value="true">Corrected</option>
            <option value="false">Original</option>
          </select>

          <input
            type="text"
            placeholder="Search guest, booking, room..."
            className="rounded border border-[var(--border)] bg-[var(--bg-primary)] px-2 py-1 text-sm text-[var(--text-primary)] placeholder:text-[var(--text-muted)] w-56"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
      )}

      {/* Loading */}
      {(loading || previewLoading) && (
        <div className="py-12 text-center text-sm text-[var(--text-muted)]">Loading...</div>
      )}

      {/* No period */}
      {!loading && !previewLoading && !period && !previewEnabled && (
        <div className="rounded-lg border border-[var(--border)] bg-[var(--bg-surface)] p-12 text-center">
          <p className="text-[var(--text-muted)]">
            No audit data for {MONTHS[selectedMonth - 1]} {selectedYear}
          </p>
          <p className="text-sm text-[var(--text-muted)] mt-1">
            กด Preview เพื่อดูยอดสดก่อน หรือกด Generate Snapshot เพื่อ freeze เดือน
          </p>
        </div>
      )}

      {!loading && !previewLoading && isPreviewMode && displayedEntries.length === 0 && (
        <div className="rounded-lg border border-[var(--border)] bg-[var(--bg-surface)] p-12 text-center">
          <p className="text-[var(--text-muted)]">
            Preview: ยังไม่มี checked-out reservations สำหรับ {MONTHS[selectedMonth - 1]} {selectedYear}
          </p>
        </div>
      )}

      {/* Summary */}
      {!loading && !previewLoading && displayedSummary && (
        <div className="rounded-lg border border-[var(--border)] bg-[var(--bg-surface)] overflow-hidden">
          <div className="p-3 border-b border-[var(--border)]">
            <h2 className="text-sm font-semibold text-[var(--text-primary)]">
              Summary — {displayedSummary.total_reservations} reservations
            </h2>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b border-[var(--border)] bg-[var(--bg-muted)]">
                  <th className="p-2 text-left font-semibold text-[var(--text-muted)]">Source</th>
                  <th className="p-2 text-right font-semibold text-[var(--text-muted)]">Count</th>
                  <th className="p-2 text-right font-semibold text-[var(--text-muted)]">Revenue</th>
                  <th className="p-2 text-right font-semibold text-[var(--text-muted)]">Cash</th>
                  <th className="p-2 text-right font-semibold text-[var(--text-muted)]">Transfer</th>
                  <th className="p-2 text-right font-semibold text-[var(--text-muted)]">Credit</th>
                  <th className="p-2 text-right font-semibold text-[var(--text-muted)]">Other</th>
                  <th className="p-2 text-right font-semibold text-[var(--text-muted)]">Total Paid</th>
                  <th className="p-2 text-right font-semibold text-[var(--text-muted)]">Refund</th>
                  <th className="p-2 text-right font-semibold text-[var(--text-muted)]">Outstanding</th>
                  <th className="p-2 text-right font-semibold text-[var(--text-muted)]">Tax Inv.</th>
                </tr>
              </thead>
              <tbody>
                {Object.entries(displayedSummary.by_source)
                  .sort(([a], [b]) => a.localeCompare(b))
                  .map(([source, s]) => (
                    <tr key={source} className="border-b border-[var(--border)] hover:bg-[var(--bg-muted)]">
                      <td className="p-2 font-medium text-[var(--text-primary)]">{SOURCE_LABELS[source] ?? source}</td>
                      <td className="p-2 text-right text-[var(--text-secondary)]">{s.count}</td>
                      <td className="p-2 text-right font-mono text-[var(--text-primary)]">{fmt(s.total_revenue)}</td>
                      <td className="p-2 text-right font-mono text-[var(--text-secondary)]">{fmt(s.paid_cash)}</td>
                      <td className="p-2 text-right font-mono text-[var(--text-secondary)]">{fmt(s.paid_transfer)}</td>
                      <td className="p-2 text-right font-mono text-[var(--text-secondary)]">{fmt(s.paid_credit_card)}</td>
                      <td className="p-2 text-right font-mono text-[var(--text-secondary)]">{fmt(s.paid_other)}</td>
                      <td className="p-2 text-right font-mono text-[var(--text-primary)]">{fmt(s.total_paid)}</td>
                      <td className="p-2 text-right font-mono text-rose-600">{s.refund_total > 0 ? `-${fmt(s.refund_total)}` : "-"}</td>
                      <td className={`p-2 text-right font-mono ${s.outstanding > 0 ? "text-amber-600 font-semibold" : "text-[var(--text-muted)]"}`}>
                        {s.outstanding !== 0 ? fmt(s.outstanding) : "-"}
                      </td>
                      <td className="p-2 text-right text-[var(--text-secondary)]">{s.tax_invoice_count || "-"}</td>
                    </tr>
                  ))}
                {/* Totals row */}
                <tr className="bg-[var(--bg-muted)] font-semibold">
                  <td className="p-2 text-[var(--text-primary)]">Total</td>
                  <td className="p-2 text-right text-[var(--text-primary)]">{displayedSummary.totals.count}</td>
                  <td className="p-2 text-right font-mono text-[var(--text-primary)]">{fmt(displayedSummary.totals.total_revenue)}</td>
                  <td className="p-2 text-right font-mono text-[var(--text-primary)]">{fmt(displayedSummary.totals.paid_cash)}</td>
                  <td className="p-2 text-right font-mono text-[var(--text-primary)]">{fmt(displayedSummary.totals.paid_transfer)}</td>
                  <td className="p-2 text-right font-mono text-[var(--text-primary)]">{fmt(displayedSummary.totals.paid_credit_card)}</td>
                  <td className="p-2 text-right font-mono text-[var(--text-primary)]">{fmt(displayedSummary.totals.paid_other)}</td>
                  <td className="p-2 text-right font-mono text-[var(--text-primary)]">{fmt(displayedSummary.totals.total_paid)}</td>
                  <td className="p-2 text-right font-mono text-rose-600">{displayedSummary.totals.refund_total > 0 ? `-${fmt(displayedSummary.totals.refund_total)}` : "-"}</td>
                  <td className={`p-2 text-right font-mono ${displayedSummary.totals.outstanding > 0 ? "text-amber-600" : "text-[var(--text-muted)]"}`}>
                    {displayedSummary.totals.outstanding !== 0 ? fmt(displayedSummary.totals.outstanding) : "-"}
                  </td>
                  <td className="p-2 text-right text-[var(--text-primary)]">{displayedSummary.totals.tax_invoice_count || "-"}</td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Entries table */}
      {!loading && !previewLoading && displayedEntries.length > 0 && (
        <div className="rounded-lg border border-[var(--border)] bg-[var(--bg-surface)] overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b border-[var(--border)] bg-[var(--bg-muted)]">
                  <th className="p-2 text-left font-semibold text-[var(--text-muted)]">Booking</th>
                  <th className="p-2 text-left font-semibold text-[var(--text-muted)]">Guest</th>
                  <th className="p-2 text-left font-semibold text-[var(--text-muted)]">Source</th>
                  <th className="p-2 text-left font-semibold text-[var(--text-muted)]">Room</th>
                  <th className="p-2 text-center font-semibold text-[var(--text-muted)]">In/Out</th>
                  <th className="p-2 text-right font-semibold text-[var(--text-muted)]">Room</th>
                  <th className="p-2 text-right font-semibold text-[var(--text-muted)]">Extra</th>
                  <th className="p-2 text-right font-semibold text-[var(--text-muted)]">POS</th>
                  <th className="p-2 text-right font-semibold text-[var(--text-muted)]">Revenue</th>
                  <th className="p-2 text-right font-semibold text-[var(--text-muted)]">Cash</th>
                  <th className="p-2 text-right font-semibold text-[var(--text-muted)]">Transfer</th>
                  <th className="p-2 text-right font-semibold text-[var(--text-muted)]">Credit</th>
                  <th className="p-2 text-right font-semibold text-[var(--text-muted)]">Paid</th>
                  <th className="p-2 text-right font-semibold text-[var(--text-muted)]">Balance</th>
                  <th className="p-2 text-center font-semibold text-[var(--text-muted)]">Tax</th>
                  {canCorrect && <th className="p-2 text-center font-semibold text-[var(--text-muted)]">Edit</th>}
                </tr>
              </thead>
              <tbody>
                {displayedEntries.map((entry) => {
                  const hasCorrected = (entry.corrections?.length ?? 0) > 0;
                  const isExpanded = expandedRow === entry.id;

                  return (
                    <React.Fragment key={entry.id}>
                      <tr
                        className={`border-b border-[var(--border)] hover:bg-[var(--bg-muted)] cursor-pointer ${hasCorrected ? "bg-amber-50/50 dark:bg-amber-900/10" : ""}`}
                        onClick={() => setExpandedRow(isExpanded ? null : entry.id)}
                      >
                        <td className="p-2 font-mono text-[var(--text-secondary)]">{entry.booking_code ?? "-"}</td>
                        <td className="p-2 text-[var(--text-primary)] max-w-[140px] truncate" title={entry.guest_name}>
                          {entry.guest_name}
                          {hasCorrected && <span className="ml-1 text-amber-500" title="Corrected">*</span>}
                        </td>
                        <td className="p-2">
                          <span className={`inline-block rounded px-1.5 py-0.5 text-[10px] font-medium ${
                            entry.source === "ota" ? "bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300"
                            : entry.source === "walkin" ? "bg-green-100 text-green-700 dark:bg-green-900/40 dark:text-green-300"
                            : entry.source === "direct" ? "bg-purple-100 text-purple-700 dark:bg-purple-900/40 dark:text-purple-300"
                            : "bg-gray-100 text-gray-700 dark:bg-gray-800 dark:text-gray-300"
                          }`}>
                            {SOURCE_LABELS[entry.source] ?? entry.source}
                          </span>
                        </td>
                        <td className="p-2 text-[var(--text-secondary)]">{entry.room_number ?? "-"}</td>
                        <td className="p-2 text-center text-[var(--text-muted)]">
                          {fmtDate(entry.checkin_date)}-{fmtDate(entry.checkout_date)}
                        </td>
                        <td className="p-2 text-right font-mono text-[var(--text-secondary)]">{fmt(entry.room_revenue)}</td>
                        <td className="p-2 text-right font-mono text-[var(--text-secondary)]">{entry.extra_revenue > 0 ? fmt(entry.extra_revenue) : "-"}</td>
                        <td className="p-2 text-right font-mono text-[var(--text-secondary)]">{entry.pos_revenue > 0 ? fmt(entry.pos_revenue) : "-"}</td>
                        <td className="p-2 text-right font-mono font-medium text-[var(--text-primary)]">{fmt(entry.total_revenue)}</td>
                        <td className="p-2 text-right font-mono text-[var(--text-secondary)]">{entry.paid_cash > 0 ? fmt(entry.paid_cash) : "-"}</td>
                        <td className="p-2 text-right font-mono text-[var(--text-secondary)]">{entry.paid_transfer > 0 ? fmt(entry.paid_transfer) : "-"}</td>
                        <td className="p-2 text-right font-mono text-[var(--text-secondary)]">{entry.paid_credit_card > 0 ? fmt(entry.paid_credit_card) : "-"}</td>
                        <td className="p-2 text-right font-mono text-[var(--text-primary)]">{fmt(entry.total_paid)}</td>
                        <td className={`p-2 text-right font-mono ${entry.outstanding > 0 ? "text-amber-600 font-semibold" : entry.outstanding < 0 ? "text-rose-600" : "text-[var(--text-muted)]"}`}>
                          {entry.outstanding !== 0 ? fmt(entry.outstanding) : "-"}
                        </td>
                        <td className="p-2 text-center">
                          {entry.tax_invoice_requested ? (
                            <span className="text-emerald-600" title="Tax invoice requested">&#10003;</span>
                          ) : (
                            <span className="text-[var(--text-muted)]">-</span>
                          )}
                        </td>
                        {canCorrect && (
                          <td className="p-2 text-center">
                            <button
                              type="button"
                              className="text-blue-600 hover:text-blue-800 text-[10px] font-medium"
                              onClick={(e) => {
                                e.stopPropagation();
                                setEditingEntry(entry);
                                setCorrFieldName("guest_name");
                                setCorrNewValue(entry.guest_name);
                                setCorrReason("");
                              }}
                            >
                              Edit
                            </button>
                          </td>
                        )}
                      </tr>

                      {/* Expanded row — corrections history */}
                      {isExpanded && (entry.corrections?.length ?? 0) > 0 && (
                        <tr>
                          <td colSpan={canCorrect ? 16 : 15} className="p-0">
                            <div className="bg-amber-50/60 dark:bg-amber-900/10 border-b border-[var(--border)] px-4 py-2">
                              <p className="text-[10px] font-semibold text-amber-700 dark:text-amber-400 mb-1">Corrections</p>
                              <div className="space-y-1">
                                {(entry.corrections ?? []).map((c) => (
                                  <div key={c.id} className="flex items-center gap-2 text-[10px] text-[var(--text-secondary)]">
                                    <span className="font-medium text-[var(--text-primary)]">{c.field_name}</span>
                                    <span className="line-through text-rose-500">{c.old_value ?? "-"}</span>
                                    <span>&rarr;</span>
                                    <span className="font-medium text-emerald-600">{c.new_value ?? "-"}</span>
                                    {c.reason && <span className="text-[var(--text-muted)]">({c.reason})</span>}
                                    <span className="ml-auto text-[var(--text-muted)]">
                                      {new Date(c.corrected_at).toLocaleString("th-TH", { timeZone: "Asia/Bangkok", hour: "2-digit", minute: "2-digit", day: "2-digit", month: "2-digit" })}
                                    </span>
                                  </div>
                                ))}
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
        </div>
      )}

      {/* Correction modal */}
      {editingEntry && canCorrect && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
          <div className="w-full max-w-md rounded-xl border border-[var(--border)] bg-[var(--bg-primary)] p-6 shadow-xl">
            <h3 className="text-base font-semibold text-[var(--text-primary)] mb-1">
              Correct Entry
            </h3>
            <p className="text-xs text-[var(--text-muted)] mb-4">
              {editingEntry.booking_code} — {editingEntry.guest_name}
            </p>

            <div className="space-y-3">
              <div>
                <label className="block text-xs font-medium text-[var(--text-secondary)] mb-1">Field</label>
                <select
                  className="w-full rounded border border-[var(--border)] bg-[var(--bg-surface)] px-2 py-1.5 text-sm text-[var(--text-primary)]"
                  value={corrFieldName}
                  onChange={(e) => {
                    setCorrFieldName(e.target.value);
                    const key = e.target.value as keyof AuditEntry;
                    const val = editingEntry[key];
                    setCorrNewValue(val != null ? String(val) : "");
                  }}
                >
                  <optgroup label="Guest Info">
                    <option value="guest_name">Guest Name</option>
                    <option value="source">Source</option>
                    <option value="nationality">Nationality</option>
                    <option value="passport_number">Passport Number</option>
                    <option value="id_card_number">ID Card Number</option>
                    <option value="guest_count">Guest Count</option>
                  </optgroup>
                  <optgroup label="Revenue">
                    <option value="room_revenue">Room Revenue</option>
                    <option value="extra_revenue">Extra Revenue</option>
                    <option value="pos_revenue">POS Revenue</option>
                  </optgroup>
                  <optgroup label="Payments">
                    <option value="paid_cash">Cash</option>
                    <option value="paid_transfer">Transfer</option>
                    <option value="paid_credit_card">Credit Card</option>
                    <option value="paid_other">Other Payment</option>
                    <option value="refund_total">Refund Total</option>
                  </optgroup>
                  <optgroup label="Room">
                    <option value="room_number">Room Number</option>
                    <option value="room_type_name">Room Type</option>
                    <option value="total_nights">Total Nights</option>
                  </optgroup>
                  <optgroup label="Tax Invoice">
                    <option value="tax_invoice_requested">Tax Invoice Requested</option>
                    <option value="tax_invoice_name">Tax Invoice Name</option>
                    <option value="tax_id">Tax ID</option>
                  </optgroup>
                </select>
              </div>

              <div>
                <label className="block text-xs font-medium text-[var(--text-secondary)] mb-1">New Value</label>
                {corrFieldName === "tax_invoice_requested" ? (
                  <select
                    className="w-full rounded border border-[var(--border)] bg-[var(--bg-surface)] px-2 py-1.5 text-sm text-[var(--text-primary)]"
                    value={corrNewValue}
                    onChange={(e) => setCorrNewValue(e.target.value)}
                  >
                    <option value="true">Yes</option>
                    <option value="false">No</option>
                  </select>
                ) : corrFieldName === "source" ? (
                  <select
                    className="w-full rounded border border-[var(--border)] bg-[var(--bg-surface)] px-2 py-1.5 text-sm text-[var(--text-primary)]"
                    value={corrNewValue}
                    onChange={(e) => setCorrNewValue(e.target.value)}
                  >
                    <option value="ota">OTA</option>
                    <option value="walkin">Walk-in</option>
                    <option value="direct">Direct</option>
                    <option value="agent">Agent</option>
                  </select>
                ) : (
                  <input
                    type="text"
                    className="w-full rounded border border-[var(--border)] bg-[var(--bg-surface)] px-2 py-1.5 text-sm text-[var(--text-primary)]"
                    value={corrNewValue}
                    onChange={(e) => setCorrNewValue(e.target.value)}
                  />
                )}
              </div>

              <div>
                <label className="block text-xs font-medium text-[var(--text-secondary)] mb-1">Reason (optional)</label>
                <input
                  type="text"
                  placeholder="Why is this being corrected?"
                  className="w-full rounded border border-[var(--border)] bg-[var(--bg-surface)] px-2 py-1.5 text-sm text-[var(--text-primary)] placeholder:text-[var(--text-muted)]"
                  value={corrReason}
                  onChange={(e) => setCorrReason(e.target.value)}
                />
              </div>
            </div>

            <div className="mt-5 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setEditingEntry(null)}
                className="rounded-lg border border-[var(--border)] px-4 py-1.5 text-sm text-[var(--text-secondary)] hover:bg-[var(--bg-muted)] transition-colors"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleSubmitCorrection}
                disabled={corrSubmitting || !corrNewValue}
                className="rounded-lg bg-blue-600 px-4 py-1.5 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50 transition-colors"
              >
                {corrSubmitting ? "Saving..." : "Save Correction"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
