"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import PmsModal from "@/components/pms-modal";
import { formatNationalityCode, getNationalityFlag } from "@/lib/nationality";
import { formatGuestDisplayName, getProfileStatusMeta, getVipTierMeta } from "@/lib/guest-profile-display";
import type { GuestProfileListItem, GuestProfileListResponse } from "@/lib/types";

type ProfileStatusFilter = "all" | "verified" | "draft";
type VipBucketFilter = "all" | "regular" | "vip";
type BlacklistFilter = "all" | "normal" | "blacklisted";

type QuickCreateForm = {
  first_name: string;
  last_name: string;
  phone: string;
  nationality_code: string;
  document_type: "thai_id" | "passport" | "other";
  document_number: string;
  profile_status: "draft" | "verified";
  vip_tier: "regular" | "loyal" | "vip" | "longest";
};

const DEFAULT_RESPONSE: GuestProfileListResponse = {
  success: true,
  requires_search: true,
  profiles: [],
  summary: {
    matched: 0,
    verified: 0,
    draft: 0,
    vip: 0,
  },
  total: 0,
  page: 1,
  page_size: 25,
  total_pages: 0,
};

const EMPTY_FORM: QuickCreateForm = {
  first_name: "",
  last_name: "",
  phone: "",
  nationality_code: "",
  document_type: "passport",
  document_number: "",
  profile_status: "draft",
  vip_tier: "regular",
};

function formatLastStay(value: string | null) {
  if (!value) return "—";
  const date = new Date(`${value}T00:00:00`);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat("en-GB", {
    day: "2-digit",
    month: "2-digit",
    year: "2-digit",
  }).format(date);
}

function hasNonDefaultFilter(
  profileStatus: ProfileStatusFilter,
  vipBucket: VipBucketFilter,
  blacklist: BlacklistFilter
) {
  return profileStatus !== "all" || vipBucket !== "all" || blacklist !== "all";
}

function EmptySearchState() {
  return (
    <div className="rounded-2xl border border-dashed border-[var(--border-default)] bg-[var(--bg-surface)] px-6 py-16 text-center">
      <h2 className="mt-5 text-xl font-semibold text-[var(--text-primary)]">Type at least 3 characters to search guest profiles</h2>
      <p className="mt-3 text-sm leading-7 text-[var(--text-secondary)]">
        You can also filter by Verified, Draft, VIP, or Blacklisted.
      </p>
    </div>
  );
}

function NoResultsState() {
  return (
    <div className="rounded-2xl border border-[var(--border-default)] bg-[var(--bg-surface)] px-6 py-14 text-center text-sm text-[var(--text-secondary)]">
      No guest profiles matched this search.
    </div>
  );
}

function QuickCreateGuestModal({
  form,
  saving,
  error,
  showValidation,
  onChange,
  onClose,
  onSave,
}: {
  form: QuickCreateForm;
  saving: boolean;
  error: string;
  showValidation: boolean;
  onChange: (patch: Partial<QuickCreateForm>) => void;
  onClose: () => void;
  onSave: () => void;
}) {
  const lastNameInvalid = showValidation && !form.last_name.trim();
  return (
    <PmsModal
      title="New Guest"
      size="md"
      onClose={onClose}
      footer={
        <>
          <button className="btn btn-secondary" onClick={onClose} disabled={saving}>
            Cancel
          </button>
          <button className="btn btn-primary" onClick={onSave} disabled={saving}>
            {saving ? "Saving..." : "Create Guest"}
          </button>
        </>
      }
    >
      <div className="space-y-4">
        {error ? (
          <div className="rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">{error}</div>
        ) : null}

        <div className="grid gap-4 md:grid-cols-2">
          <div>
            <label className="form-label">First Name</label>
            <input
              className="form-input"
              value={form.first_name}
              onChange={(event) => onChange({ first_name: event.target.value })}
              placeholder="Optional"
            />
          </div>
          <div>
            <label className="form-label">Last Name *</label>
            <input
              className="form-input"
              value={form.last_name}
              onChange={(event) => onChange({ last_name: event.target.value })}
              placeholder="Required"
              required
              aria-invalid={lastNameInvalid ? "true" : "false"}
            />
            {lastNameInvalid ? <p className="mt-1 text-xs text-rose-600">Last Name is required.</p> : null}
          </div>
          <div>
            <label className="form-label">Phone</label>
            <input
              className="form-input"
              value={form.phone}
              onChange={(event) => onChange({ phone: event.target.value })}
              placeholder="080..."
            />
          </div>
          <div>
            <label className="form-label">Nationality</label>
            <input
              className="form-input"
              value={form.nationality_code}
              onChange={(event) => onChange({ nationality_code: event.target.value.toUpperCase() })}
              placeholder="THA"
              maxLength={3}
            />
          </div>
          <div>
            <label className="form-label">Document Type</label>
            <select
              className="form-select"
              value={form.document_type}
              onChange={(event) =>
                onChange({ document_type: event.target.value as QuickCreateForm["document_type"] })
              }
            >
              <option value="passport">Passport</option>
              <option value="thai_id">Thai ID</option>
              <option value="other">Other ID</option>
            </select>
          </div>
          <div>
            <label className="form-label">Passport / ID</label>
            <input
              className="form-input"
              value={form.document_number}
              onChange={(event) => onChange({ document_number: event.target.value })}
              placeholder={form.document_type === "passport" ? "AB123..." : "1-xxxx / 123..."}
            />
          </div>
          <div>
            <label className="form-label">Profile Status</label>
            <select
              className="form-select"
              value={form.profile_status}
              onChange={(event) =>
                onChange({ profile_status: event.target.value as QuickCreateForm["profile_status"] })
              }
            >
              <option value="draft">Draft</option>
              <option value="verified">Verified</option>
            </select>
          </div>
          <div>
            <label className="form-label">Tier</label>
            <select
              className="form-select"
              value={form.vip_tier}
              onChange={(event) => onChange({ vip_tier: event.target.value as QuickCreateForm["vip_tier"] })}
            >
              <option value="regular">Regular</option>
              <option value="loyal">Loyal</option>
              <option value="vip">VIP</option>
              <option value="longest">VIP+</option>
            </select>
          </div>
        </div>
      </div>
    </PmsModal>
  );
}

export default function GuestsPage() {
  const router = useRouter();
  const [query, setQuery] = useState("");
  const [debouncedQuery, setDebouncedQuery] = useState("");
  const [profileStatus, setProfileStatus] = useState<ProfileStatusFilter>("all");
  const [vipBucket, setVipBucket] = useState<VipBucketFilter>("all");
  const [blacklist, setBlacklist] = useState<BlacklistFilter>("all");
  const [showAllProfiles, setShowAllProfiles] = useState(false);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [response, setResponse] = useState<GuestProfileListResponse>(DEFAULT_RESPONSE);
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [createForm, setCreateForm] = useState<QuickCreateForm>(EMPTY_FORM);
  const [createSaving, setCreateSaving] = useState(false);
  const [createError, setCreateError] = useState("");
  const [showCreateValidation, setShowCreateValidation] = useState(false);

  const searchReady = debouncedQuery.trim().length >= 3;
  const filterReady = hasNonDefaultFilter(profileStatus, vipBucket, blacklist);
  const canSearch = searchReady || filterReady || showAllProfiles;

  useEffect(() => {
    const timer = window.setTimeout(() => setDebouncedQuery(query.trim()), 380);
    return () => window.clearTimeout(timer);
  }, [query]);

  useEffect(() => {
    setPage(1);
  }, [debouncedQuery, profileStatus, vipBucket, blacklist, showAllProfiles]);

  const loadGuests = useCallback(async () => {
    if (!canSearch) {
      setLoading(false);
      setError("");
      setResponse({ ...DEFAULT_RESPONSE, page, page_size: DEFAULT_RESPONSE.page_size });
      return;
    }

    setLoading(true);
    setError("");
    try {
      const params = new URLSearchParams();
      if (searchReady || showAllProfiles) params.set("q", debouncedQuery.trim());
      params.set("page", String(page));
      params.set("limit", "25");
      params.set("profile_status", profileStatus);
      params.set("vip_bucket", vipBucket);
      params.set("blacklisted", blacklist);
      if (showAllProfiles) {
        params.set("show_all", "1");
        params.set("include_merged", "1");
      }

      const res = await fetch(`/api/guests?${params.toString()}`, { cache: "no-store" });
      const data = (await res.json()) as GuestProfileListResponse & { error?: string };

      if (!res.ok || data.success === false) {
        throw new Error(data.error || "Failed to load guest profiles.");
      }

      setResponse(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load guest profiles.");
    } finally {
      setLoading(false);
    }
  }, [blacklist, canSearch, debouncedQuery, page, profileStatus, searchReady, showAllProfiles, vipBucket]);

  useEffect(() => {
    void loadGuests();
  }, [loadGuests]);

  const profiles = response.profiles ?? [];
  const clearFilters = () => {
    setQuery("");
    setDebouncedQuery("");
    setProfileStatus("all");
    setVipBucket("all");
    setBlacklist("all");
    setShowAllProfiles(false);
  };

  const hasActiveFilters = useMemo(
    () => hasNonDefaultFilter(profileStatus, vipBucket, blacklist) || query.trim().length > 0 || showAllProfiles,
    [blacklist, profileStatus, query, showAllProfiles, vipBucket]
  );

  async function handleQuickCreate() {
    setShowCreateValidation(true);
    if (!createForm.last_name.trim()) {
      setCreateError("Last Name is required.");
      return;
    }

    setCreateSaving(true);
    setCreateError("");
    try {
      const response = await fetch("/api/guests", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          first_name: createForm.first_name.trim() || null,
          last_name: createForm.last_name.trim(),
          phone: createForm.phone.trim() || null,
          nationality_code: createForm.nationality_code.trim() || null,
          id_type: createForm.document_number.trim() ? createForm.document_type : null,
          id_number:
            createForm.document_number.trim() && createForm.document_type !== "passport"
              ? createForm.document_number.trim()
              : null,
          passport_no:
            createForm.document_number.trim() && createForm.document_type === "passport"
              ? createForm.document_number.trim()
              : null,
          profile_status: createForm.profile_status,
          vip_tier: createForm.vip_tier,
        }),
      });

      const payload = await response.json();
      if (!response.ok || payload.success === false) {
        throw new Error(payload.error || "Failed to create guest.");
      }

      setShowCreateModal(false);
      setCreateForm(EMPTY_FORM);
      setShowCreateValidation(false);
      router.push(`/pms/guests/${payload.profile.id}`);
    } catch (err) {
      setCreateError(err instanceof Error ? err.message : "Failed to create guest.");
    } finally {
      setCreateSaving(false);
    }
  }

  return (
    <div className="mx-auto max-w-7xl space-y-6 p-6">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-[var(--text-primary)]">Guest Profiles</h1>
          <p className="mt-1 text-sm text-[var(--text-secondary)]">Manage guest records and stay history.</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Link href="/pms/guests/duplicates" className="btn btn-secondary">
            Merge Profiles
          </Link>
          <button
            className="btn btn-primary"
            onClick={() => {
              setCreateError("");
              setCreateForm(EMPTY_FORM);
              setShowCreateValidation(false);
              setShowCreateModal(true);
            }}
          >
            + New Guest
          </button>
        </div>
      </div>

      <div className="card overflow-hidden">
        <div className="border-b border-[var(--border-default)] bg-[var(--bg-surface)] px-5 py-4">
          <div className="grid gap-3 xl:grid-cols-[minmax(0,1fr)_200px_180px_190px_auto] xl:items-center">
            <div className="relative">
              <input
                className="form-input"
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="Search name, phone, passport, Thai ID..."
              />
            </div>
            <select
              className="form-select"
              value={profileStatus}
              onChange={(event) => setProfileStatus(event.target.value as ProfileStatusFilter)}
            >
              <option value="all">Status</option>
              <option value="verified">Verified</option>
              <option value="draft">Draft</option>
            </select>
            <select
              className="form-select"
              value={vipBucket}
              onChange={(event) => setVipBucket(event.target.value as VipBucketFilter)}
            >
              <option value="all">Tier</option>
              <option value="regular">Regular</option>
              <option value="vip">VIP</option>
            </select>
            <select
              className="form-select"
              value={blacklist}
              onChange={(event) => setBlacklist(event.target.value as BlacklistFilter)}
            >
              <option value="all">Flag</option>
              <option value="normal">Normal</option>
              <option value="blacklisted">Blacklisted</option>
            </select>
            <div className="flex justify-end">
              <div className="flex items-center gap-2">
                <button
                  className={`btn btn-sm ${showAllProfiles ? "btn-primary" : "btn-secondary"}`}
                  onClick={() => setShowAllProfiles((prev) => !prev)}
                >
                  {showAllProfiles ? "Showing All" : "Show All"}
                </button>
                <button
                  className="btn btn-ghost btn-sm"
                  onClick={clearFilters}
                  disabled={!hasActiveFilters}
                >
                  Clear Filters
                </button>
              </div>
            </div>
          </div>
        </div>

        {canSearch ? (
          <div className="border-b border-[var(--border-default)] bg-[var(--bg-body)] px-5 py-3 text-sm text-[var(--text-secondary)]">
            Matched: <span className="font-semibold text-[var(--text-primary)]">{response.summary.matched}</span>
            <span className="mx-3 text-slate-300">·</span>
            Verified: <span className="font-semibold text-[var(--text-primary)]">{response.summary.verified}</span>
            <span className="mx-3 text-slate-300">·</span>
            Draft: <span className="font-semibold text-[var(--text-primary)]">{response.summary.draft}</span>
            <span className="mx-3 text-slate-300">·</span>
            VIP: <span className="font-semibold text-[var(--text-primary)]">{response.summary.vip}</span>
          </div>
        ) : null}

        <div className="p-5">
          {error ? (
            <div className="rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">{error}</div>
          ) : null}

          {!canSearch ? (
            <EmptySearchState />
          ) : profiles.length === 0 && !loading ? (
            <NoResultsState />
          ) : (
            <>
              <div className="overflow-x-auto rounded-2xl border border-[var(--border-default)]">
                <table className="data-table">
                  <thead>
                    <tr>
                      <th>Name</th>
                      <th>Contact</th>
                      <th>Nat.</th>
                      <th>Status</th>
                      <th>Tier</th>
                      <th className="text-center">Main Stays</th>
                      <th>Last Stay</th>
                    </tr>
                  </thead>
                  <tbody>
                    {loading ? (
                      <tr>
                        <td colSpan={7} className="py-10 text-center text-sm text-[var(--text-secondary)]">
                          Loading guest profiles...
                        </td>
                      </tr>
                    ) : (
                      profiles.map((profile: GuestProfileListItem) => {
                        const statusMeta = getProfileStatusMeta(profile.profile_status, profile.blacklisted);
                        const vipMeta = getVipTierMeta(profile.vip_tier);
                        return (
                          <tr
                            key={profile.id}
                            className="cursor-pointer transition hover:bg-[var(--bg-body)]"
                            onClick={() => router.push(`/pms/guests/${profile.id}`)}
                          >
                            <td>
                              <div className="font-semibold text-[var(--text-primary)]">
                                {formatGuestDisplayName(profile)}
                              </div>
                              <div className="mt-1 text-xs font-mono text-[var(--text-muted)]">
                                {profile.member_no || profile.id.slice(0, 8)}
                              </div>
                            </td>
                            <td>
                              <div className="text-sm text-slate-800">{profile.phone || "—"}</div>
                              <div className="mt-1 text-xs text-[var(--text-muted)]">{profile.email || "—"}</div>
                            </td>
                            <td>
                              <div className="flex items-center gap-2 text-sm text-[var(--text-table-cell)]">
                                <span className="text-lg leading-none">
                                  {getNationalityFlag(profile.nationality_code || profile.country || "")}
                                </span>
                                <span>{formatNationalityCode(profile.nationality_code || profile.nationality || "—")}</span>
                              </div>
                            </td>
                            <td>
                              <span className={`badge text-xs ${statusMeta.tone}`}>{statusMeta.label}</span>
                            </td>
                            <td>
                              <span className={`badge text-xs ${vipMeta.tone}`}>{vipMeta.label}</span>
                            </td>
                            <td className="text-center font-semibold text-slate-800">{profile.stay_count}</td>
                            <td className="text-sm text-[var(--text-table-cell)]">{formatLastStay(profile.last_stay_date)}</td>
                          </tr>
                        );
                      })
                    )}
                  </tbody>
                </table>
              </div>

              <div className="flex flex-col gap-3 px-2 pt-4 text-sm text-[var(--text-table-cell)] sm:flex-row sm:items-center sm:justify-between">
                <div className="text-[var(--text-secondary)]">
                  {response.total > 0
                    ? `Showing ${(page - 1) * response.page_size + 1}-${Math.min(
                        page * response.page_size,
                        response.total
                      )} of ${response.total}`
                    : "Showing 0 results"}
                </div>
                <div className="flex items-center justify-center gap-3">
                  <button
                    className="btn btn-secondary btn-sm"
                    disabled={page <= 1 || loading}
                    onClick={() => setPage((current) => Math.max(1, current - 1))}
                  >
                    ◀ Prev
                  </button>
                  <span>
                    Page {response.total_pages === 0 ? 0 : page} of {response.total_pages}
                  </span>
                  <button
                    className="btn btn-secondary btn-sm"
                    disabled={loading || page >= response.total_pages}
                    onClick={() => setPage((current) => current + 1)}
                  >
                    Next ▶
                  </button>
                </div>
              </div>
            </>
          )}
        </div>
      </div>

      {showCreateModal ? (
        <QuickCreateGuestModal
          form={createForm}
          saving={createSaving}
          error={createError}
          showValidation={showCreateValidation}
          onChange={(patch) => setCreateForm((current) => ({ ...current, ...patch }))}
          onClose={() => {
            if (createSaving) return;
            setShowCreateModal(false);
            setShowCreateValidation(false);
          }}
          onSave={() => void handleQuickCreate()}
        />
      ) : null}
    </div>
  );
}
