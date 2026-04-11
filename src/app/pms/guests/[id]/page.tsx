"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import NationalityFlag from "@/components/nationality-flag";
import DateInput from "@/components/date-input";
import PmsModal from "@/components/pms-modal";
import { VehicleRegisterModal } from "@/components/vehicles/vehicle-register-modal";
import { useAdminRole } from "@/hooks/use-admin-role";
import {
  formatGuestDisplayName,
  getProfileStatusMeta,
  getRoleMeta,
  getVipTierMeta,
  isVipBucket,
} from "@/lib/guest-profile-display";
import { formatNationalityCode } from "@/lib/nationality";
import type {
  GuestHistoryResponse,
  GuestHistoryStay,
  GuestProfile,
  GuestVehicle,
  GuestStaySummary,
  GuestStaySummaryResponse,
} from "@/lib/types";
import { getPlateDisplay } from "@/components/vehicles/vehicle-helpers";

type GuestProfileResponse = {
  success: boolean;
  profile: GuestProfile;
};

type ProfileVehicle = {
  vehicle_key: string;
  latest_vehicle: GuestVehicle;
  vehicle_type: "car" | "motorcycle" | "bicycle";
  plate_number: string | null;
  plate_province: string | null;
  plate_country: "TH" | "MY";
  vehicle_brand: string | null;
  vehicle_model: string | null;
  vehicle_color: "white" | "black" | "silver" | "red" | "blue" | "yellow" | "other";
  description: string | null;
  short_label: string;
  title: string;
  subtitle: string | null;
  latest_registered_at: string;
  last_reservation_id: string | null;
  last_room_number: string | null;
  last_guest_name: string | null;
};

type ProfileVehicleResponse = {
  success: boolean;
  vehicles?: ProfileVehicle[];
  count?: number;
  error?: string;
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
  isMasked,
}: {
  form: EditForm;
  saving: boolean;
  error: string;
  showValidation: boolean;
  onChange: (patch: Partial<EditForm>) => void;
  onClose: () => void;
  onSave: () => void;
  isMasked?: boolean;
}) {
  const lastNameInvalid = showValidation && !form.last_name.trim();
  return (
    <PmsModal
      title="Edit Guest Profile"
      size="lg"
      onClose={onClose}
      footer={
        <>
          <button className="btn btn-secondary dark:bg-slate-500/20 dark:text-slate-400 dark:border-slate-500/30" disabled={saving} onClick={onClose}>
            Cancel
          </button>
          <button className="btn btn-primary dark:bg-brand-500/20 dark:text-brand-400 dark:border-brand-500/30" disabled={saving} onClick={onSave}>
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
            <DateInput className="w-full" value={form.dob} onChange={(value) => onChange({ dob: value })} />
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
            <input
              type="text"
              className="form-input disabled:bg-slate-100 disabled:text-slate-500 disabled:cursor-not-allowed dark:disabled:bg-slate-800 dark:disabled:text-slate-500"
              value={form.id_card_number || form.id_number}
              disabled={isMasked}
              placeholder={isMasked ? "ข้อมูลถูกซ่อน — Admin เท่านั้นที่แก้ไขได้" : ""}
              onChange={(e) => onChange({ id_number: e.target.value, id_card_number: e.target.value })}
            />
          </div>
          <div>
            <label className="form-label">Passport No</label>
            <input
              type="text"
              className="form-input disabled:bg-slate-100 disabled:text-slate-500 disabled:cursor-not-allowed dark:disabled:bg-slate-800 dark:disabled:text-slate-500"
              value={form.passport_no}
              disabled={isMasked}
              placeholder={isMasked ? "ข้อมูลถูกซ่อน — Admin เท่านั้นที่แก้ไขได้" : ""}
              onChange={(e) => onChange({ passport_no: e.target.value })}
            />
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
            <div className="space-y-5 px-6 py-5 text-lg leading-9 text-[var(--text-primary)]">
              <div className="rounded-2xl border border-[var(--border-default)] px-5 py-4">
                <div className="flex items-center gap-3">
                  <span className="text-2xl font-semibold text-[var(--text-primary)]">
                    Room {summary.room_number || "—"}
                  </span>
                  <span
                    className={`badge text-sm ${summary.role === "primary"
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

                <div className="my-5 h-px bg-[var(--bg-muted)]" />

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
                <Link href={`/pms/reservations?open=${summary.reservation_id}`} className="btn btn-primary dark:bg-brand-500/20 dark:text-brand-400 dark:border-brand-500/30">
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
  const { isAdmin } = useAdminRole();
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
  const [profileVehicles, setProfileVehicles] = useState<ProfileVehicle[]>([]);
  const [profileVehiclesError, setProfileVehiclesError] = useState("");
  const [editingProfileVehicle, setEditingProfileVehicle] = useState<GuestVehicle | null>(null);
  const [selectedStay, setSelectedStay] = useState<GuestHistoryStay | null>(null);
  const [staySummary, setStaySummary] = useState<GuestStaySummary | null>(null);
  const [stayLoading, setStayLoading] = useState(false);
  const [stayError, setStayError] = useState("");
  const [stayStatusFilter, setStayStatusFilter] = useState<"all" | "checked_out" | "cancelled">("all");
  const [stayDateFrom, setStayDateFrom] = useState("");
  const [stayDateTo, setStayDateTo] = useState("");

  const refreshProfileVehicles = useCallback(async () => {
    if (!profileId) return;
    const vehiclesRes = await fetch(`/api/vehicles/profile-vehicles?guest_profile_id=${encodeURIComponent(profileId)}&t=${Date.now()}`, {
      cache: "no-store",
    });
    const vehiclesJson = (await vehiclesRes.json().catch(() => null)) as ProfileVehicleResponse | null;
    if (!vehiclesRes.ok || vehiclesJson?.success === false) {
      setProfileVehicles([]);
      setProfileVehiclesError(vehiclesJson?.error || "Failed to load vehicle history.");
      return;
    }
    setProfileVehicles(Array.isArray(vehiclesJson?.vehicles) ? vehiclesJson!.vehicles! : []);
    setProfileVehiclesError("");
  }, [profileId]);

  useEffect(() => {
    if (!profileId) return;
    let mounted = true;

    async function load() {
      setLoading(true);
      setError("");
      try {
        const [profileRes, historyRes] = await Promise.all([
          fetch(`/api/guests/${profileId}?t=${Date.now()}`, { cache: "no-store" }),
          fetch(`/api/guests/${profileId}/history?t=${Date.now()}`, { cache: "no-store" }),
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

        await refreshProfileVehicles();
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
  }, [profileId, refreshProfileVehicles]);

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

  const combinedStays = useMemo(() => {
    if (!history) return [];
    
    const enrichedList: GuestHistoryStay[] = [];
    const pmsMap = new Map<string, GuestHistoryStay>();
    
    for (const s of history.primary_stays ?? []) {
      if (!pmsMap.has(s.reservation_id)) pmsMap.set(s.reservation_id, s);
    }
    for (const s of history.accompanying_stays ?? []) {
      if (!pmsMap.has(s.reservation_id)) pmsMap.set(s.reservation_id, s);
    }

    for (const stay of pmsMap.values()) {
      enrichedList.push({ ...stay, source: "pms" });
    }

    const rawStays = (history as any).stays || [];

    for (const item of rawStays) {
      if (item.source === "legacy") {
        enrichedList.push({
          reservation_id: item.id,
          booking_code: "LEGACY",
          guest_name: null,
          room_number: item.room_number,
          status: "checked_out",
          checkin_date: item.date_in,
          checkout_date: item.date_out,
          checked_in_at: item.date_in,
          checked_out_at: item.date_out,
          source: "legacy",
          created_at: null,
          total_price: null,
          role: "primary",
          display_order: 1,
        } as GuestHistoryStay);
      }
    }
    
    return sortStays(
      enrichedList.filter(
        (stay, index, list) =>
          list.findIndex(
            (candidate) =>
              candidate.reservation_id === stay.reservation_id &&
              String(candidate.source ?? "") === String(stay.source ?? "")
          ) === index
      )
    );
  }, [history]);

  const hasDateFilter = Boolean(stayDateFrom || stayDateTo);

  const displayedStays = useMemo(() => {
    let rows = combinedStays;
    // Status filter
    if (stayStatusFilter !== "all") {
      rows = rows.filter((s) => s.status === stayStatusFilter);
    }
    // Date range filter
    if (stayDateFrom) {
      rows = rows.filter((s) => {
        const d = s.checkin_date ?? s.checked_in_at ?? "";
        return d >= stayDateFrom;
      });
    }
    if (stayDateTo) {
      rows = rows.filter((s) => {
        const d = s.checkin_date ?? s.checked_in_at ?? "";
        return d <= stayDateTo;
      });
    }
    // Limit: 10 when no date range, 50 when date range is set
    return rows.slice(0, hasDateFilter ? 50 : 10);
  }, [combinedStays, stayStatusFilter, stayDateFrom, stayDateTo, hasDateFilter]);

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
      const isMasked = (profile as any)._masked === true;
      const updatePayload: any = {
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
        vip_tier: editForm.vip_tier || null,
        profile_status: editForm.profile_status,
        preferences: editForm.preferences || null,
        notes: editForm.notes || null,
        blacklisted: editForm.blacklisted,
      };

      if (!isMasked) {
        updatePayload.id_number = editForm.id_number || null;
        updatePayload.id_card_number = editForm.id_card_number || null;
        updatePayload.passport_no = editForm.passport_no || null;
      }

      const response = await fetch(`/api/guests/${profileId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(updatePayload),
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
  const mainStayCount = Number(history.summary?.primary_stay_count ?? 0);
  const mainNightCount = Number(history.summary?.primary_night_count ?? 0);
  const accompanyingStayCount = Number(history.summary?.accompanying_stay_count ?? 0);
  const accompanyingNightCount = Number(history.summary?.accompanying_night_count ?? 0);

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
                <span className="badge bg-[var(--bg-surface-hover)] font-mono text-sm text-[var(--text-secondary)]">
                  Member: {valueOrDash(profile.member_no)}
                </span>
              </div>
            </div>

            <div className="flex items-center gap-2">
               <button
                className="btn btn-secondary dark:bg-slate-500/20 dark:text-slate-400 dark:border-slate-500/30"
                onClick={() => {
                  setShowEditValidation(false);
                  setShowEditModal(true);
                }}
                disabled={deleteSaving}
              >
                Edit
              </button>
              <button className="btn btn-danger dark:bg-rose-500/20 dark:text-rose-400 dark:border-rose-500/30" onClick={() => void handleDeleteProfile()} disabled={deleteSaving || editSaving}>
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

        <div className="grid divide-y divide-[var(--border-default)] lg:grid-cols-6 lg:divide-y-0 lg:divide-x">
          <SummaryMetricCard label="Main Stays" value={mainStayCount} />
          <SummaryMetricCard label="Main Nights" value={mainNightCount} />
          <SummaryMetricCard label="Acc. Stays" value={accompanyingStayCount} />
          <SummaryMetricCard label="Acc. Nights" value={accompanyingNightCount} />
          <SummaryMetricCard label="Transfer" value={fmtMoney(history.summary.total_transfer_spend)} />
          <SummaryMetricCard label="Tips" value={fmtMoney(history.summary.total_tips)} />
        </div>

        <div className="space-y-6 border-t border-[var(--border-default)] px-5 py-6">
          <InfoBox title="Identity">
            <div className="grid gap-4 text-lg text-[var(--text-table-cell)] md:grid-cols-3">
              <div>
                <div>Gender: {valueOrDash(profile.gender)}</div>
                <div className="flex items-center gap-1">
                  ID: {valueOrDash(profile.id_number || profile.id_card_number)}
                  {(profile as any)._masked && (
                    <span className="cursor-help text-[var(--text-muted)] hover:text-[var(--text-primary)]" title="ข้อมูลนี้เฉพาะ Admin เท่านั้น">🔒</span>
                  )}
                </div>
              </div>
              <div>
                <div>DOB: {formatDate(profile.dob)}</div>
                <div className="flex items-center gap-1">
                  Passport: {valueOrDash(profile.passport_no)}
                  {(profile as any)._masked && (
                    <span className="cursor-help text-[var(--text-muted)] hover:text-[var(--text-primary)]" title="ข้อมูลนี้เฉพาะ Admin เท่านั้น">🔒</span>
                  )}
                </div>
              </div>
              <div>
                <div>
                  Nationality: <NationalityFlag input={profile.nationality_code || profile.country || ""} className="inline-block align-[-2px]" />{" "}
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

          <InfoBox title="Booking Names">
            {Array.isArray(profile.booking_names) && profile.booking_names.length > 0 ? (
              <div className="flex flex-wrap gap-2">
                {profile.booking_names.map((bookingName) => (
                  <span
                    key={bookingName}
                    className="rounded-full border border-emerald-200 bg-emerald-50 px-3 py-1.5 text-sm font-semibold text-emerald-700 dark:border-emerald-800 dark:bg-emerald-950/30 dark:text-emerald-300"
                  >
                    {bookingName}
                  </span>
                ))}
              </div>
            ) : (
              <div className="text-lg text-[var(--text-muted)]">—</div>
            )}
          </InfoBox>

          <InfoBox title="Vehicles">
            {profileVehiclesError ? (
              <div className="rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">
                {profileVehiclesError}
              </div>
            ) : profileVehicles.length > 0 ? (
              <div className="space-y-3 text-lg text-[var(--text-table-cell)]">
                {profileVehicles.map((vehicle) => {
                  return (
                    <div key={vehicle.vehicle_key} className="border-b border-[var(--border-subtle)] pb-3 last:border-b-0 last:pb-0">
                      <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
                        <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
                          <span className="font-semibold text-[var(--text-primary)]">
                            {vehicle.short_label || getPlateDisplay(vehicle.plate_number, vehicle.vehicle_type)}
                          </span>
                          <span>
                            Plate: {valueOrDash(vehicle.plate_number)}
                            {vehicle.plate_province ? ` · ${vehicle.plate_province}` : ""}
                          </span>
                          <span>Type: {vehicle.vehicle_type}</span>
                          <span>Brand/Model: {valueOrDash([vehicle.vehicle_brand, vehicle.vehicle_model].filter(Boolean).join(" "))}</span>
                          <span>Color: {valueOrDash(vehicle.vehicle_color)}</span>
                        </div>
                        {isAdmin && vehicle.latest_vehicle ? (
                          <button
                            type="button"
                            className="btn btn-secondary btn-sm dark:bg-slate-500/20 dark:text-slate-400 dark:border-slate-500/30"
                            onClick={() => setEditingProfileVehicle(vehicle.latest_vehicle)}
                          >
                            Edit Vehicle
                          </button>
                        ) : null}
                      </div>
                    </div>
                  );
                })}
              </div>
            ) : (
              <div className="grid gap-3 text-lg text-[var(--text-table-cell)] md:grid-cols-[1.2fr_1fr]">
                <div>No vehicle history linked to this profile yet.</div>
                <div>Legacy Car Registration: {valueOrDash(profile.car_registration)}</div>
              </div>
            )}
          </InfoBox>

          <InfoBox title="Preferences">
            <div className="grid gap-4 text-lg text-[var(--text-table-cell)] md:grid-cols-[1.2fr_1fr]">
              <div>{valueOrDash(profile.preferences)}</div>
              <div>Notes: {valueOrDash(profile.notes)}</div>
            </div>
          </InfoBox>
        </div>

        <div className="border-t border-[var(--border-default)] px-5 py-5">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div>
              <h2 className="text-3xl font-bold tracking-tight text-[var(--text-primary)]">Stay History</h2>
              <p className="mt-1 text-sm text-[var(--text-secondary)]">
                Showing {displayedStays.length} of {combinedStays.length} records
                {!hasDateFilter && combinedStays.length > 10 && (
                  <span className="ml-1 text-[var(--text-muted)]">— select a date range to see more (up to 50)</span>
                )}
              </p>
            </div>
            {/* Filters */}
            <div className="flex flex-wrap items-end gap-3">
              {/* Status filter */}
              <div className="flex flex-col gap-1">
                <label className="text-[10px] font-semibold uppercase tracking-wide text-[var(--text-muted)]">Status</label>
                <div className="flex rounded-lg border border-[var(--border-input)] overflow-hidden text-xs font-semibold">
                  {(["all", "checked_out", "cancelled"] as const).map((v) => (
                    <button
                      key={v}
                      onClick={() => setStayStatusFilter(v)}
                      className={`px-3 py-1.5 transition ${
                        stayStatusFilter === v
                          ? "bg-brand-600 text-white"
                          : "bg-[var(--bg-surface)] text-[var(--text-secondary)] hover:bg-[var(--bg-body)]"
                      }`}
                    >
                      {v === "all" ? "All" : v === "checked_out" ? "Checked Out" : "Cancelled"}
                    </button>
                  ))}
                </div>
              </div>
              {/* Date range */}
              <div className="flex flex-col gap-1">
                <label className="text-[10px] font-semibold uppercase tracking-wide text-[var(--text-muted)]">Check-in From</label>
                <input
                  type="date"
                  value={stayDateFrom}
                  onChange={(e) => setStayDateFrom(e.target.value)}
                  className="form-input py-1.5 text-sm"
                />
              </div>
              <div className="flex flex-col gap-1">
                <label className="text-[10px] font-semibold uppercase tracking-wide text-[var(--text-muted)]">To</label>
                <input
                  type="date"
                  value={stayDateTo}
                  onChange={(e) => setStayDateTo(e.target.value)}
                  className="form-input py-1.5 text-sm"
                />
              </div>
              {hasDateFilter && (
                <button
                  onClick={() => { setStayDateFrom(""); setStayDateTo(""); }}
                  className="btn btn-secondary btn-sm h-[34px]"
                >
                  Clear
                </button>
              )}
            </div>
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
                <th className="text-center">Src</th>
                <th className="text-right">Total</th>
              </tr>
            </thead>
            <tbody>
              {displayedStays.length === 0 ? (
                <tr>
                  <td colSpan={8} className="py-10 text-center text-sm text-[var(--text-secondary)]">
                    No stay history found{stayStatusFilter !== "all" || hasDateFilter ? " matching the current filters" : ""}.
                  </td>
                </tr>
              ) : (
                displayedStays.map((stay) => {
                  const roleMeta = getRoleMeta(stay.role);
                  const isLegacy = stay.source === "legacy";
                  return (
                    <tr
                      key={`${stay.reservation_id}-${stay.source || stay.role}`}
                      className={`transition hover:bg-[var(--bg-body)] ${isLegacy ? '' : 'cursor-pointer'}`}
                      onClick={() => {
                        if (!isLegacy) setSelectedStay(stay);
                      }}
                    >
                      <td className="font-semibold text-[var(--text-primary)]">
                        {isLegacy ? <span className="text-[var(--text-muted)] italic">Legacy Record</span> : valueOrDash(stay.booking_code)}
                      </td>
                      <td>{valueOrDash(stay.room_number)}</td>
                      <td>
                        {isLegacy ? (
                           <span className="text-[var(--text-muted)] italic text-xs">—</span>
                        ) : (
                          <span className={`inline-flex items-center gap-2 rounded-full px-3 py-1 text-xs font-semibold ${roleMeta.tone}`}>
                            <span className={`h-2.5 w-2.5 rounded-full ${roleMeta.dot}`} />
                            {roleMeta.label}
                          </span>
                        )}
                      </td>
                      <td>{formatDateTime(stay.checked_in_at) === "—" ? formatDate(stay.checkin_date) : formatDateTime(stay.checked_in_at)}</td>
                      <td>{formatDateTime(stay.checked_out_at) === "—" ? formatDate(stay.checkout_date) : formatDateTime(stay.checked_out_at)}</td>
                      <td>{isLegacy ? <span className="text-[var(--text-muted)]">—</span> : valueOrDash(stay.status)}</td>
                      <td className="text-center">
                        {isLegacy ? (
                          <span className="inline-flex items-center rounded-full bg-blue-100 px-2 py-0.5 text-[10px] font-semibold text-blue-700 dark:bg-blue-500/20 dark:text-blue-400">Legacy</span>
                        ) : (
                          <span className="inline-flex items-center rounded-full bg-emerald-100 px-2 py-0.5 text-[10px] font-semibold text-emerald-700 dark:bg-emerald-500/20 dark:text-emerald-400">PMS</span>
                        )}
                      </td>
                      <td className="text-right font-semibold text-[var(--text-primary)]">
                        {isLegacy ? <span className="text-[var(--text-muted)] font-normal">—</span> : fmtMoney(stay.total_price)}
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
          {/* Limit reminder */}
          {hasDateFilter && displayedStays.length === 50 && (
            <p className="px-5 py-2 text-center text-xs text-[var(--text-muted)]">
              Showing 50 records maximum. Narrow the date range to see specific entries.
            </p>
          )}
          {!hasDateFilter && combinedStays.length > 10 && (
            <p className="px-5 py-3 text-center text-xs text-[var(--text-muted)] border-t border-[var(--border-subtle)]">
              Showing latest 10 records. Select a date range above to see older stays.
            </p>
          )}
        </div>
      </section>

      {showEditModal && editForm ? (
        <EditGuestProfileModal
          form={editForm}
          saving={editSaving}
          error={editError}
          showValidation={showEditValidation}
          isMasked={(profile as any)?._masked === true}
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

      {editingProfileVehicle ? (
        <VehicleRegisterModal
          vehicle={editingProfileVehicle}
          onClose={() => setEditingProfileVehicle(null)}
          onSuccess={() => {
            setEditingProfileVehicle(null);
            void refreshProfileVehicles();
          }}
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
