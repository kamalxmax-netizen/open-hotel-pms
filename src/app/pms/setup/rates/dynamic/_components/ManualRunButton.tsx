"use client";

import { useState } from "react";

export default function ManualRunButton() {
  const [isOpen, setIsOpen] = useState(false);
  const [loading, setLoading] = useState(false);

  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");

  const handleRun = async () => {
    if (!startDate || !endDate) return;
    setLoading(true);
    try {
      const res = await fetch("/api/dynamic-rules/eval", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ start_date: startDate, end_date: endDate })
      });
      const data = await res.json();
      if (res.ok) {
        alert(`Evaluated ${data.stats?.evaluated_dates} dates. Suggestions: ${data.stats?.suggestions}`);
        setIsOpen(false);
      } else {
        alert(`Error: ${data.error}`);
      }
    } catch (err) {
      alert("Network error");
    } finally {
      setLoading(false);
    }
  };

  return (
    <>
      <button 
        className="btn border-brand-500 text-brand-700 bg-brand-50 hover:bg-brand-100 dark:border-brand-500/50 dark:text-brand-300 dark:bg-brand-500/10"
        onClick={() => setIsOpen(true)}
      >
        ⚡ Run Evaluator Now
      </button>

      {isOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div className="card w-full max-w-md p-6 space-y-6 bg-[var(--bg-primary)]">
            <h2 className="text-xl font-bold">Manual Evaluation Run</h2>
            <p className="text-sm text-[var(--text-secondary)]">
              This will evaluate all active rules for a specific date range and push results to the suggestion queue (or auto-apply if configured).
            </p>
            
            <div className="flex gap-4">
              <div className="flex-1 space-y-1">
                <label className="text-xs font-semibold">Start Date</label>
                <input type="date" className="form-input w-full" value={startDate} onChange={e => setStartDate(e.target.value)} />
              </div>
              <div className="flex-1 space-y-1">
                <label className="text-xs font-semibold">End Date</label>
                <input type="date" className="form-input w-full" value={endDate} onChange={e => setEndDate(e.target.value)} />
              </div>
            </div>

            <div className="flex justify-end gap-3 pt-4 border-t">
              <button className="btn btn-secondary" onClick={() => setIsOpen(false)} disabled={loading}>
                Cancel
              </button>
              <button className="btn btn-primary bg-brand-600 hover:bg-brand-700" onClick={handleRun} disabled={loading}>
                {loading ? "Running..." : "Run Now"}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
