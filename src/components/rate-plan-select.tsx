"use client";

import { useEffect, useMemo, useState } from "react";
import type { RatePlanEligibilitySource, RatePlanTierCode } from "@/lib/types";

export type RatePlan = {
  id: string;
  code: string;
  name_en: string;
  name_th: string | null;
  description: string | null;
  discount_type: "percent" | "fixed" | "override";
  discount_value: number;
  min_nights: number;
  max_nights: number | null;
  valid_from: string | null;
  valid_until: string | null;
  is_active: boolean;
  apply_to_room_types: number[] | null;
  sort_order: number;
  tier_codes?: RatePlanTierCode[];
  profile_ids?: string[];
  eligibility_source?: RatePlanEligibilitySource;
  eligibility_badges?: string[];
  access_summary?: {
    is_public: boolean;
    label: string;
  };
};

interface RatePlanSelectProps {
  value: string;
  onChange: (ratePlanId: string, ratePlan?: RatePlan, meta?: { clearedIneligible?: boolean }) => void;
  roomTypeId?: string;
  nights?: number;
  guestProfileId?: string;
  checkinDate?: string;
  checkoutDate?: string;
  disabled?: boolean;
}

function toNumber(value: unknown): number {
  const num = typeof value === "number" ? value : Number(value);
  return Number.isFinite(num) ? num : 0;
}

function formatPlanLabel(plan: RatePlan): string {
  const badgeText = Array.isArray(plan.eligibility_badges) && plan.eligibility_badges.length > 0
    ? ` · ${plan.eligibility_badges.join(", ")}`
    : "";
  if (plan.discount_type === "percent") {
    return `[${plan.code}] ${plan.name_en} - ${plan.discount_value}% off${badgeText}`;
  }
  if (plan.discount_type === "fixed") {
    return `[${plan.code}] ${plan.name_en} - THB ${plan.discount_value} off/night${badgeText}`;
  }
  return `[${plan.code}] ${plan.name_en} - THB ${plan.discount_value}/night${badgeText}`;
}

export default function RatePlanSelect({
  value,
  onChange,
  roomTypeId,
  nights,
  guestProfileId,
  checkinDate,
  checkoutDate,
  disabled
}: RatePlanSelectProps) {
  const [plans, setPlans] = useState<RatePlan[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    let alive = true;

    async function loadPlans() {
      setLoading(true);
      setError("");
      try {
        const params = new URLSearchParams({
          active: "true",
          scope: "booking",
        });
        if (roomTypeId) params.set("room_type_id", roomTypeId);
        if (nights != null && nights > 0) params.set("nights", String(nights));
        if (guestProfileId) params.set("guest_profile_id", guestProfileId);
        if (checkinDate) params.set("checkin_date", checkinDate);
        if (checkoutDate) params.set("checkout_date", checkoutDate);

        const res = await fetch(`/api/rate-plans?${params.toString()}`);
        const payload = await res.json();
        if (!res.ok || !payload.success) {
          throw new Error(payload.error ?? "Failed to load rate plans.");
        }
        if (!alive) return;

        const rows = (payload.ratePlans ?? []) as Array<Record<string, unknown>>;
        const mapped: RatePlan[] = rows.map((row) => ({
          id: String(row.id),
          code: String(row.code),
          name_en: String(row.name_en),
          name_th: row.name_th ? String(row.name_th) : null,
          description: row.description ? String(row.description) : null,
          discount_type: row.discount_type as RatePlan["discount_type"],
          discount_value: toNumber(row.discount_value),
          min_nights: Math.max(1, Math.trunc(toNumber(row.min_nights))),
          max_nights: row.max_nights == null ? null : Math.trunc(toNumber(row.max_nights)),
          valid_from: row.valid_from ? String(row.valid_from) : null,
          valid_until: row.valid_until ? String(row.valid_until) : null,
          is_active: Boolean(row.is_active),
          apply_to_room_types: Array.isArray(row.apply_to_room_types)
            ? row.apply_to_room_types.map((v) => Math.trunc(toNumber(v))).filter((v) => v > 0)
            : null,
          sort_order: Math.trunc(toNumber(row.sort_order)),
          tier_codes: Array.isArray(row.tier_codes) ? row.tier_codes.map((v) => String(v) as RatePlanTierCode) : [],
          profile_ids: Array.isArray(row.profile_ids) ? row.profile_ids.map((v) => String(v)) : [],
          eligibility_source: row.eligibility_source
            ? String(row.eligibility_source) as RatePlanEligibilitySource
            : "public",
          eligibility_badges: Array.isArray(row.eligibility_badges) ? row.eligibility_badges.map((v) => String(v)) : [],
          access_summary: row.access_summary && typeof row.access_summary === "object"
            ? {
                is_public: Boolean((row.access_summary as Record<string, unknown>).is_public),
                label: String((row.access_summary as Record<string, unknown>).label ?? "Public"),
              }
            : { is_public: true, label: "Public" },
        }));
        setPlans(mapped);
      } catch (err) {
        if (alive) setError((err as Error).message);
      } finally {
        if (alive) setLoading(false);
      }
    }

    loadPlans();
    return () => {
      alive = false;
    };
  }, [checkinDate, checkoutDate, guestProfileId, nights, roomTypeId]);

  const filteredPlans = useMemo(() => plans, [plans]);

  useEffect(() => {
    if (loading) return;
    if (!value) return;

    const selected = filteredPlans.find((plan) => plan.id === value);
    if (!selected) {
      onChange("", undefined, { clearedIneligible: true });
    }
  }, [filteredPlans, loading, onChange, value]);

  function handleSelect(planId: string) {
    if (!planId) {
      onChange("");
      return;
    }
    const selected = filteredPlans.find((plan) => plan.id === planId);
    if (!selected) return;
    onChange(planId, selected);
  }

  return (
    <div className="space-y-1">
      <label className="form-label">Rate Plan</label>
      <select
        className="form-select"
        value={value}
        onChange={(e) => handleSelect(e.target.value)}
        disabled={disabled || loading}
      >
        <option value="">
          {loading ? "Loading rate plans..." : "Rack / Rate Grid (No Rate Plan)"}
        </option>
        {!loading && filteredPlans.map((plan) => (
          <option key={plan.id} value={plan.id}>
            {formatPlanLabel(plan)}
          </option>
        ))}
      </select>
      {!loading && filteredPlans.length === 0 && (
        <p className="text-xs text-amber-700">No eligible rate plans for this guest. Public rates only appear before profile selection or when available.</p>
      )}
      {!guestProfileId && !loading && (
        <p className="text-xs text-slate-500">Select guest profile to see tier and special rates.</p>
      )}
      {error && (
        <p className="text-xs text-rose-600">{error}</p>
      )}
    </div>
  );
}
