"use client";

import { useState } from "react";
import type { ProjectedRow } from "@/lib/rates/dynamic-types";

type SimulationPanelProps = {
  groupId: string;
};

export default function SimulationPanel({ groupId }: SimulationPanelProps) {
  const [date, setDate] = useState("");
  const [results, setResults] = useState<ProjectedRow[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const handleSimulate = async () => {
    if (!date) return;
    setLoading(true);
    setError("");
    try {
      const res = await fetch("/api/dynamic-rules/simulate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ stay_date: date, group_id: groupId }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok || !data?.success) {
        throw new Error(data?.error || "Simulation failed.");
      }
      setResults(data.projected_rows || []);
    } catch (simulationError) {
      setError(simulationError instanceof Error ? simulationError.message : "Simulation failed.");
      setResults(null);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-4 flex-wrap">
        <h3 className="font-bold text-brand-600">Simulate Rule</h3>
        <input
          type="date"
          className="form-input text-sm"
          value={date}
          onChange={(event) => setDate(event.target.value)}
        />
        <button
          className="btn btn-secondary text-sm"
          onClick={handleSimulate}
          disabled={!date || loading}
        >
          {loading ? "Simulating..." : "Run Simulation"}
        </button>
      </div>

      {error && (
        <div className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700 dark:border-rose-900 dark:bg-rose-950/30 dark:text-rose-400">
          {error}
        </div>
      )}

      {results && (
        <div className="bg-white dark:bg-black/40 border rounded-lg p-4">
          {results.length === 0 ? (
            <p className="text-sm text-[var(--text-muted)]">No changes would apply on this date.</p>
          ) : (
            <ul className="space-y-1">
              {results.map((row) => (
                <li key={`${row.room_type_id}-${row.applied_tier_id}`} className="text-sm">
                  {row.room_type_name}:{" "}
                  <span className="line-through text-[var(--text-muted)]">฿{row.base_price}</span>
                  {" "}→{" "}
                  <span className="font-bold text-brand-600">฿{row.projected_price}</span>
                  {" "}({row.direction === "up" ? "+" : ""}{Math.round(row.delta_pct * 10000) / 100}%)
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
