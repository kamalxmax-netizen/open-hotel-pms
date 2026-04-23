"use client";

import { useEffect, useMemo, useState } from "react";
import type { AppliedLogRow, DynamicPreviewRow, SuggestionImpactSummary } from "@/lib/rates/dynamic-types";
import SuggestionRow from "./_components/SuggestionRow";
import BulkApproveModal from "./_components/BulkApproveModal";
import UndoStrip from "./_components/UndoStrip";
import ManualRunButton from "../../setup/rates/dynamic/_components/ManualRunButton";

export default function SuggestionsPage() {
  const [suggestions, setSuggestions] = useState<DynamicPreviewRow[]>([]);
  const [summary, setSummary] = useState<SuggestionImpactSummary | null>(null);
  const [undoRows, setUndoRows] = useState<AppliedLogRow[]>([]);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [bulkModalOpen, setBulkModalOpen] = useState(false);
  const [loading, setLoading] = useState(true);

  const load = async () => {
    setLoading(true);
    try {
      const [previewRes, undoRes] = await Promise.all([
        fetch("/api/dynamic-rules/preview?status=suggested"),
        fetch("/api/dynamic-rules/applied-log"),
      ]);
      const previewJson = await previewRes.json().catch(() => null);
      const undoJson = await undoRes.json().catch(() => null);

      if (previewJson?.success) {
        setSuggestions(previewJson.rows || []);
        setSummary(previewJson.summary || null);
      }
      if (undoJson?.success) {
        setUndoRows(undoJson.rows || []);
      }
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
  }, []);

  async function processBulkAction(action: "approve" | "reject", ids = Array.from(selectedIds), rejectReason?: string) {
    try {
      const res = await fetch("/api/dynamic-rules/preview", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          preview_ids: ids,
          action,
          reject_reason: rejectReason,
        }),
      });
      const json = await res.json().catch(() => null);
      if (!res.ok || !json?.success) {
        throw new Error(json?.error || "Bulk action failed.");
      }
      setSelectedIds(new Set());
      setBulkModalOpen(false);
      await load();
    } catch (bulkError) {
      alert(bulkError instanceof Error ? bulkError.message : "Bulk action failed.");
    }
  }

  const selectedRows = useMemo(
    () => suggestions.filter((suggestion) => selectedIds.has(suggestion.id)),
    [selectedIds, suggestions]
  );

  const undoableRows = useMemo(
    () => undoRows.filter((row) => row.is_undoable),
    [undoRows]
  );
  const latestUndoTime = undoableRows.length > 0
    ? undoableRows
        .map((row) => row.reversible_until)
        .sort()
        .slice(-1)[0]
    : null;

  function handleSelectAll(checked: boolean) {
    if (!checked) {
      setSelectedIds(new Set());
      return;
    }
    setSelectedIds(new Set(suggestions.map((suggestion) => suggestion.id)));
  }

  function handleRejectSelected(ids = Array.from(selectedIds)) {
    const reason = window.prompt("Reject reason");
    if (!reason) return;
    processBulkAction("reject", ids, reason);
  }

  function handleApproveSelected() {
    const requiresConfirm = selectedRows.some((row) => row.requires_confirmation) || selectedRows.length >= 10;
    if (requiresConfirm) {
      setBulkModalOpen(true);
      return;
    }
    processBulkAction("approve");
  }

  const allSelected = suggestions.length > 0 && selectedIds.size === suggestions.length;
  const hasPriceDowns = selectedRows.some((row) => row.direction === "down");

  return (
    <div className="max-w-7xl space-y-6 pb-20">
      <UndoStrip count={undoableRows.length} latestTime={latestUndoTime ? new Date(latestUndoTime).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }) : null} />

      <div className="flex justify-between items-start">
        <div>
          <p className="text-xs font-semibold uppercase tracking-widest text-brand-600">Rate Management</p>
          <h1 className="text-2xl font-bold text-[var(--text-primary)] mt-0.5">Dynamic Suggestions Queue</h1>
          <p className="text-sm text-[var(--text-secondary)] mt-1">Review and approve automated rate adjustments.</p>
        </div>
        <div className="flex items-center gap-3">
          <ManualRunButton />
        </div>
      </div>

      <div className="card p-4 grid gap-4 md:grid-cols-4 text-sm">
        <div>
          <p className="text-[var(--text-muted)]">Total Suggestions</p>
          <p className="text-xl font-bold">{summary?.total_rows ?? suggestions.length}</p>
        </div>
        <div>
          <p className="text-[var(--text-muted)]">Price Up</p>
          <p className="text-xl font-bold text-emerald-600">{summary?.price_up_rows ?? suggestions.filter((row) => row.direction === "up").length}</p>
        </div>
        <div>
          <p className="text-[var(--text-muted)]">Price Down</p>
          <p className="text-xl font-bold text-rose-600">{summary?.price_down_rows ?? suggestions.filter((row) => row.direction === "down").length}</p>
        </div>
        <div>
          <p className="text-[var(--text-muted)]">Clamped</p>
          <p className="text-xl font-bold text-amber-600">{(summary?.clamped_floor_count ?? 0) + (summary?.clamped_max_count ?? 0)}</p>
        </div>
      </div>

      {selectedIds.size > 0 && (
        <div className="card p-3 flex items-center justify-between bg-brand-50 border-brand-200 dark:bg-brand-900/20 dark:border-brand-800">
          <div className="text-sm font-semibold text-brand-800 dark:text-brand-300">
            {selectedIds.size} rows selected
          </div>
          <div className="flex items-center gap-2 flex-wrap">
            <button className="btn btn-secondary text-xs" onClick={() => setSelectedIds(new Set())}>Clear</button>
            <button className="btn btn-secondary text-xs" onClick={() => setSelectedIds(new Set(suggestions.filter((row) => row.direction === "up").map((row) => row.id)))}>Select all up-only</button>
            <button className="btn btn-secondary text-xs" onClick={() => setSelectedIds(new Set(suggestions.filter((row) => row.direction === "down").map((row) => row.id)))}>Select all down-only</button>
            <button className="btn text-xs border border-rose-200 text-rose-700 bg-white" onClick={() => handleRejectSelected()}>Reject Selected</button>
            <button className="btn btn-primary text-xs" onClick={handleApproveSelected}>Approve Selected</button>
          </div>
        </div>
      )}

      <div className="card overflow-hidden">
        <table className="data-table w-full text-sm">
          <thead className="bg-black/5 dark:bg-white/5">
            <tr>
              <th className="w-10 text-center">
                <input type="checkbox" checked={allSelected} onChange={(event) => handleSelectAll(event.target.checked)} />
              </th>
              <th className="text-left py-3 px-4">Date</th>
              <th className="text-left py-3 px-4">Room Type</th>
              <th className="text-left py-3 px-4">Rule Group</th>
              <th className="text-right py-3 px-4">Price Change</th>
              <th className="text-center py-3 px-4">Badges</th>
              <th className="w-32"></th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr>
                <td colSpan={7} className="py-10 text-center text-[var(--text-muted)] animate-pulse">Loading suggestions...</td>
              </tr>
            ) : suggestions.length === 0 ? (
              <tr>
                <td colSpan={7} className="py-10 text-center text-[var(--text-muted)] italic">
                  No pending suggestions.
                </td>
              </tr>
            ) : (
              suggestions.map((suggestion) => (
                <SuggestionRow
                  key={suggestion.id}
                  row={suggestion}
                  selected={selectedIds.has(suggestion.id)}
                  onSelect={(selected) => {
                    const next = new Set(selectedIds);
                    if (selected) next.add(suggestion.id);
                    else next.delete(suggestion.id);
                    setSelectedIds(next);
                  }}
                  onApprove={() => processBulkAction("approve", [suggestion.id])}
                  onReject={() => handleRejectSelected([suggestion.id])}
                />
              ))
            )}
          </tbody>
        </table>
      </div>

      {bulkModalOpen && (
        <BulkApproveModal
          selectedCount={selectedIds.size}
          hasPriceDowns={hasPriceDowns}
          onClose={() => setBulkModalOpen(false)}
          onConfirm={() => processBulkAction("approve")}
        />
      )}
    </div>
  );
}
