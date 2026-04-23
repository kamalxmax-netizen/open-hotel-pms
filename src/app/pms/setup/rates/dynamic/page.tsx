"use client";

import { useEffect, useMemo, useState } from "react";
import type { RateRuleGroup } from "@/lib/rates/dynamic-types";
import type { RoomTypeGroup } from "@/lib/rates/types";
import ManualRunButton from "./_components/ManualRunButton";
import GroupCard from "./_components/GroupCard";

type RoomTypeOption = {
  type_id: string;
  type_name: string;
};

const EMPTY_GROUP_DRAFT = {
  name: "",
  priority: 100,
  trigger_scope: "group_aggregate" as const,
  mode: "suggest_only" as const,
  is_active: true,
  effective_from: "",
  effective_to: "",
};

export default function DynamicRulesPage() {
  const [groups, setGroups] = useState<RateRuleGroup[]>([]);
  const [roomTypes, setRoomTypes] = useState<RoomTypeOption[]>([]);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [createOpen, setCreateOpen] = useState(false);
  const [createError, setCreateError] = useState("");
  const [draft, setDraft] = useState(EMPTY_GROUP_DRAFT);

  async function load() {
    setLoading(true);
    try {
      const [groupRes, rateRes] = await Promise.all([
        fetch("/api/dynamic-rules/groups"),
        fetch(`/api/rates?start=${new Date().toISOString().slice(0, 10)}&end=${new Date().toISOString().slice(0, 10)}`),
      ]);

      const groupJson = await groupRes.json().catch(() => null);
      const rateJson = await rateRes.json().catch(() => null);

      if (groupJson?.success) {
        setGroups(groupJson.groups || []);
      }
      if (rateJson?.success) {
        setRoomTypes(
          ((rateJson.room_types || []) as RoomTypeGroup[]).map((group) => ({
            type_id: group.type_id,
            type_name: group.type_name,
          }))
        );
      }
    } catch (loadError) {
      console.error(loadError);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
  }, []);

  const hasRoomTypes = useMemo(() => roomTypes.length > 0, [roomTypes.length]);

  async function createGroup() {
    setCreating(true);
    setCreateError("");
    try {
      const res = await fetch("/api/dynamic-rules/groups", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: draft.name,
          priority: draft.priority,
          trigger_scope: draft.trigger_scope,
          mode: draft.mode,
          is_active: draft.is_active,
          effective_from: draft.effective_from || null,
          effective_to: draft.effective_to || null,
          applies_to_dow: null,
        }),
      });
      const json = await res.json().catch(() => null);
      if (!res.ok || !json?.success) {
        throw new Error(json?.error || "Failed to create group.");
      }

      const createdGroupId = json.group?.id as string | undefined;
      if (createdGroupId && hasRoomTypes) {
        await fetch(`/api/dynamic-rules/groups/${createdGroupId}/members`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            members: [
              {
                room_type_id: roomTypes[0].type_id,
                action_type: "percent",
                action_value: 10,
                rounding: "nearest_10",
              },
            ],
          }),
        });

        await fetch(`/api/dynamic-rules/groups/${createdGroupId}/tiers`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            tiers: [
              {
                trigger_metric: "occ_percent",
                trigger_threshold: 50,
                tier_order: 1,
              },
            ],
          }),
        });
      }

      setCreateOpen(false);
      setDraft(EMPTY_GROUP_DRAFT);
      await load();
    } catch (createGroupError) {
      setCreateError(createGroupError instanceof Error ? createGroupError.message : "Failed to create group.");
    } finally {
      setCreating(false);
    }
  }

  return (
    <div className="max-w-5xl space-y-6 pb-20">
      <div className="flex justify-between items-start gap-4 flex-wrap">
        <div>
          <p className="text-xs font-semibold uppercase tracking-widest text-brand-600">Setup</p>
          <h1 className="text-2xl font-bold text-[var(--text-primary)] mt-0.5">Dynamic Rules Engine</h1>
          <p className="text-sm text-[var(--text-secondary)] mt-1">Automated rate adjustments based on occupancy triggers.</p>
        </div>
        <div className="flex items-center gap-3">
          <ManualRunButton />
          <button className="btn btn-primary" onClick={() => setCreateOpen(true)}>
            + New Rule Group
          </button>
        </div>
      </div>

      {loading ? (
        <div className="p-10 text-center animate-pulse text-[var(--text-muted)]">Loading rules...</div>
      ) : groups.length === 0 ? (
        <div className="p-10 text-center border rounded-2xl border-dashed">
          <p className="text-[var(--text-muted)]">No dynamic rules configured.</p>
        </div>
      ) : (
        <div className="space-y-6">
          {groups.map((group) => (
            <GroupCard key={group.id} group={group} roomTypes={roomTypes} onSaved={load} onDeleted={load} />
          ))}
        </div>
      )}

      {createOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div className="card w-full max-w-lg p-6 space-y-4 bg-[var(--bg-primary)]">
            <div className="flex items-center justify-between gap-4">
              <h2 className="text-xl font-bold">Create Rule Group</h2>
              <button className="btn btn-secondary text-xs" onClick={() => setCreateOpen(false)}>
                Close
              </button>
            </div>

            {createError && (
              <div className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700 dark:border-rose-900 dark:bg-rose-950/30 dark:text-rose-400">
                {createError}
              </div>
            )}

            <div className="grid gap-4 md:grid-cols-2">
              <div className="md:col-span-2">
                <label className="form-label">Group Name</label>
                <input className="form-input" value={draft.name} onChange={(event) => setDraft((current) => ({ ...current, name: event.target.value }))} />
              </div>
              <div>
                <label className="form-label">Priority</label>
                <input type="number" className="form-input" value={draft.priority} onChange={(event) => setDraft((current) => ({ ...current, priority: Number(event.target.value || 100) }))} />
              </div>
              <div>
                <label className="form-label">Mode</label>
                <select className="form-select" value={draft.mode} onChange={(event) => setDraft((current) => ({ ...current, mode: event.target.value as typeof current.mode }))}>
                  <option value="suggest_only">Suggest Only</option>
                  <option value="auto_apply">Auto Apply</option>
                </select>
              </div>
              <div>
                <label className="form-label">Trigger Scope</label>
                <select className="form-select" value={draft.trigger_scope} onChange={(event) => setDraft((current) => ({ ...current, trigger_scope: event.target.value as typeof current.trigger_scope }))}>
                  <option value="hotel_wide">Hotel Wide</option>
                  <option value="group_aggregate">Group Aggregate</option>
                  <option value="per_room_type">Per Room Type</option>
                </select>
              </div>
              <div className="flex items-center gap-2 pt-7">
                <input type="checkbox" checked={draft.is_active} onChange={(event) => setDraft((current) => ({ ...current, is_active: event.target.checked }))} />
                <span className="text-sm font-medium">Active</span>
              </div>
              <div>
                <label className="form-label">Effective From</label>
                <input type="date" className="form-input" value={draft.effective_from} onChange={(event) => setDraft((current) => ({ ...current, effective_from: event.target.value }))} />
              </div>
              <div>
                <label className="form-label">Effective To</label>
                <input type="date" className="form-input" value={draft.effective_to} onChange={(event) => setDraft((current) => ({ ...current, effective_to: event.target.value }))} />
              </div>
            </div>

            <p className="text-xs text-[var(--text-muted)]">The page will create one starter tier and one starter member so you can edit the group immediately after creation.</p>

            <div className="flex justify-end gap-3 border-t pt-4">
              <button className="btn btn-secondary" onClick={() => setCreateOpen(false)} disabled={creating}>
                Cancel
              </button>
              <button className="btn btn-primary" onClick={createGroup} disabled={creating || !draft.name.trim()}>
                {creating ? "Creating..." : "Create Group"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
