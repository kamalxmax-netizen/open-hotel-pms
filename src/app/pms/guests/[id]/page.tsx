"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import PmsModal from "@/components/pms-modal";
import {
  formatGuestDisplayName,
  getProfileStatusMeta,
  getRoleMeta,
  getVipTierMeta,
  isVipBucket,
} from "@/lib/guest-profile-display";
import { formatNationalityCode, getNationalityFlag } from "@/lib/nationality";
import type {
  GuestHistoryResponse,
  GuestHistoryStay,
  GuestProfile,
  GuestStaySummary,
  GuestStaySummaryResponse,
} from "@/lib/types";

type GuestProfileResponse = {
  success: boolean;
  profile: GuestProfile;
};

type EditForm = {
  first_name: string;
  last_name: string;
  phone: string;
  email: string;
  whatsapp: string;
  line_id: string;
  gender: "M" | "F" | "Other" | "";
  dob: string;
  nationality_code: string;
  country: string;
  province: string;
  id_type: "thai_id" | "passport" | "other" | "";
  id_number: string;
  id_card_number: string;
  passport_no: string;
  vip_tier: string;
  profile_status: "draft" | "verified";
  preferences: string;
  notes: string;
  blacklisted: boolean;
};

function toEditForm(profile: GuestProfile): EditForm {
  return {
    first_name: profile.first_name ?? "",
    last_name: profile.last_name ?? "",
    phone: profile.phone ?? "",
    email: profile.email ?? "",
    whatsapp: profile.whatsapp ?? "",
    line_id: profile.line_id ?? "",
    gender: profile.gender ?? "",
    dob: profile.dob ?? "",
    nationality_code: profile.nationality_code ?? "",
    country: profile.country ?? "",
    province: profile.province ?? "",
    id_type: profile.id_type ?? "",
    id_number: profile.id_number ?? "",
    id_card_number: profile.id_card_number ?? "",
    passport_no: profile.passport_no ?? "",
    vip_tier: profile.vip_tier ?? "regular",
    profile_status: profile.profile_status === "verified" ? "verified" : "draft",
    preferences: profile.preferences ?? "",
    notes: profile.notes ?? "",
    blacklisted: profile.blacklisted,
  };
}

function fmtMoney(value: number | null | undefined) {
  return `฿${Number(value ?? 0).toLocaleString("en-US", {
    minimumFractionDigits: 0,
    maximumFractionDigits: 2,
  })}`;
}

function formatDate(value: string | null | undefined) {
  if (!value) return "—";
  const date = new Date(`${value}T00:00:00`);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat("en-GB", {
    day: "2-digit",
    month: "2-digit",
    year: "2-digit",
  }).format(date);
}

function formatDateTime(value: string | null | undefined) {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat("en-GB", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(date);
}

function valueOrDash(value: string | null | undefined) {
  const text = String(value ?? "").trim();
  return text || "—";
}

function sortStays(rows: GuestHistoryStay[]) {
  return [...rows].sort((a, b) => {
    const left = String(b.checkin_date ?? b.created_at ?? "");
    const right = String(a.checkin_date ?? a.created_at ?? "");
    return left.localeCompare(right);
  });
}

function countStayNights(rows: GuestHistoryStay[]) {
  return rows.reduce((sum, row) => {
    if (row.status !== "checked_out") return sum;
    const checkin = String(row.checkin_date ?? "").trim();
    const checkout = String(row.checkout_date ?? "").trim();
    if (!checkin || !checkout) return sum;
    const checkinMs = new Date(`${checkin}T00:00:00`).getTime();
    const checkoutMs = new Date(`${checkout}T00:00:00`).getTime();
    if (!Number.isFinite(checkinMs) || !Number.isFinite(checkoutMs)) return sum;
    const nights = Math.max(1, Math.round((checkoutMs - checkinMs) / 86400000));
    return sum + nights;
  }, 0);
}

function SummaryMetricCard({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="border-r border-[var(--border-default)] px-5 py-5 last:border-r-0">
      <p className="text-sm font-medium tracking-wide text-[var(--text-secondary)]">{label}</p>
      <p className="mt-2 text-3xl font-bold tracking-tight text-[var(--text-primary)]">{value}</p>
    </div>
  );
}

function InfoBox({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section className="rounded-2xl border border-[var(--border-default)] px-5 pb-5 pt-3">
      <div className="-mt-6 inline-flex bg-[var(--bg-surface)] px-2 text-xl font-semibold text-[var(--text-table-cell)]">{title}</div>
      <div className="pt-1">{children}</div>
    </section>
  );
}

function EditGuestProfileModal({
  form,
  saving,
  error,
  showValidation,
  onChange,
  onClose,
  onSave,
}: {
  form: EditForm;
  saving: boolean;
  error: string;
  showValidation: boolean;
  onChange: (patch: Partial<EditForm>) => void;
  onClose: () => void;
  onSave: () => void;
}) {
  const lastNameInvalid = showValidation && !form.last_name.trim();
  return (
    <PmsModal
      title="Edit Guest Profile"
      size="lg"
      onClose={onClose}
      footer={
        <>
          <button className="btn btn-secondary" disabled={saving} onClick={onClose}>
            Cancel
          </button>
          <button className="btn btn-primary" disabled={saving} onClick={onSave}>
            {saving ? "Saving..." : "Save Changes"}
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
            <input className="form-input" value={form.first_name} onChange={(e) => onChange({ first_name: e.target.value })} />
          </div>
          <div>
            <label className="form-label">Last Name *</label>
            <input
              className="form-input"
              value={form.last_name}
              onChange={(e) => onChange({ last_name: e.target.value })}
              required
              aria-invalid={lastNameInvalid ? "true" : "false"}
            />
            {lastNameInvalid ? <p className="mt-1 text-xs text-rose-600">Last Name is required.</p> : null}
          </div>
          <div>
            <label className="form-label">Phone</label>
            <input className="form-input" value={form.phone} onChange={(e) => onChange({ phone: e.target.value })} />
          </div>
          <div>
            <label className="form-label">Email</label>
            <input className="form-input" value={form.email} onChange={(e) => onChange({ email: e.target.value })} />
          </div>
          <div>
            <label className="form-label">LINE</label>
            <input className="form-input" value={form.line_id} onChange={(e) => onChange({ line_id: e.target.value })} />
          </div>
          <div>
            <label className="form-label">WhatsApp</label>
            <input className="form-input" value={form.whatsapp} onChange={(e) => onChange({ whatsapp: e.target.value })} />
          </div>
          <div>
            <label className="form-label">Gender</label>
            <select className="form-select" value={form.gender} onChange={(e) => onChange({ gender: e.target.value as EditForm["gender"] })}>
              <option value="">—</option>
              <option value="M">M</option>
              <option value="F">F</option>
              <option value="Other">Other</option>
            </select>
          </div>
          <div>
            <label className="form-label">DOB</label>
            <input type="date" className="form-input" value={form.dob} onChange={(e) => onChange({ dob: e.target.value })} />
          </div>
          <div>
            <label className="form-label">Nationality</label>
            <input className="form-input" value={form.nationality_code} onChange={(e) => onChange({ nationality_code: e.target.value.toUpperCase() })} />
          </div>
          <div>
            <label className="form-label">Country</label>
            <input className="form-input" value={form.country} onChange={(e) => onChange({ country: e.target.value })} />
          </div>
          <div>
            <label className="form-label">Province</label>
            <input className="form-input" value={form.province} onChange={(e) => onChange({ province: e.target.value })} />
          </div>
          <div>
            <label className="form-label">ID Type</label>
            <select className="form-select" value={form.id_type} onChange={(e) => onChange({ id_type: e.target.value as EditForm["id_type"] })}>
              <option value="">—</option>
              <option value="thai_id">Thai ID</option>
              <option value="passport">Passport</option>
              <option value="other">Other</option>
            </select>
          </div>
          <div>
            <label className="form-label">ID Number</label>
            <input className="form-input" value={form.id_number} onChange={(e) => onChange({ id_number: e.target.value })} />
          </div>
          <div>
            <label className="form-label">Thai ID</label>
            <input className="form-input" value={form.id_card_number} onChange={(e) => onChange({ id_card_number: e.target.value })} />
          </div>
          <div>
            <label className="form-label">Passport</label>
            <input className="form-input" value={form.passport_no} onChange={(e) => onChange({ passport_no: e.target.value })} />
          </div>
          <div>
            <label className="form-label">Profile Status</label>
            <select
              className="form-select"
              value={form.profile_status}
              onChange={(e) => onChange({ profile_status: e.target.value as EditForm["profile_status"] })}
            >
              <option value="draft">Draft</option>
              <option value="verified">Verified</option>
            </select>
          </div>
          <div>
            <label className="form-label">Tier</label>
            <select className="form-select" value={form.vip_tier} onChange={(e) => onChange({ vip_tier: e.target.value })}>
              <option value="regular">Regular</option>
              <option value="loyal">Loyal</option>
              <option value="vip">VIP</option>
              <option value="longest">VIP+</option>
            </select>
          </div>
          <label className="mt-2 inline-flex items-center gap-2 text-sm font-medium text-[var(--text-table-cell)] md:col-span-2">
            <input
              type="checkbox"
              className="form-checkbox rounded border-[var(--border-input)] text-rose-600"
              checked={form.blacklisted}
              onChange={(e) => onChange({ blacklisted: e.target.checked })}
            />
            Blacklisted
          </label>
          <div className="md:col-span-2">
            <label className="form-label">Preferences</label>
            <textarea
              className="form-input min-h-[84px]"
              value={form.preferences}
              onChange={(e) => onChange({ preferences: e.target.value })}
            />
          </div>
          <div className="md:col-span-2">
            <label className="form-label">Notes</label>
            <textarea
              className="form-input min-h-[100px]"
              value={form.notes}
              onChange={(e) => onChange({ notes: e.target.value })}
            />
          </div>
        </div>
      </div>
    </PmsModal>
  );
}

function StaySummaryDrawer({
  summary,
  loading,
  error,
  onClose,
}: {
  summary: GuestStaySummary | null;
  loading: boolean;
  error: string;
  onClose: () => void;
}) {
  return (
    <div className="fixed inset-0 z-[90] flex justify-end bg-slate-950/30" onClick={onClose}>
      <aside
        className="h-full w-full max-w-[420px] overflow-y-auto border-l border-[var(--border-default)] bg-[var(--bg-surface)] shadow-2xl"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-[var(--border-default)] px-6 py-5">
          <div>
            <h2 className="text-2xl font-semibold tracking-tight text-[var(--text-primary)]">
              Stay Summary {summary?.booking_code ? `— ${summary.booking_code}` : ""}
            </h2>
          </div>
          <button className="btn btn-ghost btn-sm" onClick={onClose}>
            ✕
          </button>
        </div>

        {loading ? (
          <div className="px-6 py-10 text-sm text-[var(--text-secondary)]">Loading stay summary...</div>
        ) : error ? (
          <div className="px-6 py-10">
            <div className="rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">{error}</div>
          </div>
        ) : !summary ? (
          <div className="px-6 py-10 text-sm text-[var(--text-secondary)]">No stay summary available.</div>
        ) : (
          <>
            <div className="space-y-5 px-6 py-5 text-lg leading-9 text-slate-800">
              <div className="rounded-2xl border border-[var(--border-default)] px-5 py-4">
                <div className="flex items-center gap-3">
                  <span className="text-2xl font-semibold text-[var(--text-primary)]">
                    Room {summary.room_number || "—"}
                  </span>
                  <span
                    className={`badge text-sm ${
                      summary.role === "primary"
                        ? "bg-blue-100 text-blue-700"
                        : "bg-amber-100 text-amber-700"
                    }`}
                  >
                    {summary.role === "primary" ? "Main Guest" : "Accompanying"}
                  </span>
                </div>
                <div className="mt-3 space-y-1 text-base leading-8 text-[var(--text-table-cell)]">
                  <div>CI: {formatDateTime(summary.checked_in_at) === "—" ? formatDate(summary.checkin_date) : formatDateTime(summary.checked_in_at)}</div>
                  <div>CO: {formatDateTime(summary.checked_out_at) === "—" ? formatDate(summary.checkout_date) : formatDateTime(summary.checked_out_at)}</div>
                  <div>Source: {valueOrDash(summary.source)}</div>
                  <div>Status: {valueOrDash(summary.status)}</div>
                </div>
              </div>

              <div className="rounded-2xl border border-[var(--border-default)] px-5 py-5">
                <h3 className="text-2xl font-semibold text-[var(--text-primary)]">Financial Summary</h3>
                <div className="mt-6 space-y-3 text-lg leading-9">
                  <div className="flex items-center justify-between gap-4">
                    <span>Room Revenue</span>
                    <span className="font-medium">{fmtMoney(summary.room_revenue)}</span>
                  </div>
                  <div className="flex items-center justify-between gap-4">
                    <span>Day Use Revenue</span>
                    <span className="font-medium">{fmtMoney(summary.dayuse_revenue)}</span>
                  </div>
                  <div className="flex items-center justify-between gap-4">
                    <span>POS / F&amp;B</span>
                    <span className="font-medium">{fmtMoney(summary.pos_total)}</span>
                  </div>
                  <div className="flex items-center justify-between gap-4">
                    <span>Transfer / Boat / Car</span>
                    <span className="font-medium">{fmtMoney(summary.transfer_total)}</span>
                  </div>
                  <div className="flex items-center justify-between gap-4">
                    <span>Tips</span>
                    <span className="font-medium">{fmtMoney(summary.tip_total)}</span>
                  </div>
                </div>

                <div className="my-5 h-px bg-slate-200" />

                <div className="space-y-3 text-lg leading-9">
                  <div className="flex items-center justify-between gap-4">
                    <span>Deposit Received</span>
                    <span className="font-medium">{fmtMoney(summary.deposit_received)}</span>
                  </div>
                  <div className="flex items-center justify-between gap-4">
                    <span>Deposit Refunded</span>
                    <span className="font-medium text-rose-700">-{fmtMoney(summary.deposit_refunded)}</span>
                  </div>
                </div>

                <div className="my-5 h-[3px] bg-slate-900/80" />

                <div className="flex items-center justify-between gap-4 text-xl font-bold text-brand-700">
                  <span>Visible Total</span>
                  <span>{fmtMoney(summary.visible_total)}</span>
                </div>
              </div>
            </div>

            <div className="border-t border-[var(--border-default)] px-6 py-5">
              <div className="flex justify-end">
                <Link href={`/pms/reservations?open=${summary.reservation_id}`} className="btn btn-primary">
                Open Reservation
                </Link>
              </div>
            </div>
          </>
        )}
      </aside>
    </div>
  );
}

export default function GuestProfileDetailPage() {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const profileId = useMemo(() => String(params?.id ?? ""), [params]);

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [profile, setProfile] = useState<GuestProfile | null>(null);
  const [history, setHistory] = useState<GuestHistoryResponse | null>(null);
  const [showEditModal, setShowEditModal] = useState(false);
  const [editForm, setEditForm] = useState<EditForm | null>(null);
  const [editSaving, setEditSaving] = useState(false);
  const [editError, setEditError] = useState("");
  const [showEditValidation, setShowEditValidation] = useState(false);
  const [actionError, setActionError] = useState("");
  const [deleteSaving, setDeleteSaving] = useState(false);
  const [selectedStay, setSelectedStay] = useState<GuestHistoryStay | null>(null);
  const [staySummary, setStaySummary] = useState<GuestStaySummary | null>(null);
  const [stayLoading, setStayLoading] = useState(false);
  const [stayError, setStayError] = useState("");

  useEffect(() => {
    if (!profileId) return;
    let mounted = true;

    async function load() {
      setLoading(true);
      setError("");
      try {
        const [profileRes, historyRes] = await Promise.all([
          fetch(`/api/guests/${profileId}`, { cache: "no-store" }),
          fetch(`/api/guests/${profileId}/history`, { cache: "no-store" }),
        ]);

        const [profileJson, historyJson] = await Promise.all([
          profileRes.json() as Promise<GuestProfileResponse & { error?: string }>,
          historyRes.json() as Promise<GuestHistoryResponse & { error?: string }>,
        ]);

        if (!profileRes.ok || profileJson.success === false) {
          throw new Error(profileJson.error || "Failed to load guest profile.");
        }
        if (!historyRes.ok || historyJson.success === false) {
          throw new Error(historyJson.error || "Failed to load guest history.");
        }

        if (!mounted) return;
        setProfile(profileJson.profile);
        setEditForm(toEditForm(profileJson.profile));
        setHistory(historyJson);
      } catch (err) {
        if (!mounted) return;
        setError(err instanceof Error ? err.message : "Failed to load guest profile.");
      } finally {
        if (mounted) setLoading(false);
      }
    }

    void load();
    return () => {
      mounted = false;
    };
  }, [profileId]);

  useEffect(() => {
    if (!profileId || !selectedStay) return;
    let mounted = true;
    const reservationId = selectedStay.reservation_id;

    async function loadStaySummary() {
      setStayLoading(true);
      setStayError("");
      setStaySummary(null);
      try {
        const response = await fetch(
          `/api/guests/${profileId}/stays/${reservationId}/summary`,
          { cache: "no-store" }
        );
        const payload = (await response.json()) as GuestStaySummaryResponse & { error?: string };
        if (!response.ok || payload.success === false) {
          throw new Error(payload.error || "Failed to load stay summary.");
        }
        if (!mounted) return;
        setStaySummary(payload.summary);
      } catch (err) {
        if (!mounted) return;
        setStayError(err instanceof Error ? err.message : "Failed to load stay summary.");
      } finally {
        if (mounted) setStayLoading(false);
      }
    }

    void loadStaySummary();
    return () => {
      mounted = false;
    };
  }, [profileId, selectedStay]);

  const combinedStays = useMemo(
    () =>
      history
        ? sortStays([...(history.primary_stays ?? []), ...(history.accompanying_stays ?? [])])
        : [],
    [history]
  );

  async function handleSaveProfile() {
    if (!profile || !editForm) return;
    setShowEditValidation(true);
    if (!editForm.last_name.trim()) {
      setEditError("Last Name is required.");
      return;
    }

    setEditSaving(true);
    setEditError("");
    try {
      const response = await fetch(`/api/guests/${profileId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          first_name: editForm.first_name || null,
          last_name: editForm.last_name.trim(),
          phone: editForm.phone || null,
          email: editForm.email || null,
          whatsapp: editForm.whatsapp || null,
          line_id: editForm.line_id || null,
          gender: editForm.gender || null,
          dob: editForm.dob || null,
          nationality_code: editForm.nationality_code || null,
          country: editForm.country || null,
          province: editForm.province || null,
          id_type: editForm.id_type || null,
          id_number: editForm.id_number || null,
          id_card_number: editForm.id_card_number || null,
          passport_no: editForm.passport_no || null,
          vip_tier: editForm.vip_tier || null,
          profile_status: editForm.profile_status,
          preferences: editForm.preferences || null,
          notes: editForm.notes || null,
          blacklisted: editForm.blacklisted,
        }),
      });

      const payload = await response.json();
      if (!response.ok || payload.success === false) {
        throw new Error(payload.error || "Failed to save guest profile.");
      }

      setProfile(payload.profile);
      setEditForm(toEditForm(payload.profile));
      setShowEditModal(false);
      setShowEditValidation(false);
    } catch (err) {
      setEditError(err instanceof Error ? err.message : "Failed to save guest profile.");
    } finally {
      setEditSaving(false);
    }
  }

  async function handleDeleteProfile() {
    if (!profile) return;
    const targetName = formatGuestDisplayName(profile);
    const confirmed = window.confirm(
      `Delete guest profile "${targetName}"?\n\nDelete is blocked if this profile is linked to any booking.`
    );
    if (!confirmed) return;

    setDeleteSaving(true);
    setActionError("");
    try {
      const response = await fetch(`/api/guests/${profileId}`, {
        method: "DELETE",
      });
      const payload = await response.json().catch(() => null);
      if (!response.ok || payload?.success === false) {
        const activePrimary = Array.isArray(payload?.active_links?.primary)
          ? payload.active_links.primary
          : [];
        const activeAccompanying = Array.isArray(payload?.active_links?.accompanying)
          ? payload.active_links.accompanying
          : [];
        const activeBookings = [...activePrimary, ...activeAccompanying]
          .map((row: any) => String(row.booking_code || row.id || "").trim())
          .filter(Boolean);
        const activeBookingText =
          activeBookings.length > 0
            ? ` Active booking(s): ${activeBookings.slice(0, 3).join(", ")}${activeBookings.length > 3 ? "..." : ""}`
            : "";
        throw new Error((payload?.error || "Failed to delete guest profile.") + activeBookingText);
      }

      router.push("/pms/guests");
      router.refresh();
    } catch (err) {
      setActionError(err instanceof Error ? err.message : "Failed to delete guest profile.");
    } finally {
      setDeleteSaving(false);
    }
  }

  if (loading) {
    return (
      <div className="p-6">
        <div className="card p-6 text-sm text-[var(--text-secondary)]">Loading guest profile...</div>
      </div>
    );
  }

  if (error || !profile || !history) {
    return (
      <div className="space-y-3 p-6">
        <Link className="text-sm text-brand-600 underline" href="/pms/guests">
          ← Back to Guest Profiles
        </Link>
        <div className="card p-6 text-sm text-rose-700">{error || "Guest profile not found."}</div>
      </div>
    );
  }

  const statusMeta = getProfileStatusMeta(profile.profile_status, profile.blacklisted);
  const vipMeta = getVipTierMeta(profile.vip_tier);
  const mainNightCount = countStayNights(history.primary_stays ?? []);
  const accompanyingNightCount = countStayNights(history.accompanying_stays ?? []);

  return (
    <div className="mx-auto max-w-7xl space-y-5 p-6">
      <section className="card overflow-hidden">
        <div className="border-b border-[var(--border-default)] px-5 py-5">
          <div className="flex flex-col gap-5 lg:flex-row lg:items-start lg:justify-between">
            <div>
              <Link className="text-sm font-medium text-brand-600 underline underline-offset-2" href="/pms/guests">
                ← Back to Guest Profiles
              </Link>
              <h1 className="mt-3 text-3xl font-bold tracking-tight text-[var(--text-primary)]">
                {formatGuestDisplayName(profile)}
              </h1>
              <div className="mt-3 flex flex-wrap items-center gap-2">
                <span className={`badge text-sm ${statusMeta.tone}`}>{statusMeta.label}</span>
                {isVipBucket(profile.vip_tier) ? (
                  <span className={`badge text-sm ${vipMeta.tone}`}>{vipMeta.label}</span>
                ) : null}
                <span className="badge bg-slate-100 font-mono text-sm text-slate-600">
                  Member: {valueOrDash(profile.member_no)}
                </span>
              </div>
            </div>

            <div className="flex items-center gap-2">
              <button
                className="btn btn-secondary"
                onClick={() => {
                  setShowEditValidation(false);
                  setShowEditModal(true);
                }}
                disabled={deleteSaving}
              >
                Edit
              </button>
              <button className="btn btn-danger" onClick={() => void handleDeleteProfile()} disabled={deleteSaving || editSaving}>
                {deleteSaving ? "Deleting..." : "Delete Profile"}
              </button>
            </div>
          </div>
        </div>

        {actionError ? (
          <div className="mx-5 mt-5 rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">
            {actionError}
          </div>
        ) : null}

        <div className="grid divide-y divide-slate-200 lg:grid-cols-6 lg:divide-y-0 lg:divide-x">
          <SummaryMetricCard label="Main Stays" value={history.summary.primary_stay_count} />
          <SummaryMetricCard label="Main Nights" value={mainNightCount} />
          <SummaryMetricCard label="Acc. Stays" value={history.summary.accompanying_stay_count} />
          <SummaryMetricCard label="Acc. Nights" value={accompanyingNightCount} />
          <SummaryMetricCard label="Transfer" value={fmtMoney(history.summary.total_transfer_spend)} />
          <SummaryMetricCard label="Tips" value={fmtMoney(history.summary.total_tips)} />
        </div>

        <div className="space-y-6 border-t border-[var(--border-default)] px-5 py-6">
          <InfoBox title="Identity">
            <div className="grid gap-4 text-lg text-[var(--text-table-cell)] md:grid-cols-3">
              <div>
                <div>Gender: {valueOrDash(profile.gender)}</div>
                <div>ID: {valueOrDash(profile.id_number || profile.id_card_number)}</div>
              </div>
              <div>
                <div>DOB: {formatDate(profile.dob)}</div>
                <div>Passport: {valueOrDash(profile.passport_no)}</div>
              </div>
              <div>
                <div>
                  Nationality: {getNationalityFlag(profile.nationality_code || profile.country || "")}{" "}
                  {formatNationalityCode(profile.nationality_code || profile.nationality || "—")}
                </div>
                <div>Country: {valueOrDash(profile.country)}</div>
              </div>
            </div>
          </InfoBox>

          <InfoBox title="Contact">
            <div className="grid gap-4 text-lg text-[var(--text-table-cell)] md:grid-cols-3">
              <div>Phone: {valueOrDash(profile.phone)}</div>
              <div>Email: {valueOrDash(profile.email)}</div>
              <div>LINE: {valueOrDash(profile.line_id)}</div>
            </div>
          </InfoBox>

          <InfoBox title="Preferences">
            <div className="grid gap-4 text-lg text-[var(--text-table-cell)] md:grid-cols-[1.2fr_1fr]">
              <div>{valueOrDash(profile.preferences)}</div>
              <div>Notes: {valueOrDash(profile.notes)}</div>
            </div>
          </InfoBox>
        </div>

        <div className="border-t border-[var(--border-default)] px-5 py-5">
          <div className="flex items-center justify-between gap-3">
            <h2 className="text-3xl font-bold tracking-tight text-[var(--text-primary)]">Stay History</h2>
            <p className="text-lg text-[var(--text-secondary)]">{combinedStays.length} records</p>
          </div>
        </div>

        <div className="overflow-x-auto border-t border-[var(--border-default)]">
          <table className="data-table">
            <thead>
              <tr>
                <th>Booking</th>
                <th>Room</th>
                <th>Role</th>
                <th>Check-in</th>
                <th>Check-out</th>
                <th>Sts</th>
                <th className="text-right">Total</th>
              </tr>
            </thead>
            <tbody>
              {combinedStays.length === 0 ? (
                <tr>
                  <td colSpan={7} className="py-10 text-center text-sm text-[var(--text-secondary)]">
                    No stay history found.
                  </td>
                </tr>
              ) : (
                combinedStays.map((stay) => {
                  const roleMeta = getRoleMeta(stay.role);
                  return (
                    <tr
                      key={`${stay.reservation_id}-${stay.role}`}
                      className="cursor-pointer transition hover:bg-[var(--bg-body)]"
                      onClick={() => setSelectedStay(stay)}
                    >
                      <td className="font-semibold text-[var(--text-primary)]">{valueOrDash(stay.booking_code)}</td>
                      <td>{valueOrDash(stay.room_number)}</td>
                      <td>
                        <span className={`inline-flex items-center gap-2 rounded-full px-3 py-1 text-xs font-semibold ${roleMeta.tone}`}>
                          <span className={`h-2.5 w-2.5 rounded-full ${roleMeta.dot}`} />
                          {roleMeta.label}
                        </span>
                      </td>
                      <td>{formatDateTime(stay.checked_in_at) === "—" ? formatDate(stay.checkin_date) : formatDateTime(stay.checked_in_at)}</td>
                      <td>{formatDateTime(stay.checked_out_at) === "—" ? formatDate(stay.checkout_date) : formatDateTime(stay.checked_out_at)}</td>
                      <td>{valueOrDash(stay.status)}</td>
                      <td className="text-right font-semibold text-[var(--text-primary)]">{fmtMoney(stay.total_price)}</td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </section>

      {showEditModal && editForm ? (
        <EditGuestProfileModal
          form={editForm}
          saving={editSaving}
          error={editError}
          showValidation={showEditValidation}
          onChange={(patch) => setEditForm((current) => (current ? { ...current, ...patch } : current))}
          onClose={() => {
            if (editSaving) return;
            setEditError("");
            setShowEditValidation(false);
            setShowEditModal(false);
          }}
          onSave={() => void handleSaveProfile()}
        />
      ) : null}

      {selectedStay ? (
        <StaySummaryDrawer
          summary={staySummary}
          loading={stayLoading}
          error={stayError}
          onClose={() => {
            setSelectedStay(null);
            setStaySummary(null);
            setStayError("");
          }}
        />
      ) : null}
    </div>
  );
}
