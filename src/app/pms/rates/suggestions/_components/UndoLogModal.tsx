"use client";

import { useEffect, useState } from "react";
import type { AppliedLogRow } from "@/lib/rates/dynamic-types";

export default function UndoLogModal({ onClose }: { onClose: () => void }) {
  const [undoAllConfirm, setUndoAllConfirm] = useState(false);
  const [logs, setLogs] = useState<AppliedLogRow[]>([]);
  const [loading, setLoading] = useState(true);

  const load = async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/dynamic-rules/applied-log");
      const data = await res.json();
      if (data.success) setLogs(data.rows || []);
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
  }, []);

  const handleUndo = async (id: string) => {
    try {
      const res = await fetch("/api/dynamic-rules/applied-log/undo", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ applied_log_id: id }),
      });
      const data = await res.json();
      if (res.ok && data.success) {
        await load();
      } else {
        alert(data.error || "Failed to undo");
      }
    } catch (err) {
      console.error(err);
    }
  };

  const handleUndoAll = async () => {
    const undoable = logs.filter((log) => log.is_undoable);
    for (const log of undoable) {
      await handleUndo(log.id);
    }
    setUndoAllConfirm(false);
  };

  function renderDisabledReason(log: AppliedLogRow) {
    if (log.divergence_reason === "price_changed") {
      const sample = Object.entries(log.current_prices ?? {})[0];
      if (sample) {
        return `Rate manually changed since apply (current: ฿${sample[1]} vs applied: ฿${log.new_price})`;
      }
      return "Rate manually changed since apply.";
    }
    if (log.divergence_reason === "already_undone") return "Already undone.";
    if (log.divergence_reason === "window_expired") return "Undo window expired.";
    return "Undo unavailable.";
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div className="card w-full max-w-4xl p-6 flex flex-col max-h-[90vh] bg-[var(--bg-primary)]">
        <div className="flex justify-between items-center mb-6">
          <div>
            <h2 className="text-xl font-bold">Recent Rate Applications (Undo Log)</h2>
            <p className="text-sm text-[var(--text-secondary)] mt-1">Rates applied manually or automatically within the undo window.</p>
          </div>
          <button className="text-[var(--text-muted)] hover:text-[var(--text-primary)]" onClick={onClose}>
            <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M6 18L18 6M6 6l12 12"></path></svg>
          </button>
        </div>

        <div className="flex-1 overflow-auto border rounded-xl">
          <table className="data-table w-full text-sm">
            <thead className="bg-black/5 dark:bg-white/5 sticky top-0 z-10">
              <tr>
                <th className="text-left py-2 px-4">Applied Time</th>
                <th className="text-left py-2 px-4">Stay Date</th>
                <th className="text-left py-2 px-4">Room Type</th>
                <th className="text-right py-2 px-4">Price Change</th>
                <th className="text-center py-2 px-4">Time Left</th>
                <th className="text-right py-2 px-4">Action</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr><td colSpan={6} className="py-10 text-center text-[var(--text-muted)] animate-pulse">Loading...</td></tr>
              ) : logs.length === 0 ? (
                <tr><td colSpan={6} className="py-10 text-center text-[var(--text-muted)] italic">No recent applications found.</td></tr>
              ) : (
                logs.map((log) => {
                  const timeLeft = log.is_undoable
                    ? Math.max(0, Math.floor((new Date(log.reversible_until).getTime() - Date.now()) / 60000))
                    : 0;
                  return (
                    <tr key={log.id} className={`border-t ${!log.is_undoable ? "opacity-50" : ""}`}>
                      <td className="py-3 px-4">{new Date(log.applied_at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</td>
                      <td className="py-3 px-4 font-medium">{log.stay_date}</td>
                      <td className="py-3 px-4">{log.room_type_name}</td>
                      <td className="py-3 px-4 text-right">฿{log.previous_price} &rarr; ฿{log.new_price}</td>
                      <td className="py-3 px-4 text-center">
                        {log.is_undoable ? <span className="text-brand-600 font-medium">{timeLeft}m</span> : <span>{log.divergence_reason.replace("_", " ")}</span>}
                      </td>
                      <td className="py-3 px-4 text-right">
                        <button
                          className="btn btn-secondary text-xs px-2 py-1 disabled:opacity-50"
                          disabled={!log.is_undoable}
                          title={!log.is_undoable ? renderDisabledReason(log) : "Undo"}
                          onClick={() => handleUndo(log.id)}
                        >
                          Undo
                        </button>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>

        <div className="mt-6 flex justify-between items-center border-t pt-4">
          {undoAllConfirm ? (
            <div className="flex items-center gap-3 bg-rose-50 dark:bg-rose-900/20 p-2 rounded-lg border border-rose-200 dark:border-rose-800">
              <span className="text-sm text-rose-800 dark:text-rose-300 font-medium px-2">Are you sure? This will revert all undoable rows.</span>
              <button className="btn btn-secondary text-xs" onClick={() => setUndoAllConfirm(false)}>Cancel</button>
              <button className="btn btn-primary bg-rose-600 hover:bg-rose-700 text-xs" onClick={handleUndoAll}>Yes, Undo All</button>
            </div>
          ) : (
            <button className="btn border border-rose-200 text-rose-700 hover:bg-rose-50 dark:hover:bg-rose-900/20" onClick={() => setUndoAllConfirm(true)}>
              Undo All Still-Undoable
            </button>
          )}
          <button className="btn btn-secondary" onClick={onClose}>Close</button>
        </div>
      </div>
    </div>
  );
}
