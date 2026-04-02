"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ArrowLeftRight, RefreshCw } from "lucide-react";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { ScbTransferFilters, type ScbTransferFiltersValue } from "@/components/scb/scb-transfer-filters";
import { ScbTransferTable, type ScbTransferTableRow } from "@/components/scb/scb-transfer-table";
import { ScbTransactionDetailDrawer } from "@/components/scb/scb-transaction-detail-drawer";
import { ScbUnmatchedResolveModal } from "@/components/scb/scb-unmatched-resolve-modal";

type TabKey = "pending" | "matched" | "unmatched" | "expired_failed" | "recheck_history";

function todayInBangkok(): string {
  const base = new Date(new Date().toLocaleString("en-US", { timeZone: "Asia/Bangkok" }));
  const yyyy = base.getFullYear();
  const mm = String(base.getMonth() + 1).padStart(2, "0");
  const dd = String(base.getDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}

const DEFAULT_FILTERS: ScbTransferFiltersValue = {
  from: todayInBangkok(),
  to: todayInBangkok(),
  amountMin: "",
  amountMax: "",
  channel: "all",
};

export default function ScbTransfersPage() {
  const [tab, setTab] = useState<TabKey>("pending");
  const [filters, setFilters] = useState<ScbTransferFiltersValue>(DEFAULT_FILTERS);
  const [rows, setRows] = useState<ScbTransferTableRow[]>([]);
  const [role, setRole] = useState<string | null>(null);
  const [counts, setCounts] = useState<{ pending: number; matched: number; unmatched: number; expired_failed: number }>({
    pending: 0,
    matched: 0,
    unmatched: 0,
    expired_failed: 0,
  });
  const [summary, setSummary] = useState({
    matched_today_count: 0,
    unmatched_count: 0,
    matched_today_amount: 0,
  });
  const [loading, setLoading] = useState(true);
  const [page, setPage] = useState(1);
  const [pageSize] = useState(30);
  const [total, setTotal] = useState(0);
  const [detailItem, setDetailItem] = useState<{ id: string; kind: "transaction" | "request" | "recheck" } | null>(null);
  const [resolveRow, setResolveRow] = useState<ScbTransferTableRow | null>(null);
  const [ignoreRow, setIgnoreRow] = useState<ScbTransferTableRow | null>(null);
  const [ignoreNote, setIgnoreNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const autoTabAdjustedRef = useRef(false);

  const fetchData = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const params = new URLSearchParams({
        tab,
        page: String(page),
        page_size: String(pageSize),
        channel: filters.channel,
      });
      if (filters.from) params.set("from", filters.from);
      if (filters.to) params.set("to", filters.to);
      if (filters.amountMin) params.set("amount_min", filters.amountMin);
      if (filters.amountMax) params.set("amount_max", filters.amountMax);

      params.set("_ts", String(Date.now()));
      const res = await fetch(`/api/integrations/scb/inbox?${params.toString()}`, {
        cache: "no-store",
      });
      const json = await res.json().catch(() => null);
      if (!res.ok || !json?.success) {
        throw new Error(json?.error || "Failed to load SCB transfer inbox.");
      }
      setRows(json.rows ?? []);
      setRole(json.role ?? null);
      setCounts(json.counts ?? { pending: 0, matched: 0, unmatched: 0, expired_failed: 0 });
      setSummary(json.summary ?? { matched_today_count: 0, unmatched_count: 0, matched_today_amount: 0 });
      setTotal(Number(json.pagination?.total ?? (json.rows ?? []).length));

      if (
        !autoTabAdjustedRef.current &&
        tab === "matched" &&
        (json.rows ?? []).length === 0 &&
        Number(json.counts?.pending ?? 0) > 0
      ) {
        autoTabAdjustedRef.current = true;
        setTab("pending");
        setPage(1);
      } else if (
        !autoTabAdjustedRef.current &&
        tab === "matched" &&
        (json.rows ?? []).length === 0 &&
        Number(json.counts?.expired_failed ?? 0) > 0
      ) {
        autoTabAdjustedRef.current = true;
        setTab("expired_failed");
        setPage(1);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load SCB transfer inbox.");
    } finally {
      setLoading(false);
    }
  }, [filters.amountMax, filters.amountMin, filters.channel, filters.from, filters.to, page, pageSize, tab]);

  useEffect(() => {
    void fetchData();
  }, [fetchData]);

  useEffect(() => {
    const refresh = () => {
      if (!document.hidden && !busy) {
        void fetchData();
      }
    };

    const interval = window.setInterval(refresh, 15000);
    window.addEventListener("focus", refresh);
    document.addEventListener("visibilitychange", refresh);

    return () => {
      window.clearInterval(interval);
      window.removeEventListener("focus", refresh);
      document.removeEventListener("visibilitychange", refresh);
    };
  }, [busy, fetchData]);

  const totalPages = Math.max(1, Math.ceil(total / pageSize));

  const tabs = useMemo(() => ([
    { key: "pending" as const, label: "Pending", count: counts.pending, alert: counts.pending > 0 },
    { key: "matched" as const, label: "Matched", count: counts.matched },
    { key: "unmatched" as const, label: "Unmatched", count: counts.unmatched, alert: counts.unmatched > 0 },
    { key: "expired_failed" as const, label: "Expired / Failed", count: counts.expired_failed },
    { key: "recheck_history" as const, label: "Recheck", count: 0 },
  ]), [counts]);

  const handleIgnore = async () => {
    if (!ignoreRow || !ignoreNote.trim()) return;
    setBusy(true);
    try {
      const res = await fetch(`/api/integrations/scb/inbox/${ignoreRow.id}/ignore`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ note: ignoreNote.trim() }),
      });
      const json = await res.json().catch(() => null);
      if (!res.ok || !json?.success) {
        throw new Error(json?.error || "Failed to ignore transaction.");
      }
      setIgnoreRow(null);
      setIgnoreNote("");
      await fetchData();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to ignore transaction.");
    } finally {
      setBusy(false);
    }
  };

  const handleRecheck = async (row: ScbTransferTableRow) => {
    setBusy(true);
    try {
      const requestRes = await fetch(`/api/integrations/scb/inbox/${row.id}?kind=${row.kind}&_ts=${Date.now()}`, {
        cache: "no-store",
      });
      const requestJson = await requestRes.json().catch(() => null);
      if (!requestRes.ok || !requestJson?.success) {
        throw new Error(requestJson?.error || "Failed to load request detail for recheck.");
      }
      const requestId = requestJson.detail?.request?.id;
      if (!requestId) {
        throw new Error("No request is linked to this item.");
      }

      const res = await fetch("/api/integrations/scb/inquiry", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        cache: "no-store",
        body: JSON.stringify({ request_id: requestId, source: "manual" }),
      });
      const json = await res.json().catch(() => null);
      if (!res.ok || !json?.success) {
        throw new Error(json?.error || "Failed to recheck request.");
      }
      await fetchData();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to recheck request.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="mx-auto flex w-full max-w-[90rem] flex-col gap-6 px-6 py-6">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="rounded-2xl bg-[var(--bg-surface)] p-3 shadow-sm ring-1 ring-[var(--border-default)]">
            <ArrowLeftRight className="h-6 w-6 text-brand-600" />
          </div>
          <div>
            <h1 className="text-2xl font-bold text-[var(--text-primary)]">SCB Transfer Inbox</h1>
            <p className="text-sm text-[var(--text-secondary)]">Audit trail, manual resolution, and recheck history</p>
          </div>
        </div>
        <button type="button" className="btn btn-secondary flex items-center gap-2" onClick={() => void fetchData()} disabled={loading || busy}>
          <RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} />
          Refresh
        </button>
      </div>

      <div className="flex flex-wrap gap-3">
        {tabs.map((entry) => (
          <button
            type="button"
            key={entry.key}
            className={`relative rounded-2xl border px-4 py-3 text-left transition ${tab === entry.key ? "border-brand-500 bg-brand-50 text-brand-700" : "border-[var(--border-default)] bg-[var(--bg-surface)]"}`}
            onClick={() => {
              setTab(entry.key);
              setPage(1);
            }}
          >
            <div className="text-xs font-black uppercase tracking-widest">{entry.label}</div>
            {entry.count > 0 && <div className="mt-1 text-lg font-black">{entry.count}</div>}
            {entry.alert && <span className="absolute right-3 top-3 h-2.5 w-2.5 rounded-full bg-rose-600" />}
          </button>
        ))}
      </div>

      <ScbTransferFilters
        value={filters}
        onChange={(next) => {
          setFilters((current) => ({ ...current, ...next }));
          setPage(1);
        }}
        onClear={() => {
          setFilters(DEFAULT_FILTERS);
          setPage(1);
        }}
      />

      <div className="grid gap-4 md:grid-cols-3">
        <div className="rounded-2xl border border-[var(--border-default)] bg-[var(--bg-surface)] p-5 shadow-sm">
          <div className="text-sm font-bold text-[var(--text-muted)]">วันนี้</div>
          <div className="mt-2 text-3xl font-black text-emerald-600">{summary.matched_today_count}</div>
          <div className="mt-1 text-sm text-[var(--text-secondary)]">matched</div>
        </div>
        <div className={`rounded-2xl border border-[var(--border-default)] bg-[var(--bg-surface)] p-5 shadow-sm ${summary.unmatched_count > 0 ? "animate-pulse" : ""}`}>
          <div className="text-sm font-bold text-[var(--text-muted)]">รอจับคู่</div>
          <div className="mt-2 text-3xl font-black text-amber-600">{summary.unmatched_count}</div>
          <div className="mt-1 text-sm text-[var(--text-secondary)]">unmatched</div>
        </div>
        <div className="rounded-2xl border border-[var(--border-default)] bg-[var(--bg-surface)] p-5 shadow-sm">
          <div className="text-sm font-bold text-[var(--text-muted)]">ยอดรวมวันนี้</div>
          <div className="mt-2 text-3xl font-black text-brand-600">
            ฿{Number(summary.matched_today_amount ?? 0).toLocaleString("th-TH", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
          </div>
        </div>
      </div>

      {error && (
        <div className="rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">
          {error}
        </div>
      )}

      {loading ? (
        <div className="rounded-2xl border border-[var(--border-default)] bg-[var(--bg-surface)] px-6 py-12 text-center text-sm text-[var(--text-muted)]">
          Loading SCB transfer inbox...
        </div>
      ) : (
        <ScbTransferTable
          tab={tab}
          role={role}
          rows={rows}
          onDetail={(row) => setDetailItem({ id: row.id, kind: row.kind })}
          onAssign={(row) => setResolveRow(row)}
          onIgnore={(row) => setIgnoreRow(row)}
          onRecheck={(row) => void handleRecheck(row)}
        />
      )}

      <div className="flex items-center justify-between text-sm text-[var(--text-secondary)]">
        <div>
          Showing {rows.length === 0 ? 0 : (page - 1) * pageSize + 1}–{Math.min(page * pageSize, total)} of {total}
        </div>
        <div className="flex items-center gap-2">
          <button type="button" className="btn btn-ghost btn-sm" disabled={page <= 1} onClick={() => setPage((current) => Math.max(1, current - 1))}>
            Prev
          </button>
          <span className="min-w-[72px] text-center">Page {page} / {totalPages}</span>
          <button type="button" className="btn btn-ghost btn-sm" disabled={page >= totalPages} onClick={() => setPage((current) => Math.min(totalPages, current + 1))}>
            Next
          </button>
        </div>
      </div>

      <ScbTransactionDetailDrawer
        item={detailItem}
        onClose={() => setDetailItem(null)}
        onRefresh={() => void fetchData()}
      />

      <ScbUnmatchedResolveModal
        open={!!resolveRow}
        role={role}
        transaction={resolveRow}
        onClose={() => setResolveRow(null)}
        onResolved={() => void fetchData()}
      />

      <Dialog open={!!ignoreRow} onOpenChange={(next) => !next && setIgnoreRow(null)}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>ยืนยันการ Ignore</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <p className="text-sm text-[var(--text-secondary)]">
              ต้องการ ignore รายการโอนนี้?
              <br />
              TXN: {ignoreRow?.transaction_id || ignoreRow?.id} · ยอด ฿{Number(ignoreRow?.amount ?? 0).toLocaleString("th-TH", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
            </p>
            <label className="block">
              <span className="mb-1 block text-xs font-black uppercase tracking-widest text-[var(--text-muted)]">หมายเหตุ</span>
              <textarea
                value={ignoreNote}
                onChange={(e) => setIgnoreNote(e.target.value)}
                className="form-textarea min-h-[96px] w-full"
                placeholder="กรอกเหตุผลสำหรับ audit trail"
              />
            </label>
          </div>
          <DialogFooter>
            <button type="button" className="btn btn-ghost" onClick={() => setIgnoreRow(null)}>ยกเลิก</button>
            <button type="button" className="btn btn-danger" disabled={!ignoreNote.trim() || busy || role === "supervisor"} title={role === "supervisor" ? "ต้องใช้สิทธิ์ Admin" : undefined} onClick={() => void handleIgnore()}>
              Ignore
            </button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
