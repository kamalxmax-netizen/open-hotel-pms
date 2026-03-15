"use client";

import { useCallback, useEffect, useState } from "react";
import { formatNationalityCode, getNationalityFlag } from "@/lib/nationality";

/* ─── Types ─────────────────────────────────────────────────── */
type TraceStatus = "open" | "done" | "cancelled";
type TraceDept = "FD" | "HK" | "MAINT" | "MGMT" | "OTHER";

type Trace = {
    id: string;
    dept: TraceDept;
    trace_text: string;
    from_date: string;
    to_date: string;
    status: TraceStatus;
    created_by: string | null;
    created_at: string;
    loan_item_code: string | null;
    loan_qty: number;
    loan_items: { code: string; name: string; icon: string; requires_hk_collection?: boolean } | null;
    due_date?: string | null;
};

type AlertRow = {
    id: string;
    alert_code: string | null;
    template_code?: string | null;
    template_name?: string | null;
    alert_template_id?: number | null;
    message?: string;
    severity?: "info" | "warning" | "critical";
    display_surfaces?: string[];
    is_dismissed?: boolean;
    is_legacy?: boolean;
    note: string | null;
    custom_message?: string | null;
    created_at?: string | null;
    icon?: string | null;
    alert_codes?: {
        code: string;
        description: string;
        dept: string | null;
        auto_on_co: boolean;
        icon: string | null;
    } | null;
};

type AlertCode = {
    code: string;
    description: string;
    dept: string | null;
    auto_on_co: boolean;
    icon: string | null;
};

type LoanItem = {
    code: string;
    name: string;
    total_qty: number;
    available: number;
    icon: string | null;
    requires_hk_collection?: boolean;
    requires_extra_charge_reminder?: boolean;
    linked_fee_template_code?: string | null;
};

type TraceTemplate = {
    id: number;
    name: string;
    dept: TraceDept;
    template_text: string;
    is_active: boolean;
    sort_order: number;
};

type GuestProfile = {
    id: string;
    member_no: string | null;
    first_name: string | null;
    last_name: string;
    gender: string | null;
    nationality: string | null;
    phone: string | null;
    email: string | null;
    line_id: string | null;
    car_registration: string | null;
    vip_tier: string | null;
    preferences: string | null;
    notes: string | null;
    blacklisted: boolean;
    stay_count?: number;
};

/* ─── Constants ──────────────────────────────────────────────── */
const DEPT_LABEL: Record<TraceDept, string> = {
    FD: "Front Desk", HK: "Housekeeping", MAINT: "Maintenance", MGMT: "Management", OTHER: "Other"
};
const DEPT_COLOR: Record<TraceDept, string> = {
    FD: "bg-sky-100 text-sky-700", HK: "bg-emerald-100 text-emerald-700",
    MAINT: "bg-amber-100 text-amber-700", MGMT: "bg-violet-100 text-violet-700",
    OTHER: "bg-slate-100 text-slate-600"
};
const STATUS_COLOR: Record<TraceStatus, string> = {
    open: "text-amber-600", done: "text-emerald-600", cancelled: "text-slate-400"
};

const VIP_TIER_LABEL: Record<string, { label: string; color: string }> = {
    regular: { label: "Regular", color: "bg-slate-100 text-slate-600" },
    loyal: { label: "Regular Loyal", color: "bg-sky-100 text-sky-700" },
    vip: { label: "Year Loyalty", color: "bg-violet-100 text-violet-700" },
    longest: { label: "⭐ VIP", color: "bg-amber-100 text-amber-700" }
};

const QUICK_TEXTS: { dept: TraceDept; text: string }[] = [
    { dept: "HK", text: "Please place extra pillow in room before arrival." },
    { dept: "HK", text: "Extra bed requested. Please set up before check-in." },
    { dept: "HK", text: "Do Not Disturb — guest requested privacy." },
    { dept: "FD", text: "Guest has EU adapter — collect on checkout." },
    { dept: "FD", text: "Guest has hair dryer — collect on checkout." },
    { dept: "MAINT", text: "Please check A/C in room — guest reported issue." },
    { dept: "FD", text: "Anniversary — arrange cake / flowers." },
    { dept: "FD", text: "Guest booked car transfer — confirm pick-up time." }
];

/* ─── Tab type ───────────────────────────────────────────────── */
type Tab = "traces" | "alerts" | "guest" | "loans" | "charges";

/* ─── Props ──────────────────────────────────────────────────── */
type Props = {
    reservationId: string;
    guestName: string;
    checkinDate: string;
    checkoutDate: string;
    onClose: () => void;
    initialTab?: Tab;
};

/* ═══════════════════════════════════════════════════════════════
   Main Component
═══════════════════════════════════════════════════════════════ */
export default function ReservationOptionsPanel({
    reservationId, guestName, checkinDate, checkoutDate, onClose, initialTab = "traces"
}: Props) {
    const [activeTab, setActiveTab] = useState<Tab>(initialTab);

    return (
        <>
            <div className="drawer-overlay" onClick={onClose} />
            <div className="drawer-panel" style={{ maxWidth: 520 }}>
                {/* Header */}
                <div className="drawer-header">
                    <div>
                        <p className="text-sm font-bold text-slate-900">{guestName}</p>
                        <p className="text-xs text-slate-400 mt-0.5">{checkinDate} → {checkoutDate} · Options</p>
                    </div>
                    <button className="btn-icon btn-ghost" onClick={onClose}>
                        <svg className="h-4 w-4" viewBox="0 0 20 20" fill="currentColor">
                            <path fillRule="evenodd" d="M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 010-1.414z" clipRule="evenodd" />
                        </svg>
                    </button>
                </div>

                {/* Tab bar (Oracle-style Options grid → simplified tabs) */}
                <div className="flex border-b border-slate-200 bg-slate-50 text-xs font-semibold">
                    {([
                        { key: "traces" as Tab, label: "📋 Traces" },
                        { key: "alerts" as Tab, label: "🔔 Alerts" },
                        { key: "guest" as Tab, label: "👤 Guest Profile" },
                        { key: "loans" as Tab, label: "📦 Loan Items" },
                        { key: "charges" as Tab, label: "💳 Charges" }
                    ]).map(t => (
                        <button
                            key={t.key}
                            onClick={() => setActiveTab(t.key)}
                            className={`flex-1 py-2.5 px-1 transition
                                ${activeTab === t.key
                                    ? "border-b-2 border-brand-600 text-brand-700 bg-white"
                                    : "text-slate-500 hover:text-slate-700 hover:bg-slate-100"}`}
                        >{t.label}</button>
                    ))}
                </div>

                {/* Tab content */}
                <div className="drawer-body">
                    {activeTab === "traces" && (
                        <TracesTab
                            reservationId={reservationId}
                            checkinDate={checkinDate}
                            checkoutDate={checkoutDate}
                        />
                    )}
                    {activeTab === "alerts" && (
                        <AlertsTab reservationId={reservationId} />
                    )}
                    {activeTab === "guest" && (
                        <GuestProfileTab
                            reservationId={reservationId}
                            guestName={guestName}
                        />
                    )}
                    {activeTab === "loans" && (
                        <LoanItemsTab
                            reservationId={reservationId}
                            checkinDate={checkinDate}
                            checkoutDate={checkoutDate}
                            onOpenCharges={() => setActiveTab("charges")}
                        />
                    )}
                    {activeTab === "charges" && (
                        <ChargesTab reservationId={reservationId} />
                    )}
                </div>
            </div>
        </>
    );
}

/* ══════════════════════════════════════════════════════════════
   TRACES TAB
══════════════════════════════════════════════════════════════ */
function TracesTab({ reservationId, checkinDate, checkoutDate }: {
    reservationId: string; checkinDate: string; checkoutDate: string;
}) {
    const [traces, setTraces] = useState<Trace[]>([]);
    const [loading, setLoading] = useState(true);
    const [showForm, setShowForm] = useState(false);
    const [saving, setSaving] = useState(false);
    const [error, setError] = useState("");
    const [quickTexts, setQuickTexts] = useState<{ dept: TraceDept; text: string }[]>(QUICK_TEXTS);

    // Form state
    const [dept, setDept] = useState<TraceDept>("FD");
    const [text, setText] = useState("");
    const [fromDate, setFromDate] = useState(checkinDate);
    const [toDate, setToDate] = useState(checkoutDate);

    const load = useCallback(async () => {
        setLoading(true);
        const [tRes, templateRes] = await Promise.all([
            fetch(`/api/bookings/${reservationId}/traces?kind=trace`).then(r => r.json()),
            fetch("/api/trace-templates?active=true").then(r => r.json()).catch(() => null),
        ]);
        if (tRes.success) setTraces(tRes.traces);
        if (templateRes?.success && Array.isArray(templateRes.templates)) {
            setQuickTexts(
                templateRes.templates
                    .filter((template: TraceTemplate) => template.is_active)
                    .map((template: TraceTemplate) => ({
                        dept: template.dept,
                        text: template.template_text,
                    }))
            );
        } else {
            setQuickTexts(QUICK_TEXTS);
        }
        setLoading(false);
    }, [reservationId]);

    useEffect(() => { load(); }, [load]);

    async function addTrace() {
        if (!text.trim()) return;
        setSaving(true); setError("");
        try {
            const res = await fetch(`/api/bookings/${reservationId}/traces`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    dept, trace_text: text, from_date: fromDate, to_date: toDate,
                })
            });
            const d = await res.json();
            if (res.ok) {
                setShowForm(false); setText("");
                load();
            } else {
                setError(d.error ?? "Error");
            }
        } finally { setSaving(false); }
    }

    async function resolve(id: string, action: "done" | "cancelled") {
        await fetch(`/api/traces/${id}`, {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ action })
        });
        load();
    }

    const openTraces = traces.filter(t => t.status === "open");
    const doneTraces = traces.filter(t => t.status !== "open");

    return (
        <div className="space-y-4">
            {/* Open traces */}
            {loading ? (
                <div className="space-y-2">{[1, 2].map(i => (
                    <div key={i} className="h-14 rounded-xl bg-slate-100 animate-pulse" />
                ))}</div>
            ) : openTraces.length === 0 && !showForm ? (
                <div className="text-center py-6 text-slate-400 text-sm">No open traces. Click + to add one.</div>
            ) : (
                <div className="space-y-2">
                    {openTraces.map(t => (
                        <div key={t.id} className="rounded-xl border border-amber-200 bg-amber-50 p-3">
                            <div className="flex items-start justify-between gap-2">
                                <div className="flex-1 min-w-0">
                                    <div className="flex items-center gap-1.5 mb-1">
                                        <span className={`text-[10px] font-bold rounded px-1.5 py-0.5 ${DEPT_COLOR[t.dept]}`}>
                                            {DEPT_LABEL[t.dept]}
                                        </span>
                                        <span className="text-[10px] text-slate-400">{t.from_date} → {t.to_date}</span>
                                        {t.loan_items && (
                                            <span className="text-[10px] bg-slate-100 text-slate-600 rounded px-1">
                                                {t.loan_items.icon} {t.loan_items.name} ×{t.loan_qty}
                                            </span>
                                        )}
                                    </div>
                                    <p className="text-sm text-slate-800">{t.trace_text}</p>
                                    {t.created_by && <p className="text-[10px] text-slate-400 mt-0.5">By {t.created_by}</p>}
                                </div>
                                <div className="flex gap-1 flex-shrink-0">
                                    <button
                                        onClick={() => resolve(t.id, "done")}
                                        className="btn btn-sm bg-emerald-500 text-white hover:bg-emerald-600 px-2 py-1 text-xs"
                                        title="Mark as done"
                                    >✓</button>
                                    <button
                                        onClick={() => resolve(t.id, "cancelled")}
                                        className="btn btn-sm btn-ghost text-slate-400 hover:text-red-500 px-1"
                                        title="Cancel trace"
                                    >✕</button>
                                </div>
                            </div>
                        </div>
                    ))}
                </div>
            )}

            {/* Add trace form */}
            {showForm ? (
                <div className="rounded-xl border border-brand-200 bg-brand-50 p-4 space-y-3">
                    <div className="flex gap-2">
                        <div className="flex-1">
                            <label className="form-label">Department</label>
                            <select className="form-input" value={dept} onChange={e => setDept(e.target.value as TraceDept)}>
                                {Object.entries(DEPT_LABEL).map(([k, v]) => (
                                    <option key={k} value={k}>{v}</option>
                                ))}
                            </select>
                        </div>
                        <div>
                            <label className="form-label">From</label>
                            <input type="date" className="form-input" value={fromDate} onChange={e => setFromDate(e.target.value)} />
                        </div>
                        <div>
                            <label className="form-label">To</label>
                            <input type="date" className="form-input" value={toDate} onChange={e => setToDate(e.target.value)} />
                        </div>
                    </div>

                    {/* Quick text buttons */}
                    <div>
                        <p className="form-label mb-1">Quick Text</p>
                        <div className="flex flex-wrap gap-1">
                            {quickTexts.map((qt, i) => (
                                <button key={i} onClick={() => { setText(qt.text); setDept(qt.dept); }}
                                    className="text-[10px] rounded border border-slate-200 bg-white px-2 py-0.5 hover:bg-slate-50 truncate max-w-[160px]"
                                    title={qt.text}
                                >
                                    {qt.text.slice(0, 30)}…
                                </button>
                            ))}
                        </div>
                    </div>

                    <div>
                        <label className="form-label">Trace Text</label>
                        <textarea
                            className="form-input min-h-[80px]"
                            value={text}
                            onChange={e => setText(e.target.value)}
                            placeholder="Enter trace message..."
                        />
                    </div>

                    {error && <p className="text-sm text-rose-600">{error}</p>}
                    <div className="flex gap-2">
                        <button className="btn btn-primary flex-1" onClick={addTrace} disabled={saving}>
                            {saving ? "Saving…" : "Save Trace"}
                        </button>
                        <button className="btn btn-secondary" onClick={() => setShowForm(false)}>Cancel</button>
                    </div>
                </div>
            ) : (
                <button className="btn btn-secondary btn-sm w-full" onClick={() => setShowForm(true)}>
                    + Add Trace
                </button>
            )}

            {/* Done/Cancelled traces (collapsed) */}
            {doneTraces.length > 0 && (
                <details className="text-sm">
                    <summary className="cursor-pointer text-slate-400 text-xs font-semibold">
                        {doneTraces.length} resolved trace{doneTraces.length !== 1 ? "s" : ""}
                    </summary>
                    <div className="mt-2 space-y-1">
                        {doneTraces.map(t => (
                            <div key={t.id} className="rounded-lg border border-slate-100 bg-slate-50 p-2 flex items-center gap-2 opacity-60">
                                <span className={`text-[10px] font-bold rounded px-1 ${DEPT_COLOR[t.dept]}`}>{t.dept}</span>
                                <span className="flex-1 text-xs text-slate-600 truncate">{t.trace_text}</span>
                                <span className={`text-[10px] font-semibold ${STATUS_COLOR[t.status]}`}>{t.status}</span>
                            </div>
                        ))}
                    </div>
                </details>
            )}
        </div>
    );
}

/* ══════════════════════════════════════════════════════════════
   ALERTS TAB
══════════════════════════════════════════════════════════════ */
function AlertsTab({ reservationId }: { reservationId: string }) {
    const [alerts, setAlerts] = useState<AlertRow[]>([]);
    const [allCodes, setAllCodes] = useState<AlertCode[]>([]);
    const [loading, setLoading] = useState(true);
    const [addingCode, setAddingCode] = useState("");
    const [addingNote, setAddingNote] = useState("");
    const [saving, setSaving] = useState(false);
    const [error, setError] = useState("");

    const load = useCallback(async () => {
        setLoading(true);
        const [aRes, cRes] = await Promise.all([
            fetch(`/api/bookings/${reservationId}/alerts?include_dismissed=1`).then(r => r.json()),
            fetch("/api/alert-codes").then(r => r.json())
        ]);
        if (aRes.success) setAlerts(aRes.alerts);
        if (cRes.success) setAllCodes(cRes.codes);
        setLoading(false);
    }, [reservationId]);

    useEffect(() => { load(); }, [load]);

    async function addAlert() {
        if (!addingCode) return;
        setSaving(true); setError("");
        const res = await fetch(`/api/bookings/${reservationId}/alerts`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ alert_code: addingCode, note: addingNote || undefined })
        });
        const d = await res.json();
        if (res.ok) { setAddingCode(""); setAddingNote(""); load(); }
        else setError(d.error ?? "Error");
        setSaving(false);
    }

    async function setDismissed(alertId: string, action: "dismiss" | "restore") {
        await fetch(`/api/bookings/${reservationId}/alerts`, {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ alert_id: alertId, action })
        });
        load();
    }

    const activeAlerts = alerts.filter((a) => !a.is_dismissed);
    const dismissedAlerts = alerts.filter((a) => a.is_dismissed);
    const usedCodes = new Set(activeAlerts.map(a => a.alert_code).filter(Boolean));
    const available = allCodes.filter(c => !usedCodes.has(c.code));

    return (
        <div className="space-y-4">
            {/* Active alerts */}
            {loading ? (
                <div className="h-10 rounded-xl bg-slate-100 animate-pulse" />
            ) : activeAlerts.length === 0 ? (
                <p className="text-center text-sm text-slate-400 py-4">No alerts on this reservation.</p>
            ) : (
                <div className="flex flex-wrap gap-2">
                    {activeAlerts.map(a => (
                        <div key={a.id}
                            className="flex items-center gap-1.5 rounded-full border border-rose-200 bg-rose-50 pl-2 pr-1 py-1"
                        >
                            <span className="text-sm">{a.icon ?? a.alert_codes?.icon ?? "🔔"}</span>
                            <div>
                                <span className="text-xs font-bold text-rose-700">{a.template_name ?? a.alert_code ?? "Alert"}</span>
                                {a.message && <span className="ml-1 text-[10px] text-rose-500">{a.message}</span>}
                            </div>
                            <button
                                onClick={() => setDismissed(a.id, "dismiss")}
                                className="btn btn-secondary btn-sm ml-1"
                                title="Dismiss alert"
                            >👁‍🗨</button>
                        </div>
                    ))}
                </div>
            )}

            {/* Add alert */}
            <div className="rounded-xl border border-slate-200 bg-slate-50 p-3 space-y-2">
                <p className="text-xs font-bold text-slate-600">Add Alert</p>
                <div className="flex gap-2">
                    <select className="form-input flex-1" value={addingCode} onChange={e => setAddingCode(e.target.value)}>
                        <option value="">Select alert code…</option>
                        {available.map(c => (
                            <option key={c.code} value={c.code}>
                                {c.icon} {c.code} — {c.description}
                            </option>
                        ))}
                    </select>
                    <button className="btn btn-primary btn-sm px-4" onClick={addAlert} disabled={!addingCode || saving}>
                        {saving ? "…" : "+ Add"}
                    </button>
                </div>
                {addingCode && (
                    <input
                        className="form-input"
                        placeholder="Optional note (e.g. adaptor EU type)"
                        value={addingNote}
                        onChange={e => setAddingNote(e.target.value)}
                    />
                )}
                {error && <p className="text-xs text-rose-600">{error}</p>}
            </div>

            {/* All code reference */}
            <details className="text-sm">
                <summary className="cursor-pointer text-slate-400 text-xs font-semibold">View all alert codes</summary>
                <div className="mt-2 space-y-1">
                    {allCodes.map(c => (
                        <div key={c.code} className="flex items-center gap-2 text-xs text-slate-600 py-1 border-b border-slate-100">
                            <span>{c.icon}</span>
                            <span className="font-bold w-10">{c.code}</span>
                            <span className="flex-1">{c.description}</span>
                            {c.auto_on_co && <span className="text-[9px] bg-rose-100 text-rose-600 rounded px-1">C/O</span>}
                        </div>
                    ))}
                </div>
            </details>

            {dismissedAlerts.length > 0 && (
                <details className="text-sm">
                    <summary className="cursor-pointer text-slate-400 text-xs font-semibold">
                        {dismissedAlerts.length} dismissed alert{dismissedAlerts.length !== 1 ? "s" : ""}
                    </summary>
                    <div className="mt-2 space-y-2">
                        {dismissedAlerts.map((a) => (
                            <div key={a.id} className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-600 flex items-center justify-between gap-2">
                                <div className="min-w-0">
                                    <p className="font-semibold text-slate-700 truncate">{a.template_name ?? a.alert_code ?? "Alert"}</p>
                                    <p className="truncate">{a.message ?? a.note ?? ""}</p>
                                </div>
                                <button
                                    className="btn btn-secondary btn-sm"
                                    onClick={() => setDismissed(a.id, "restore")}
                                >
                                    Restore
                                </button>
                            </div>
                        ))}
                    </div>
                </details>
            )}
        </div>
    );
}

/* ══════════════════════════════════════════════════════════════
   GUEST PROFILE TAB
══════════════════════════════════════════════════════════════ */
function GuestProfileTab({ reservationId, guestName }: { reservationId: string; guestName: string }) {
    const [linked, setLinked] = useState<GuestProfile | null>(null);
    const [results, setResults] = useState<GuestProfile[]>([]);
    const [searching, setSearching] = useState(false);
    const [q, setQ] = useState(guestName);
    const [mode, setMode] = useState<"view" | "search" | "create">("view");
    const [loading, setLoading] = useState(true);
    const [saving, setSaving] = useState(false);
    const [error, setError] = useState("");

    // Create form
    const [createForm, setCreateForm] = useState({
        first_name: "", last_name: guestName, gender: "M", nationality: "",
        phone: "", email: "", line_id: "", car_registration: "",
        vip_tier: "regular", preferences: "", notes: ""
    });

    // Load linked profile
    useEffect(() => {
        (async () => {
            setLoading(true);
            // Try to get the linked guest_profile_id from the reservation
            const res = await fetch(`/api/bookings/${reservationId}`).catch(() => null);
            if (res?.ok) {
                const d = await res.json();
                const profileId = d.reservation?.guest_profile_id;
                if (profileId) {
                    const pRes = await fetch(`/api/guests/${profileId}`).then(r => r.json());
                    if (pRes.success) setLinked(pRes.profile);
                }
            }
            setLoading(false);
        })();
    }, [reservationId]);

    async function search() {
        if (!q) return;
        setSearching(true);
        const res = await fetch(`/api/guests?q=${encodeURIComponent(q)}`).then(r => r.json());
        if (res.success) setResults(res.profiles);
        setSearching(false);
    }

    async function linkProfile(profileId: string) {
        setSaving(true);
        const res = await fetch(`/api/bookings/${reservationId}/guest-profile`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ guest_profile_id: profileId })
        });
        const d = await res.json();
        if (res.ok) {
            const pRes = await fetch(`/api/guests/${profileId}`).then(r => r.json());
            if (pRes.success) { setLinked(pRes.profile); setMode("view"); }
        } else {
            setError(d.error ?? "Error");
        }
        setSaving(false);
    }

    async function createAndLink() {
        if (!createForm.last_name) return;
        setSaving(true); setError("");
        const res = await fetch("/api/guests", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(createForm)
        });
        const d = await res.json();
        if (res.ok) {
            await linkProfile(d.profile.id);
        } else {
            setError(d.error ?? "Error");
            setSaving(false);
        }
    }

    const tier = linked ? (VIP_TIER_LABEL[linked.vip_tier ?? "regular"] ?? VIP_TIER_LABEL.regular) : null;

    if (loading) return <div className="h-20 rounded-xl bg-slate-100 animate-pulse" />;

    return (
        <div className="space-y-4">
            {linked && mode === "view" ? (
                /* ── Linked profile card ── */
                <div className="rounded-xl border border-slate-200 bg-white p-4 space-y-3">
                    <div className="flex items-start justify-between">
                        <div>
                            <p className="text-lg font-bold text-slate-900 flex items-center gap-2">
                                {linked.first_name} {linked.last_name}
                                {linked.member_no && (
                                    <span className="text-[10px] font-mono bg-slate-100 text-slate-500 px-1.5 py-0.5 rounded border border-slate-200">
                                        {linked.member_no}
                                    </span>
                                )}
                            </p>
                            {linked.nationality && (
                                <p className="text-xs text-slate-400 flex items-center gap-1 mt-0.5">
                                    <span className="text-sm leading-none">{getNationalityFlag(linked.nationality)}</span>
                                    {linked.nationality}
                                </p>
                            )}
                        </div>
                        <div className="flex items-center gap-1.5">
                            {linked.blacklisted && (
                                <span className="badge bg-red-100 text-red-700 text-[10px]">⛔ Blacklisted</span>
                            )}
                            {tier && (
                                <span className={`badge text-[10px] font-bold ${tier.color}`}>{tier.label}</span>
                            )}
                        </div>
                    </div>

                    <div className="grid grid-cols-2 gap-2 text-xs">
                        {linked.phone && <div>📞 {linked.phone}</div>}
                        {linked.email && <div>📧 {linked.email}</div>}
                        {linked.line_id && <div>💬 {linked.line_id}</div>}
                        {linked.car_registration && <div>🚗 {linked.car_registration}</div>}
                        {linked.gender && <div>👤 {linked.gender === 'M' ? 'Male' : linked.gender === 'F' ? 'Female' : linked.gender}</div>}
                        {linked.stay_count !== undefined && (
                            <div className="col-span-2 text-slate-500">
                                🏨 {linked.stay_count} previous stay{linked.stay_count !== 1 ? "s" : ""}
                            </div>
                        )}
                    </div>

                    {linked.preferences && (
                        <div className="rounded-lg bg-sky-50 border border-sky-100 px-3 py-2 text-xs text-sky-700">
                            💬 <span className="font-semibold">Preferences:</span> {linked.preferences}
                        </div>
                    )}
                    {linked.notes && (
                        <div className="rounded-lg bg-amber-50 border border-amber-100 px-3 py-2 text-xs text-amber-700">
                            📝 <span className="font-semibold">Staff Notes:</span> {linked.notes}
                        </div>
                    )}

                    <button className="text-xs text-brand-600 underline" onClick={() => setMode("search")}>
                        Change linked profile
                    </button>
                </div>
            ) : mode === "search" || (!linked && mode === "view") ? (
                /* ── Search ── */
                <div className="space-y-3">
                    <p className="text-sm font-semibold text-slate-700">
                        {linked ? "Change Guest Profile" : "Link Guest Profile"}
                    </p>
                    <div className="flex gap-2">
                        <input className="form-input flex-1" value={q} onChange={e => setQ(e.target.value)}
                            placeholder="Search by name or passport…"
                            onKeyDown={e => e.key === "Enter" && search()} />
                        <button className="btn btn-secondary btn-sm" onClick={search} disabled={searching}>
                            {searching ? "…" : "Search"}
                        </button>
                    </div>

                    {results.length > 0 && (
                        <div className="space-y-2">
                            {results.map(p => {
                                const t = VIP_TIER_LABEL[p.vip_tier ?? "regular"] ?? VIP_TIER_LABEL.regular;
                                return (
                                    <button key={p.id}
                                        onClick={() => linkProfile(p.id)}
                                        disabled={saving}
                                        className="w-full rounded-xl border border-slate-200 p-3 text-left hover:border-brand-300 hover:bg-brand-50 transition"
                                    >
                                        <div className="flex items-center justify-between">
                                            <span className="font-semibold text-sm">{p.first_name} {p.last_name}</span>
                                            <span className={`badge text-[10px] ${t.color}`}>{t.label}</span>
                                        </div>
                                        <div className="text-xs text-slate-400 mt-0.5 flex items-center gap-1">
                                            {getNationalityFlag(p.nationality || "")} {p.nationality} · {p.phone} · {p.stay_count} stays
                                        </div>
                                    </button>
                                );
                            })}
                        </div>
                    )}

                    <button className="btn btn-secondary btn-sm w-full" onClick={() => setMode("create")}>
                        + Create New Profile
                    </button>
                    {linked && (
                        <button className="text-xs text-slate-400 underline" onClick={() => setMode("view")}>
                            Cancel
                        </button>
                    )}
                </div>
            ) : (
                /* ── Create new ── */
                <div className="space-y-3">
                    <p className="text-sm font-semibold text-slate-700">Create New Guest Profile</p>
                    <div className="grid grid-cols-2 gap-2">
                        <div>
                            <label className="form-label">First Name</label>
                            <input className="form-input" value={createForm.first_name}
                                onChange={e => setCreateForm(f => ({ ...f, first_name: e.target.value }))} />
                        </div>
                        <div>
                            <label className="form-label">Last Name *</label>
                            <input className="form-input" value={createForm.last_name}
                                onChange={e => setCreateForm(f => ({ ...f, last_name: e.target.value }))} />
                        </div>
                        <div>
                            <label className="form-label">Gender</label>
                            <select className="form-input" value={createForm.gender}
                                onChange={e => setCreateForm(f => ({ ...f, gender: e.target.value }))}>
                                <option value="M">Male</option>
                                <option value="F">Female</option>
                                <option value="Other">Other</option>
                            </select>
                        </div>
                        <div>
                            <label className="form-label">Nationality</label>
                            <input
                                className="form-input"
                                value={createForm.nationality}
                                onChange={e => setCreateForm(f => ({ ...f, nationality: e.target.value }))}
                                onBlur={() => setCreateForm(f => ({ ...f, nationality: formatNationalityCode(f.nationality) }))}
                                placeholder="e.g. THA, GBR, or Thai"
                            />
                        </div>
                        <div>
                            <label className="form-label">VIP Tier</label>
                            <select className="form-input" value={createForm.vip_tier}
                                onChange={e => setCreateForm(f => ({ ...f, vip_tier: e.target.value }))}>
                                <option value="regular">Regular</option>
                                <option value="loyal">Regular Loyal</option>
                                <option value="vip">Year Loyalty VIP</option>
                                <option value="longest">⭐ Longest Loyalty</option>
                            </select>
                        </div>
                        <div>
                            <label className="form-label">Phone</label>
                            <input className="form-input" value={createForm.phone}
                                onChange={e => setCreateForm(f => ({ ...f, phone: e.target.value }))} />
                        </div>
                        <div>
                            <label className="form-label">Email</label>
                            <input className="form-input" value={createForm.email}
                                onChange={e => setCreateForm(f => ({ ...f, email: e.target.value }))} />
                        </div>
                        <div>
                            <label className="form-label">Line ID / WhatsApp</label>
                            <input className="form-input" value={createForm.line_id}
                                onChange={e => setCreateForm(f => ({ ...f, line_id: e.target.value }))} />
                        </div>
                        <div>
                            <label className="form-label">Car Registration</label>
                            <input className="form-input" value={createForm.car_registration}
                                onChange={e => setCreateForm(f => ({ ...f, car_registration: e.target.value }))} />
                        </div>
                    </div>
                    <div>
                        <label className="form-label">Preferences</label>
                        <input className="form-input" value={createForm.preferences}
                            onChange={e => setCreateForm(f => ({ ...f, preferences: e.target.value }))}
                            placeholder="e.g. Prefers floor 3, no spicy food, extra pillow" />
                    </div>
                    <div>
                        <label className="form-label">Staff Notes</label>
                        <textarea className="form-input" value={createForm.notes}
                            onChange={e => setCreateForm(f => ({ ...f, notes: e.target.value }))}
                            placeholder="Internal notes (not shown to guest)" />
                    </div>
                    {error && <p className="text-xs text-rose-600">{error}</p>}
                    <div className="flex gap-2">
                        <button className="btn btn-primary flex-1" onClick={createAndLink} disabled={saving || !createForm.last_name}>
                            {saving ? "Creating…" : "Create & Link"}
                        </button>
                        <button className="btn btn-secondary" onClick={() => setMode("search")}>Back</button>
                    </div>
                </div>
            )}
        </div>
    );
}

/* ══════════════════════════════════════════════════════════════
   LOAN ITEMS TAB
══════════════════════════════════════════════════════════════ */
function LoanItemsTab({ reservationId, checkinDate, checkoutDate, onOpenCharges }: {
    reservationId: string; checkinDate: string; checkoutDate: string; onOpenCharges: () => void;
}) {
    const [items, setItems] = useState<LoanItem[]>([]);
    const [traces, setTraces] = useState<Trace[]>([]);
    const [loading, setLoading] = useState(true);
    const [loaning, setLoaning] = useState<string | null>(null);
    const [qty, setQty] = useState<Record<string, number>>({});
    const [loanReminder, setLoanReminder] = useState<{ itemName: string; templateCode?: string | null } | null>(null);

    const [dueDate, setDueDate] = useState("");

    const load = useCallback(async () => {
        setLoading(true);
        const [iRes, tRes] = await Promise.all([
            fetch("/api/loan-items").then(r => r.json()),
            fetch(`/api/bookings/${reservationId}/traces?kind=loan`).then(r => r.json())
        ]);
        if (iRes.success) setItems(iRes.items);
        if (tRes.success) setTraces(tRes.traces.filter((t: Trace) => t.loan_item_code && t.status === "open"));
        setLoading(false);
    }, [reservationId]);

    useEffect(() => { load(); }, [load]);

    async function loanItem(code: string) {
        const q = qty[code] ?? 1;
        setLoaning(code);
        const item = items.find(i => i.code === code);
        const targetDate = dueDate || checkoutDate;
        const traceText = dueDate
            ? `${item?.icon ?? ""} ${item?.name} loaned to guest (×${q}) — collect on ${targetDate}.`
            : `${item?.icon ?? ""} ${item?.name} loaned to guest (×${q}) — collect at checkout.`;

        await fetch(`/api/bookings/${reservationId}/traces`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                dept: "FD",
                trace_text: traceText,
                from_date: checkinDate,
                to_date: targetDate, // Trace visibility to target date
                due_date: dueDate || undefined,
                loan_item_code: code,
                loan_qty: q
            })
        });
        await load();
        setLoaning(null);
        setDueDate("");
        if (item?.requires_extra_charge_reminder) {
            setLoanReminder({
                itemName: item.name,
                templateCode: item.linked_fee_template_code ?? null,
            });
        } else {
            setLoanReminder(null);
        }
    }

    async function returnItem(traceId: string) {
        await fetch(`/api/traces/${traceId}`, {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ action: "done", resolved_by: "Front Desk" })
        });
        load();
    }

    const loanedCodes = new Set(traces.map(t => t.loan_item_code));

    return (
        <div className="space-y-4">
            {loanReminder && (
                <div className="rounded-xl border border-amber-200 bg-amber-50 px-3 py-3 text-sm text-amber-800">
                    <p className="font-semibold">This item may require an extra charge.</p>
                    <p className="mt-1">
                        {loanReminder.itemName}
                        {loanReminder.templateCode ? ` · Suggested template: ${loanReminder.templateCode}` : ""}
                    </p>
                    <button
                        className="btn btn-secondary btn-sm mt-2"
                        onClick={() => {
                            onOpenCharges();
                            setLoanReminder(null);
                        }}
                    >
                        Add Extra Charge →
                    </button>
                </div>
            )}
            {/* Currently loaned */}
            {traces.length > 0 && (
                <div>
                    <p className="text-xs font-bold text-rose-600 mb-2">⚠️ Items Currently Loaned Out (must collect at C/O)</p>
                    <div className="space-y-1">
                        {traces.map(t => (
                            <div key={t.id} className="flex items-center justify-between rounded-xl border border-rose-200 bg-rose-50 px-3 py-2">
                                <div className="text-sm">
                                    <span className="font-semibold text-rose-700">
                                        {t.loan_items?.icon} {t.loan_items?.name ?? t.loan_item_code}
                                    </span>
                                    <span className="ml-1 text-rose-500 text-xs">×{t.loan_qty}</span>
                                    <span className="ml-2 bg-rose-200 text-rose-800 text-[10px] font-bold px-1.5 py-0.5 rounded">
                                        Due: {t.due_date || checkoutDate}
                                        {!t.due_date ? " (C/O auto)" : ""}
                                    </span>
                                    {t.loan_items?.requires_hk_collection && (
                                        <span className="ml-1 bg-amber-100 text-amber-800 text-[10px] font-bold px-1.5 py-0.5 rounded border border-amber-200">
                                            HK Collect
                                        </span>
                                    )}
                                </div>
                                <button
                                    className="btn btn-sm bg-emerald-500 text-white hover:bg-emerald-600 text-xs px-3 py-1"
                                    onClick={() => returnItem(t.id)}
                                >✓ Returned</button>
                            </div>
                        ))}
                    </div>
                </div>
            )}

            {/* Stock table */}
            {loading ? (
                <div className="h-40 rounded-xl bg-slate-100 animate-pulse" />
            ) : (
                <div className="rounded-xl border border-slate-200 overflow-hidden">
                    <table className="w-full text-sm">
                        <thead>
                            <tr className="bg-slate-50 border-b border-slate-200">
                                <th className="text-left px-3 py-2 text-xs font-semibold text-slate-400">Item</th>
                                <th className="text-center px-2 py-2 text-xs font-semibold text-slate-400">Avail</th>
                                <th className="text-center px-2 py-2 text-xs font-semibold text-slate-400">Qty</th>
                                <th className="px-2 py-2"></th>
                            </tr>
                        </thead>
                        <tbody>
                            {items.map(item => {
                                const alreadyLoaned = loanedCodes.has(item.code);
                                const q = qty[item.code] ?? 1;
                                return (
                                    <tr key={item.code} className={`border-b border-slate-100 ${alreadyLoaned ? "bg-rose-50/40" : ""}`}>
                                        <td className="px-3 py-2">
                                            <span className="mr-1">{item.icon}</span>
                                            <span className="font-medium">{item.name}</span>
                                            {alreadyLoaned && <span className="ml-2 text-[10px] text-rose-500 font-semibold">LOANED</span>}
                                        </td>
                                        <td className="text-center px-2 py-2">
                                            <span className={item.available === 0 ? "text-rose-500 font-bold" : "text-emerald-600 font-semibold"}>
                                                {item.available}/{item.total_qty}
                                            </span>
                                        </td>
                                        <td className="text-center px-2 py-2">
                                            <input
                                                type="number" min={1} max={item.available}
                                                value={q}
                                                onChange={e => setQty(prev => ({ ...prev, [item.code]: parseInt(e.target.value) || 1 }))}
                                                className="form-input w-14 py-0.5 text-center"
                                                disabled={item.available === 0 || alreadyLoaned}
                                            />
                                        </td>
                                        <td className="px-2 py-2">
                                            <button
                                                className="btn btn-sm btn-primary text-xs px-3 py-1"
                                                disabled={item.available === 0 || alreadyLoaned || loaning === item.code}
                                                onClick={() => loanItem(item.code)}
                                            >
                                                {loaning === item.code ? "…" : "Loan"}
                                            </button>
                                        </td>
                                    </tr>
                                );
                            })}
                        </tbody>
                    </table>
                </div>
            )}

            {!loading && (
                <div className="rounded-xl border border-brand-200 bg-brand-50 p-3 space-y-2">
                    <div className="text-xs text-brand-900">
                        <span className="font-semibold">Default Due Date:</span>{" "}
                        <span className="font-bold">{checkoutDate}</span>{" "}
                        <span className="text-brand-700">(auto-follows reservation C/O)</span>
                    </div>
                    <div className="flex items-center gap-3">
                        <label className="text-xs font-semibold text-brand-900 whitespace-nowrap">Specific Due Date (Optional):</label>
                        <input
                            type="date"
                            className="form-input text-xs py-1"
                            value={dueDate}
                            onChange={e => setDueDate(e.target.value)}
                            min={checkinDate}
                            max={checkoutDate}
                        />
                    </div>
                </div>
            )}
        </div>
    );
}

/* ══════════════════════════════════════════════════════════════
   CHARGES TAB
══════════════════════════════════════════════════════════════ */
function ChargesTab({ reservationId }: { reservationId: string }) {
    const [charges, setCharges] = useState<any[]>([]);
    const [templates, setTemplates] = useState<any[]>([]);
    const [loading, setLoading] = useState(true);
    const [saving, setSaving] = useState(false);
    const [error, setError] = useState("");

    const [form, setForm] = useState({ template_code: "", amount: "", method: "cash", note: "" });

    const load = useCallback(async () => {
        setLoading(true);
        const [cRes, tRes] = await Promise.all([
            fetch(`/api/bookings/${reservationId}/extra-charges`).then(r => r.json()).catch(() => ({})),
            fetch("/api/extra-fee-templates?active=true").then(r => r.json()).catch(() => ({}))
        ]);
        if (cRes.success) setCharges(cRes.charges || []);
        if (tRes.success) setTemplates(tRes.templates || []);
        setLoading(false);
    }, [reservationId]);

    useEffect(() => { load(); }, [load]);

    async function addCharge() {
        if (!form.template_code) return;
        setSaving(true); setError("");
        const selected = templates.find(t => t.code === form.template_code);
        const amt = parseFloat(form.amount) || selected?.default_price || 0;

        try {
            const res = await fetch(`/api/bookings/${reservationId}/extra-charges`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    fee_template_code: form.template_code,
                    amount: amt,
                    payment_method: form.method,
                    note: form.note || undefined
                })
            });
            const d = await res.json();
            if (res.ok) {
                setForm({ template_code: "", amount: "", method: "cash", note: "" });
                load();
            } else {
                setError(d.error ?? "Failed to add charge");
            }
        } finally {
            setSaving(false);
        }
    }

    const serviceTemplates = templates.filter(t => t.category === "service" && t.is_active !== false);
    const damageTemplates = templates.filter(t => t.category === "damage" && t.is_active !== false);

    // Total calculation
    const total = charges.reduce((sum, c) => sum + Number(c.amount || 0), 0);

    function getTemplateMeta(charge: any): { name: string; icon: string; method: string } {
        const relation = Array.isArray(charge?.extra_fee_templates)
            ? charge.extra_fee_templates[0]
            : charge?.extra_fee_templates;
        return {
            name: String(relation?.name ?? charge?.fee_template_code ?? "Extra Charge"),
            icon: relation?.icon ? String(relation.icon) : "",
            method: String(charge?.method ?? ""),
        };
    }

    return (
        <div className="space-y-4">
            {/* Added charges */}
            {loading ? (
                <div className="h-20 rounded-xl bg-slate-100 animate-pulse" />
            ) : charges.length === 0 ? (
                <p className="text-center text-sm text-slate-400 py-4">No extra charges on this reservation.</p>
            ) : (
                <div className="space-y-2">
                    {charges.map((c, i) => (
                        <div key={c.id || i} className="flex items-center justify-between rounded-xl border border-slate-200 p-3">
                            <div>
                                <p className="text-sm font-semibold text-slate-700">
                                    {[getTemplateMeta(c).icon, getTemplateMeta(c).name].filter(Boolean).join(" ")}
                                </p>
                                <p className="text-xs text-slate-400 flex items-center gap-2">
                                    <span className="capitalize">{getTemplateMeta(c).method || "-"}</span>
                                    {c.note && <span>· {c.note}</span>}
                                </p>
                            </div>
                            <span className="font-mono font-bold text-slate-900">฿ {Number(c.amount).toLocaleString(undefined, { minimumFractionDigits: 2 })}</span>
                        </div>
                    ))}
                    <div className="flex items-center justify-between py-2 border-t border-slate-200 mt-2 font-bold text-sm text-slate-900">
                        <span>Total Extra Charges</span>
                        <span className="font-mono">฿ {total.toLocaleString(undefined, { minimumFractionDigits: 2 })}</span>
                    </div>
                </div>
            )}

            {/* Add form */}
            <div className="rounded-xl border border-brand-200 bg-brand-50 p-4 space-y-3">
                <p className="text-sm font-semibold text-brand-900">Add Extra Charge</p>

                <div>
                    <label className="form-label">Charge Type / Template</label>
                    <select
                        className="form-input"
                        value={form.template_code}
                        onChange={e => {
                            const t = templates.find(x => x.code === e.target.value);
                            setForm({ ...form, template_code: e.target.value, amount: t?.default_price ? String(t.default_price) : "" });
                        }}
                    >
                        <option value="">— Select —</option>
                        {serviceTemplates.length > 0 && (
                            <optgroup label="Service & Add-ons">
                                {serviceTemplates.map(t => (
                                    <option key={t.code} value={t.code}>{t.name || t.code}</option>
                                ))}
                            </optgroup>
                        )}
                        {damageTemplates.length > 0 && (
                            <optgroup label="Damage & Losses">
                                {damageTemplates.map(t => (
                                    <option key={t.code} value={t.code}>{t.name || t.code}</option>
                                ))}
                            </optgroup>
                        )}
                    </select>
                </div>

                <div className="grid grid-cols-2 gap-2">
                    <div>
                        <label className="form-label">Amount (฿)</label>
                        <input className="form-input font-mono" type="number" min="0" value={form.amount} onChange={e => setForm({ ...form, amount: e.target.value })} />
                    </div>
                    <div>
                        <label className="form-label">Method</label>
                        <select className="form-input" value={form.method} onChange={e => setForm({ ...form, method: e.target.value })}>
                            <option value="cash">Cash</option>
                            <option value="transfer">Transfer</option>
                            <option value="credit_card">Card</option>
                        </select>
                    </div>
                </div>

                <div>
                    <label className="form-label">Note (Optional)</label>
                    <input className="form-input" value={form.note} onChange={e => setForm({ ...form, note: e.target.value })} placeholder="E.g., Airport pickup at 3pm" />
                </div>

                {error && <p className="text-xs text-rose-600">{error}</p>}

                <button
                    className="btn btn-primary w-full"
                    onClick={addCharge}
                    disabled={!form.template_code || saving}
                >
                    {saving ? "Adding…" : "+ Add Charge"}
                </button>
            </div>
        </div>
    );
}
