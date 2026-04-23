"use client";

import type { RateRuleTier, RuleTriggerMetric } from "@/lib/rates/dynamic-types";

type EditableTier = Pick<RateRuleTier, "id" | "trigger_metric" | "trigger_threshold" | "tier_order">;

type TierListProps = {
  tiers: EditableTier[];
  onChange: (tiers: EditableTier[]) => void;
  disabled?: boolean;
};

const METRIC_OPTIONS: Array<{ value: RuleTriggerMetric; label: string }> = [
  { value: "occ_percent", label: "OCC %" },
  { value: "occ_rooms_booked", label: "Booked Rooms" },
];

export default function TierList({ tiers, onChange, disabled = false }: TierListProps) {
  function updateTier(index: number, patch: Partial<EditableTier>) {
    onChange(tiers.map((tier, tierIndex) => (tierIndex === index ? { ...tier, ...patch } : tier)));
  }

  function addTier() {
    onChange([
      ...tiers,
      {
        id: crypto.randomUUID(),
        trigger_metric: "occ_percent",
        trigger_threshold: 50,
        tier_order: tiers.length + 1,
      },
    ]);
  }

  function removeTier(index: number) {
    const next = tiers.filter((_, tierIndex) => tierIndex !== index).map((tier, tierIndex) => ({
      ...tier,
      tier_order: tierIndex + 1,
    }));
    onChange(next);
  }

  return (
    <div className="space-y-3">
      <div className="space-y-2">
        {tiers.length === 0 ? (
          <div className="text-[var(--text-muted)] italic text-sm">No tiers defined.</div>
        ) : (
          tiers.map((tier, index) => (
            <div key={tier.id || index} className="grid grid-cols-[auto_1fr_120px_auto] items-center gap-3 p-3 border rounded-lg bg-white dark:bg-black/20">
              <span className="font-mono text-xs text-[var(--text-secondary)]">#{tier.tier_order}</span>
              <select
                className="form-select py-1 text-sm"
                value={tier.trigger_metric}
                disabled={disabled}
                onChange={(event) =>
                  updateTier(index, { trigger_metric: event.target.value as RuleTriggerMetric })
                }
              >
                {METRIC_OPTIONS.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
              <input
                type="number"
                step="0.01"
                className="form-input py-1 text-sm"
                value={tier.trigger_threshold}
                disabled={disabled}
                onChange={(event) => updateTier(index, { trigger_threshold: Number(event.target.value || 0) })}
              />
              <button type="button" className="btn btn-secondary text-xs" disabled={disabled} onClick={() => removeTier(index)}>
                Remove
              </button>
            </div>
          ))
        )}
      </div>

      <button type="button" className="btn btn-secondary text-sm" disabled={disabled} onClick={addTier}>
        + Add Tier
      </button>
    </div>
  );
}
