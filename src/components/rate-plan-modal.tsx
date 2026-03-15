"use client";

import { useEffect, useMemo, useState } from "react";
import PmsModal from "./pms-modal";
import type { RatePlan } from "./rate-plan-select";
import { RATE_PLAN_TIER_LABEL } from "@/lib/rate-plan-eligibility";

type TierCode = "loyal" | "vip" | "longest";

type RoomTypeOption = {
  id: string;
  name_en: string;
  sort_order?: number | null;
};

type GuestProfileOption = {
  id: string;
  first_name: string;
  last_name: string;
  member_no: string | null;
  vip_tier: string | null;
  profile_status: string | null;
};

interface RatePlanModalProps {
  mode: "create" | "edit";
  ratePlan?: RatePlan | null;
  onClose: () => void;
  onSuccess: (ratePlan: RatePlan) => void;
}

type FormState = {
  code: string;
  name_en: string;
  name_th: string;
  description: string;
  discount_type: "percent" | "fixed" | "override";
  discount_value: string;
  min_nights: string;
  max_nights: string;
  valid_from: string;
  valid_until: string;
  is_active: boolean;
  apply_all: boolean;
  apply_to_room_types: string[];
  sort_order: string;
  tier_codes: TierCode[];
  profile_ids: string[];
};

function makeDefaultForm(ratePlan?: RatePlan | null): FormState {
  if (!ratePlan) {
    return {
      code: "",
      name_en: "",
      name_th: "",
      description: "",
      discount_type: "percent",
      discount_value: "0",
      min_nights: "1",
      max_nights: "",
      valid_from: "",
      valid_until: "",
      is_active: true,
      apply_all: true,
      apply_to_room_types: [],
      sort_order: "0",
      tier_codes: [],
      profile_ids: [],
    };
  }

  const typeIds = Array.isArray(ratePlan.apply_to_room_types)
    ? ratePlan.apply_to_room_types.map((id) => String(id))
    : [];

  return {
    code: ratePlan.code,
    name_en: ratePlan.name_en,
    name_th: ratePlan.name_th ?? "",
    description: ratePlan.description ?? "",
    discount_type: ratePlan.discount_type,
    discount_value: String(ratePlan.discount_value),
    min_nights: String(ratePlan.min_nights ?? 1),
    max_nights: ratePlan.max_nights == null ? "" : String(ratePlan.max_nights),
    valid_from: ratePlan.valid_from ?? "",
    valid_until: ratePlan.valid_until ?? "",
    is_active: Boolean(ratePlan.is_active),
    apply_all: !Array.isArray(ratePlan.apply_to_room_types) || ratePlan.apply_to_room_types.length === 0,
    apply_to_room_types: typeIds,
    sort_order: String(ratePlan.sort_order ?? 0),
    tier_codes: Array.isArray(ratePlan.tier_codes) ? ratePlan.tier_codes : [],
    profile_ids: Array.isArray(ratePlan.profile_ids) ? ratePlan.profile_ids : [],
  };
}

function toNumber(value: string): number {
  const n = Number(value);
  return Number.isFinite(n) ? n : NaN;
}

export default function RatePlanModal({ mode, ratePlan, onClose, onSuccess }: RatePlanModalProps) {
  const [form, setForm] = useState<FormState>(() => makeDefaultForm(ratePlan));
  const [roomTypes, setRoomTypes] = useState<RoomTypeOption[]>([]);
  const [selectedProfiles, setSelectedProfiles] = useState<GuestProfileOption[]>([]);
  const [profileQuery, setProfileQuery] = useState("");
  const [profileResults, setProfileResults] = useState<GuestProfileOption[]>([]);
  const [searchingProfiles, setSearchingProfiles] = useState(false);
  const [loadingRoomTypes, setLoadingRoomTypes] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [showValidation, setShowValidation] = useState(false);

  useEffect(() => {
    setForm(makeDefaultForm(ratePlan));
    setSelectedProfiles([]);
  }, [ratePlan]);

  useEffect(() => {
    let alive = true;

    async function loadRoomTypes() {
      setLoadingRoomTypes(true);
      try {
        const res = await fetch("/api/booking-meta");
        const payload = await res.json();
        if (!res.ok || !payload.success || !Array.isArray(payload.roomTypes)) {
          throw new Error(payload.error ?? "Failed to load room types.");
        }
        if (!alive) return;

        const options = payload.roomTypes.map((row: Record<string, unknown>) => ({
          id: String(row.id),
          name_en: String(row.name_en ?? row.code ?? `Type ${row.id}`),
          sort_order: row.sort_order == null ? null : Number(row.sort_order)
        })) as RoomTypeOption[];

        setRoomTypes(options);
      } catch (err) {
        if (alive) setError((err as Error).message);
      } finally {
        if (alive) setLoadingRoomTypes(false);
      }
    }

    loadRoomTypes();
    return () => {
      alive = false;
    };
  }, []);

  useEffect(() => {
    let alive = true;

    async function loadSelectedProfiles() {
      const ids = form.profile_ids;
      if (ids.length === 0) {
        setSelectedProfiles([]);
        return;
      }

      try {
        const requests = ids.map((id) => fetch(`/api/guests/${id}`).then((res) => res.json()));
        const payloads = await Promise.all(requests);
        if (!alive) return;
        const profiles = payloads
          .filter((payload) => payload?.success && payload?.profile)
          .map((payload) => payload.profile as GuestProfileOption);
        setSelectedProfiles(profiles);
      } catch {
        if (alive) setSelectedProfiles([]);
      }
    }

    loadSelectedProfiles();
    return () => {
      alive = false;
    };
  }, [form.profile_ids]);

  useEffect(() => {
    let alive = true;
    const q = profileQuery.trim();
    if (q.length < 3) {
      setProfileResults([]);
      setSearchingProfiles(false);
      return;
    }

    const timer = setTimeout(async () => {
      setSearchingProfiles(true);
      try {
        const params = new URLSearchParams({
          q,
          limit: "8",
          include_merged: "0",
          show_all: "0",
        });
        const res = await fetch(`/api/guests?${params.toString()}`);
        const payload = await res.json();
        if (!res.ok || !payload.success) {
          throw new Error(payload.error ?? "Failed to search guest profiles.");
        }
        if (!alive) return;
        setProfileResults((payload.profiles ?? []) as GuestProfileOption[]);
      } catch (err) {
        if (alive) setError((err as Error).message);
      } finally {
        if (alive) setSearchingProfiles(false);
      }
    }, 250);

    return () => {
      alive = false;
      clearTimeout(timer);
    };
  }, [profileQuery]);

  const actionLabel = useMemo(() => (mode === "create" ? "Create Rate Plan" : "Save Changes"), [mode]);

  function setField<K extends keyof FormState>(field: K, value: FormState[K]) {
    setForm((prev) => ({ ...prev, [field]: value }));
  }

  function toggleRoomType(roomTypeId: string) {
    setForm((prev) => {
      const has = prev.apply_to_room_types.includes(roomTypeId);
      return {
        ...prev,
        apply_to_room_types: has
          ? prev.apply_to_room_types.filter((id) => id !== roomTypeId)
          : [...prev.apply_to_room_types, roomTypeId]
      };
    });
  }

  function toggleTierCode(tierCode: TierCode) {
    setForm((prev) => ({
      ...prev,
      tier_codes: prev.tier_codes.includes(tierCode)
        ? prev.tier_codes.filter((code) => code !== tierCode)
        : [...prev.tier_codes, tierCode],
    }));
  }

  function addProfile(profile: GuestProfileOption) {
    setForm((prev) => ({
      ...prev,
      profile_ids: prev.profile_ids.includes(profile.id)
        ? prev.profile_ids
        : [...prev.profile_ids, profile.id],
    }));
    setProfileQuery("");
    setProfileResults([]);
  }

  function removeProfile(profileId: string) {
    setForm((prev) => ({
      ...prev,
      profile_ids: prev.profile_ids.filter((id) => id !== profileId),
    }));
  }

  const codeInvalid = showValidation && !form.code.trim();
  const nameEnInvalid = showValidation && !form.name_en.trim();
  const discountValueNum = Number(form.discount_value);
  const discountValueInvalid = showValidation && (!Number.isFinite(discountValueNum) || discountValueNum < 0);
  const minNightsNum = Math.trunc(Number(form.min_nights));
  const minNightsInvalid = showValidation && (!Number.isFinite(minNightsNum) || minNightsNum < 1);
  const maxNightsNum = form.max_nights.trim() ? Math.trunc(Number(form.max_nights)) : null;
  const maxNightsInvalid =
    showValidation &&
    maxNightsNum != null &&
    (!Number.isFinite(maxNightsNum) || maxNightsNum < (Number.isFinite(minNightsNum) ? minNightsNum : 1));
  const sortOrderNum = Math.trunc(Number(form.sort_order));
  const sortOrderInvalid = showValidation && !Number.isFinite(sortOrderNum);
  const validRangeInvalid = showValidation && Boolean(form.valid_from && form.valid_until && form.valid_until < form.valid_from);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setShowValidation(true);
    setError("");

    const code = form.code.trim().toUpperCase();
    const nameEn = form.name_en.trim();
    const discountValue = toNumber(form.discount_value);
    const minNights = Math.trunc(toNumber(form.min_nights));
    const maxNights = form.max_nights.trim() ? Math.trunc(toNumber(form.max_nights)) : null;
    const sortOrder = Math.trunc(toNumber(form.sort_order));

    if (!code) return setError("Code is required.");
    if (!nameEn) return setError("Name EN is required.");
    if (!Number.isFinite(discountValue) || discountValue < 0) return setError("Discount value must be >= 0.");
    if (!Number.isFinite(minNights) || minNights < 1) return setError("Min nights must be >= 1.");
    if (maxNights != null && (!Number.isFinite(maxNights) || maxNights < minNights)) {
      return setError("Max nights must be >= min nights.");
    }
    if (!Number.isFinite(sortOrder)) return setError("Sort order is invalid.");
    if (form.valid_from && form.valid_until && form.valid_until < form.valid_from) {
      return setError("Valid until must be after valid from.");
    }

    const payload = {
      code,
      name_en: nameEn,
      name_th: form.name_th.trim() || null,
      description: form.description.trim() || null,
      discount_type: form.discount_type,
      discount_value: Number(discountValue.toFixed(2)),
      min_nights: minNights,
      max_nights: maxNights,
      valid_from: form.valid_from || null,
      valid_until: form.valid_until || null,
      is_active: form.is_active,
      apply_to_room_types: form.apply_all
        ? null
        : form.apply_to_room_types.map((id) => Number(id)).filter((id) => Number.isFinite(id)),
      sort_order: sortOrder
      ,
      tier_codes: form.tier_codes,
      profile_ids: form.profile_ids,
    };

    setSaving(true);
    try {
      const endpoint = mode === "create" ? "/api/rate-plans" : `/api/rate-plans/${ratePlan?.id}`;
      const method = mode === "create" ? "POST" : "PATCH";
      const res = await fetch(endpoint, {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload)
      });
      const response = await res.json();
      if (!res.ok || !response.success) {
        throw new Error(response.error ?? "Could not save rate plan.");
      }
      onSuccess(response.ratePlan as RatePlan);
      setShowValidation(false);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <PmsModal
      title={mode === "create" ? "New Rate Plan" : `Edit Rate Plan ${ratePlan?.code ?? ""}`}
      size="lg"
      onClose={onClose}
      footer={
        <div className="flex gap-2 w-full">
          <button type="button" className="btn btn-secondary flex-1" onClick={onClose} disabled={saving}>
            Cancel
          </button>
          <button form="rate-plan-form" type="submit" className="btn btn-primary flex-1" disabled={saving}>
            {saving ? "Saving..." : actionLabel}
          </button>
        </div>
      }
    >
      <form id="rate-plan-form" onSubmit={handleSubmit} className="space-y-4">
        {error && (
          <div className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700">
            {error}
          </div>
        )}

        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="form-label">Code *</label>
            <input
              className="form-input"
              value={form.code}
              onChange={(e) => setField("code", e.target.value.toUpperCase())}
              placeholder="RACK / VIP / PROMO"
              maxLength={20}
              required
              aria-invalid={codeInvalid ? "true" : "false"}
            />
            {codeInvalid && <p className="mt-1 text-xs text-rose-600">Code is required.</p>}
          </div>
          <div>
            <label className="form-label">Name (EN) *</label>
            <input
              className="form-input"
              value={form.name_en}
              onChange={(e) => setField("name_en", e.target.value)}
              placeholder="Rack Rate"
              required
              aria-invalid={nameEnInvalid ? "true" : "false"}
            />
            {nameEnInvalid && <p className="mt-1 text-xs text-rose-600">Name (EN) is required.</p>}
          </div>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="form-label">Name (TH)</label>
            <input
              className="form-input"
              value={form.name_th}
              onChange={(e) => setField("name_th", e.target.value)}
              placeholder="ราคาปกติ"
            />
          </div>
          <div>
            <label className="form-label">Sort Order</label>
            <input
              type="number"
              className="form-input"
              value={form.sort_order}
              onChange={(e) => setField("sort_order", e.target.value)}
              aria-invalid={sortOrderInvalid ? "true" : "false"}
            />
          </div>
        </div>

        <div>
          <label className="form-label">Description</label>
          <textarea
            className="form-input min-h-[72px]"
            value={form.description}
            onChange={(e) => setField("description", e.target.value)}
            placeholder="Describe when this rate plan should be used..."
          />
        </div>

        <div className="grid grid-cols-4 gap-3">
          <div>
            <label className="form-label">Discount Type *</label>
            <select className="form-select" value={form.discount_type} onChange={(e) => setField("discount_type", e.target.value as FormState["discount_type"])}>
              <option value="percent">Percent</option>
              <option value="fixed">Fixed THB Off</option>
              <option value="override">Override THB/Night</option>
            </select>
          </div>
          <div>
            <label className="form-label">Value *</label>
            <input
              type="number"
              step="0.01"
              min="0"
              className="form-input"
              value={form.discount_value}
              onChange={(e) => setField("discount_value", e.target.value)}
              required
              aria-invalid={discountValueInvalid ? "true" : "false"}
            />
          </div>
          <div>
            <label className="form-label">Min Nights</label>
            <input
              type="number"
              min="1"
              className="form-input"
              value={form.min_nights}
              onChange={(e) => setField("min_nights", e.target.value)}
              required
              aria-invalid={minNightsInvalid ? "true" : "false"}
            />
          </div>
          <div>
            <label className="form-label">Max Nights</label>
            <input
              type="number"
              min="1"
              className="form-input"
              value={form.max_nights}
              onChange={(e) => setField("max_nights", e.target.value)}
              placeholder="optional"
              aria-invalid={maxNightsInvalid ? "true" : "false"}
            />
          </div>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="form-label">Valid From</label>
            <input
              type="date"
              className="form-input"
              value={form.valid_from}
              onChange={(e) => setField("valid_from", e.target.value)}
              aria-invalid={validRangeInvalid ? "true" : "false"}
            />
          </div>
          <div>
            <label className="form-label">Valid Until</label>
            <input
              type="date"
              className="form-input"
              value={form.valid_until}
              onChange={(e) => setField("valid_until", e.target.value)}
              aria-invalid={validRangeInvalid ? "true" : "false"}
            />
          </div>
        </div>
        {validRangeInvalid && (
          <p className="-mt-2 text-xs text-rose-600">Valid until must be after valid from.</p>
        )}

        <div className="rounded-xl border border-[var(--border-default)] p-3">
          <div className="flex items-center justify-between mb-2">
            <p className="text-sm font-semibold text-[var(--text-table-cell)]">Applicable Room Types</p>
            <label className="flex items-center gap-2 text-xs text-[var(--text-secondary)]">
              <input
                type="checkbox"
                checked={form.apply_all}
                onChange={(e) => setField("apply_all", e.target.checked)}
              />
              Apply to all room types
            </label>
          </div>

          {!form.apply_all && (
            <div className="grid grid-cols-2 gap-2 max-h-36 overflow-y-auto">
              {loadingRoomTypes ? (
                <p className="text-xs text-[var(--text-secondary)]">Loading room types...</p>
              ) : (
                roomTypes.map((roomType) => (
                  <label key={roomType.id} className="flex items-center gap-2 text-sm text-[var(--text-table-cell)]">
                    <input
                      type="checkbox"
                      checked={form.apply_to_room_types.includes(roomType.id)}
                      onChange={() => toggleRoomType(roomType.id)}
                    />
                    {roomType.name_en}
                  </label>
                ))
              )}
            </div>
          )}
        </div>

        <div className="rounded-xl border border-[var(--border-default)] p-3 space-y-3">
          <div>
            <p className="text-sm font-semibold text-[var(--text-table-cell)]">Guest Tiers</p>
            <p className="text-xs text-[var(--text-secondary)] mt-1">Exact match rule. Select the tiers that can access this rate plan.</p>
          </div>
          <div className="grid grid-cols-3 gap-2">
            {(["loyal", "vip", "longest"] as TierCode[]).map((tierCode) => (
              <label key={tierCode} className="flex items-center gap-2 rounded-lg border border-[var(--border-default)] bg-[var(--bg-body)] px-3 py-2 text-sm text-[var(--text-table-cell)]">
                <input
                  type="checkbox"
                  checked={form.tier_codes.includes(tierCode)}
                  onChange={() => toggleTierCode(tierCode)}
                />
                {RATE_PLAN_TIER_LABEL[tierCode]}
              </label>
            ))}
          </div>
        </div>

        <div className="rounded-xl border border-[var(--border-default)] p-3 space-y-3">
          <div>
            <p className="text-sm font-semibold text-[var(--text-table-cell)]">Special Guests</p>
            <p className="text-xs text-[var(--text-secondary)] mt-1">Search guest profiles by name, phone, or member number. Draft and verified profiles are both allowed.</p>
          </div>

          <div>
            <label className="form-label">Search Profiles</label>
            <input
              className="form-input"
              value={profileQuery}
              onChange={(e) => setProfileQuery(e.target.value)}
              placeholder="Type at least 3 characters..."
            />
          </div>

          {profileQuery.trim().length > 0 && profileQuery.trim().length < 3 && (
            <p className="text-xs text-[var(--text-secondary)]">Type at least 3 characters to search.</p>
          )}

          {searchingProfiles && (
            <p className="text-xs text-[var(--text-secondary)]">Searching profiles...</p>
          )}

          {!searchingProfiles && profileResults.length > 0 && (
            <div className="max-h-40 overflow-y-auto rounded-lg border border-[var(--border-default)]">
              {profileResults.map((profile) => {
                const fullName = `${profile.first_name ?? ""} ${profile.last_name ?? ""}`.trim() || "Unnamed profile";
                const alreadySelected = form.profile_ids.includes(profile.id);
                return (
                  <button
                    key={profile.id}
                    type="button"
                    className="flex w-full items-center justify-between border-b border-[var(--border-subtle)] px-3 py-2 text-left text-sm last:border-b-0 hover:bg-[var(--bg-body)] disabled:opacity-60"
                    onClick={() => addProfile(profile)}
                    disabled={alreadySelected}
                  >
                    <span>
                      <span className="font-medium text-slate-800">{fullName}</span>
                      <span className="ml-2 text-xs text-[var(--text-secondary)]">
                        {profile.member_no ? `#${profile.member_no}` : profile.profile_status ?? "guest"}
                      </span>
                    </span>
                    <span className="text-xs font-medium text-brand-700">
                      {alreadySelected ? "Added" : "Add"}
                    </span>
                  </button>
                );
              })}
            </div>
          )}

          <div className="space-y-2">
            <p className="text-xs font-semibold uppercase tracking-widest text-[var(--text-secondary)]">Selected Profiles</p>
            {selectedProfiles.length === 0 ? (
              <p className="text-sm text-[var(--text-secondary)]">No special guest profiles selected. This rate plan will rely on public or tier access only.</p>
            ) : (
              <div className="space-y-2">
                {selectedProfiles.map((profile) => {
                  const fullName = `${profile.first_name ?? ""} ${profile.last_name ?? ""}`.trim() || "Unnamed profile";
                  return (
                    <div key={profile.id} className="flex items-center justify-between rounded-lg border border-[var(--border-default)] bg-[var(--bg-body)] px-3 py-2 text-sm">
                      <div>
                        <p className="font-medium text-slate-800">{fullName}</p>
                        <p className="text-xs text-[var(--text-secondary)]">
                          {profile.member_no ? `#${profile.member_no} · ` : ""}
                          {profile.profile_status ?? "guest"}
                        </p>
                      </div>
                      <button
                        type="button"
                        className="btn btn-secondary btn-sm"
                        onClick={() => removeProfile(profile.id)}
                      >
                        Remove
                      </button>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>

        <div className="rounded-xl border border-dashed border-[var(--border-input)] bg-[var(--bg-body)] px-3 py-2 text-sm text-[var(--text-secondary)]">
          Access summary:{" "}
          {form.profile_ids.length > 0
            ? `Special: ${form.profile_ids.length} profile${form.profile_ids.length === 1 ? "" : "s"}`
            : form.tier_codes.length > 0
              ? `Tier: ${form.tier_codes.map((code) => RATE_PLAN_TIER_LABEL[code]).join(", ")}`
              : "Public"}
        </div>

        <label className="flex items-center gap-2 text-sm text-[var(--text-table-cell)]">
          <input
            type="checkbox"
            checked={form.is_active}
            onChange={(e) => setField("is_active", e.target.checked)}
          />
          Active
        </label>
      </form>
    </PmsModal>
  );
}
