"use client";

import { useMemo, useState } from "react";
import type { RateRuleGroup } from "@/lib/rates/dynamic-types";
import MemberTable from "./MemberTable";
import TierList from "./TierList";
import SimulationPanel from "./SimulationPanel";

type RoomTypeOption = {
  type_id: string;
  type_name: string;
};

type GroupCardProps = {
  group: RateRuleGroup;
  roomTypes: RoomTypeOption[];
  onSaved: () => Promise<void> | void;
  onDeleted: () => Promise<void> | void;
};

function normalizeDow(value: number[] | null | undefined) {
  return value ?? [];
}

const DOW_OPTIONS = [
  { value: 0, label: "Sun" },
  { value: 1, label: "Mon" },
  { value: 2, label: "Tue" },
  { value: 3, label: "Wed" },
  { value: 4, label: "Thu" },
  { value: 5, label: "Fri" },
  { value: 6, label: "Sat" },
];

export default function GroupCard({ group, roomTypes, onSaved, onDeleted }: GroupCardProps) {
  const [expanded, setExpanded] = useState(false);
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState("");
  const [draft, setDraft] = useState<RateRuleGroup>(group);

  const selectedDow = useMemo(() => new Set(normalizeDow(draft.applies_to_dow)), [draft.applies_to_dow]);

  function updateDraft(patch: Partial<RateRuleGroup>) {
    setDraft((current) => ({ ...current, ...patch }));
  }

  function toggleDow(day: number) {
    const next = new Set(selectedDow);
    if (next.has(day)) next.delete(day);
    else next.add(day);
    updateDraft({ applies_to_dow: next.size > 0 ? Array.from(next).sort((a, b) => a - b) : null });
  }

  async function saveGroup() {
    setSaving(true);
    setError("");
    try {
      const groupRes = await fetch(`/api/dynamic-rules/groups/${draft.id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: draft.name,
          priority: draft.priority,
          trigger_scope: draft.trigger_scope,
          mode: draft.mode,
          is_active: draft.is_active,
          effective_from: draft.effective_from,
          effective_to: draft.effective_to,
          applies_to_dow: draft.applies_to_dow,
        }),
      });
      const groupJson = await groupRes.json().catch(() => null);
      if (!groupRes.ok || !groupJson?.success) {
        throw new Error(groupJson?.error || "Failed to save group.");
      }

      const membersRes = await fetch(`/api/dynamic-rules/groups/${draft.id}/members`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          members: draft.members.map((member) => ({
            room_type_id: member.room_type_id,
            action_type: member.action_type,
            action_value: member.action_value,
            rounding: member.rounding,
          })),
        }),
      });
      const membersJson = await membersRes.json().catch(() => null);
      if (!membersRes.ok || !membersJson?.success) {
        throw new Error(membersJson?.error || "Failed to save group members.");
      }

      const tiersRes = await fetch(`/api/dynamic-rules/groups/${draft.id}/tiers`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          tiers: draft.tiers.map((tier, index) => ({
            id: tier.id,
            trigger_metric: tier.trigger_metric,
            trigger_threshold: tier.trigger_threshold,
            tier_order: index + 1,
          })),
        }),
      });
      const tiersJson = await tiersRes.json().catch(() => null);
      if (!tiersRes.ok || !tiersJson?.success) {
        throw new Error(tiersJson?.error || "Failed to save group tiers.");
      }

      setDraft(tiersJson.group ?? membersJson.group ?? groupJson.group ?? draft);
      await onSaved();
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : "Failed to save group.");
    } finally {
      setSaving(false);
    }
  }

  async function deleteGroup() {
    if (!window.confirm(`Delete rule group "${draft.name}"?`)) return;
    setDeleting(true);
    setError("");
    try {
      const res = await fetch(`/api/dynamic-rules/groups/${draft.id}`, { method: "DELETE" });
      const json = await res.json().catch(() => null);
      if (!res.ok || !json?.success) {
        throw new Error(json?.error || "Failed to delete group.");
      }
      await onDeleted();
    } catch (deleteError) {
      setError(deleteError instanceof Error ? deleteError.message : "Failed to delete group.");
    } finally {
      setDeleting(false);
    }
  }

  return (
    <div className="card rounded-2xl border overflow-hidden">
      <div
        className="p-5 flex items-center justify-between cursor-pointer hover:bg-black/5 dark:hover:bg-white/5 transition"
        onClick={() => setExpanded((current) => !current)}
      >
        <div className="space-y-1">
          <div className="flex items-center gap-3 flex-wrap">
            <h2 className="text-lg font-bold">{draft.name || "Untitled Group"}</h2>
            <span className="badge badge-sky text-xs uppercase">Priority: {draft.priority || 100}</span>
            <span className={`badge text-xs uppercase ${draft.mode === "auto_apply" ? "badge-emerald" : "badge-amber"}`}>
              {draft.mode === "auto_apply" ? "Auto Apply" : "Suggest Only"}
            </span>
            {!draft.is_active && <span className="badge text-xs uppercase border border-slate-300 text-slate-600 bg-slate-100">Inactive</span>}
          </div>
          <p className="text-sm text-[var(--text-secondary)]">
            Scope: {draft.trigger_scope}
          </p>
        </div>
        <div className="text-xs text-[var(--text-muted)]">{expanded ? "Hide" : "Open"}</div>
      </div>

      {expanded && (
        <div className="p-5 border-t space-y-6 bg-black/[0.02] dark:bg-white/[0.02]">
          {error && (
            <div className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700 dark:border-rose-900 dark:bg-rose-950/30 dark:text-rose-400">
              {error}
            </div>
          )}

          <div className="grid gap-4 md:grid-cols-2">
            <div>
              <label className="form-label">Group Name</label>
              <input
                className="form-input"
                value={draft.name}
                onChange={(event) => updateDraft({ name: event.target.value })}
              />
            </div>
            <div>
              <label className="form-label">Priority</label>
              <input
                type="number"
                className="form-input"
                value={draft.priority}
                onChange={(event) => updateDraft({ priority: Number(event.target.value || 100) })}
              />
            </div>
            <div>
              <label className="form-label">Trigger Scope</label>
              <select
                className="form-select"
                value={draft.trigger_scope}
                onChange={(event) =>
                  updateDraft({ trigger_scope: event.target.value as RateRuleGroup["trigger_scope"] })
                }
              >
                <option value="hotel_wide">Hotel Wide</option>
                <option value="group_aggregate">Group Aggregate</option>
                <option value="per_room_type">Per Room Type</option>
              </select>
            </div>
            <div>
              <label className="form-label">Mode</label>
              <select
                className="form-select"
                value={draft.mode}
                onChange={(event) => updateDraft({ mode: event.target.value as RateRuleGroup["mode"] })}
              >
                <option value="suggest_only">Suggest Only</option>
                <option value="auto_apply">Auto Apply</option>
              </select>
            </div>
            <div>
              <label className="form-label">Effective From</label>
              <input
                type="date"
                className="form-input"
                value={draft.effective_from ?? ""}
                onChange={(event) => updateDraft({ effective_from: event.target.value || null })}
              />
            </div>
            <div>
              <label className="form-label">Effective To</label>
              <input
                type="date"
                className="form-input"
                value={draft.effective_to ?? ""}
                onChange={(event) => updateDraft({ effective_to: event.target.value || null })}
              />
            </div>
          </div>

          <div className="flex items-center gap-3">
            <label className="inline-flex items-center gap-2 text-sm font-medium">
              <input
                type="checkbox"
                checked={draft.is_active}
                onChange={(event) => updateDraft({ is_active: event.target.checked })}
              />
              Active
            </label>
          </div>

          <div className="space-y-2">
            <p className="text-sm font-semibold uppercase tracking-wider">Days of Week</p>
            <div className="flex gap-2 flex-wrap">
              {DOW_OPTIONS.map((option) => (
                <button
                  key={option.value}
                  type="button"
                  className={`rounded-full border px-3 py-1 text-xs font-semibold transition ${
                    selectedDow.has(option.value)
                      ? "border-brand-500 bg-brand-600 text-white"
                      : "border-[var(--border-default)] bg-[var(--bg-surface)] text-[var(--text-secondary)]"
                  }`}
                  onClick={() => toggleDow(option.value)}
                >
                  {option.label}
                </button>
              ))}
            </div>
            <p className="text-xs text-[var(--text-muted)]">Leave all days unselected to apply every day.</p>
          </div>

          <div className="grid md:grid-cols-2 gap-6">
            <div className="space-y-4">
              <h3 className="font-semibold text-sm uppercase tracking-wider">Triggers (Tiers)</h3>
              <TierList tiers={draft.tiers} onChange={(tiers) => updateDraft({ tiers })} disabled={saving} />
            </div>
            <div className="space-y-4">
              <h3 className="font-semibold text-sm uppercase tracking-wider">Actions (Members)</h3>
              <MemberTable members={draft.members} roomTypes={roomTypes} onChange={(members) => updateDraft({ members })} disabled={saving} />
            </div>
          </div>

          <div className="border-t pt-6 mt-6">
            <SimulationPanel groupId={draft.id} />
          </div>

          <div className="flex items-center justify-between gap-3 border-t pt-4">
            <button type="button" className="btn border border-rose-200 text-rose-700 hover:bg-rose-50" disabled={deleting || saving} onClick={deleteGroup}>
              {deleting ? "Deleting..." : "Delete Group"}
            </button>
            <button type="button" className="btn btn-primary" disabled={saving || deleting} onClick={saveGroup}>
              {saving ? "Saving..." : "Save Group"}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
