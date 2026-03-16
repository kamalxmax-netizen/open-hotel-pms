"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import RatePlanModal from "@/components/rate-plan-modal";
import type { RatePlan } from "@/components/rate-plan-select";

function formatDiscount(plan: RatePlan): string {
  if (plan.discount_type === "percent") return `${plan.discount_value}%`;
  if (plan.discount_type === "fixed") return `THB ${plan.discount_value}`;
  return `THB ${plan.discount_value}/night`;
}

function formatPeriod(plan: RatePlan): string {
  if (!plan.valid_from && !plan.valid_until) return "Always";
  if (plan.valid_from && plan.valid_until) return `${plan.valid_from} - ${plan.valid_until}`;
  if (plan.valid_from) return `From ${plan.valid_from}`;
  return `Until ${plan.valid_until}`;
}

export default function RatePlansPage() {
  const [ratePlans, setRatePlans] = useState<RatePlan[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const [query, setQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState<"all" | "active" | "inactive">("all");

  const [createOpen, setCreateOpen] = useState(false);
  const [editingPlan, setEditingPlan] = useState<RatePlan | null>(null);
  const [toast, setToast] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const res = await fetch("/api/rate-plans");
      const payload = await res.json();
      if (!res.ok || !payload.success) {
        throw new Error(payload.error ?? "Failed to load rate plans.");
      }
      setRatePlans((payload.ratePlans ?? []) as RatePlan[]);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return ratePlans.filter((plan) => {
      if (statusFilter === "active" && !plan.is_active) return false;
      if (statusFilter === "inactive" && plan.is_active) return false;
      if (!q) return true;
      return (
        plan.code.toLowerCase().includes(q) ||
        plan.name_en.toLowerCase().includes(q) ||
        (plan.name_th ?? "").toLowerCase().includes(q)
      );
    });
  }, [query, ratePlans, statusFilter]);

  function showToast(message: string) {
    setToast(message);
    setTimeout(() => setToast(""), 3000);
  }

  async function toggleActive(plan: RatePlan) {
    try {
      const res = await fetch(`/api/rate-plans/${plan.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ is_active: !plan.is_active })
      });
      const payload = await res.json();
      if (!res.ok || !payload.success) {
        throw new Error(payload.error ?? "Could not update status.");
      }
      showToast(`Updated ${plan.code} to ${!plan.is_active ? "active" : "inactive"}.`);
      load();
    } catch (err) {
      showToast((err as Error).message);
    }
  }

  return (
    <div className="space-y-5 max-w-6xl">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <p className="text-xs font-semibold uppercase tracking-widest text-brand-600">Revenue</p>
          <h1 className="text-2xl font-bold text-[var(--text-primary)] mt-0.5">Rate Plans</h1>
          <p className="text-sm text-[var(--text-secondary)] mt-1">Manage rack, direct, long-stay, VIP, and promo pricing rules</p>
        </div>
        <button className="btn btn-primary" onClick={() => setCreateOpen(true)}>
          + New Rate Plan
        </button>
      </div>

      <div className="card p-4 flex flex-wrap gap-3 items-end">
        <div className="flex-1 min-w-[220px]">
          <label className="form-label">Search</label>
          <input
            className="form-input"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Code or name..."
          />
        </div>

        <div>
          <label className="form-label">Status</label>
          <select
            className="form-select"
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value as "all" | "active" | "inactive")}
          >
            <option value="all">All</option>
            <option value="active">Active</option>
            <option value="inactive">Inactive</option>
          </select>
        </div>

        <button className="btn btn-secondary btn-sm self-end" onClick={load}>
          Refresh
        </button>
      </div>

      {error && (
        <div className="rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">
          {error}
        </div>
      )}

      <div className="card overflow-hidden">
        {loading ? (
          <div className="p-6 space-y-2">
            {[1, 2, 3, 4].map((i) => (
              <div key={i} className="h-11 rounded-lg bg-[var(--bg-muted)] animate-pulse" />
            ))}
          </div>
        ) : filtered.length === 0 ? (
          <div className="p-10 text-center text-[var(--text-secondary)]">No rate plans found.</div>
        ) : (
          <table className="data-table">
            <thead>
              <tr>
                <th>Code</th>
                <th>Name</th>
                <th>Discount</th>
                <th>Min Nights</th>
                <th>Valid Period</th>
                <th>Access</th>
                <th>Status</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((plan) => (
                <tr key={plan.id}>
                  <td>
                    <span className="font-bold text-[var(--text-primary)]">{plan.code}</span>
                  </td>
                  <td>
                    <div className="font-semibold text-[var(--text-primary)]">{plan.name_en}</div>
                    {plan.name_th && <div className="text-xs text-[var(--text-muted)]">{plan.name_th}</div>}
                  </td>
                  <td>
                    <div className="text-sm text-[var(--text-table-cell)]">{plan.discount_type}</div>
                    <div className="text-xs text-[var(--text-secondary)]">{formatDiscount(plan)}</div>
                  </td>
                  <td>{plan.min_nights}</td>
                  <td className="text-sm text-[var(--text-secondary)]">{formatPeriod(plan)}</td>
                  <td className="text-sm text-[var(--text-secondary)]">
                    {plan.access_summary?.label ?? "Public"}
                  </td>
                  <td>
                    <span className={`badge ${plan.is_active ? "bg-emerald-100 text-emerald-700" : "bg-[var(--bg-surface-hover)] text-[var(--text-muted)]"}`}>
                      {plan.is_active ? "Active" : "Inactive"}
                    </span>
                  </td>
                  <td>
                    <div className="flex gap-1">
                      <button className="btn btn-secondary btn-sm" onClick={() => setEditingPlan(plan)}>
                        Edit
                      </button>
                      <button
                        className="btn btn-secondary btn-sm"
                        onClick={() => toggleActive(plan)}
                      >
                        {plan.is_active ? "Deactivate" : "Activate"}
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {createOpen && (
        <RatePlanModal
          mode="create"
          onClose={() => setCreateOpen(false)}
          onSuccess={(plan) => {
            setCreateOpen(false);
            showToast(`Created ${plan.code}.`);
            load();
          }}
        />
      )}

      {editingPlan && (
        <RatePlanModal
          mode="edit"
          ratePlan={editingPlan}
          onClose={() => setEditingPlan(null)}
          onSuccess={(plan) => {
            setEditingPlan(null);
            showToast(`Updated ${plan.code}.`);
            load();
          }}
        />
      )}

      {toast && (
        <div className="toast-bar toast-success fixed bottom-6 right-6 z-50">
          {toast}
        </div>
      )}
    </div>
  );
}
