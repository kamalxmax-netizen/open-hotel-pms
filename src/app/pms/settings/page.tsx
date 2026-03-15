"use client";

import { useState, useEffect, useCallback } from "react";

type Settings = {
    hotel_name: string;
    hotel_timezone: string;
    sellable_rooms: number;
    business_date: string;
    eod_reminder_time: string;
    night_audit_popup_snooze_min: number;
    check_in_time: string;
    check_out_time: string;
    late_checkout_fee: number;
};

type EodStatus = {
    business_date: string;
    calendar_date: string;
    needs_eod: boolean;
    days_overdue: number;
    eod_reminder_time: string;
    night_audit_popup_snooze_min: number;
};

const DEFAULTS: Settings = {
    hotel_name: "",
    hotel_timezone: "Asia/Bangkok",
    sellable_rooms: 0,
    business_date: "",
    eod_reminder_time: "02:00",
    night_audit_popup_snooze_min: 30,
    check_in_time: "14:00",
    check_out_time: "12:00",
    late_checkout_fee: 0
};

const TIMEZONES = ["Asia/Bangkok", "Asia/Kuala_Lumpur", "Asia/Singapore", "UTC"];
const TIME_OPTIONS = Array.from({ length: 24 }, (_, i) => `${String(i).padStart(2, "0")}:00`);

function mergeDefaults(data: Partial<Settings> | null): Settings {
    return {
        hotel_name: data?.hotel_name ?? "",
        hotel_timezone: data?.hotel_timezone ?? "Asia/Bangkok",
        sellable_rooms: data?.sellable_rooms ?? 0,
        business_date: data?.business_date ?? "",
        eod_reminder_time: data?.eod_reminder_time ?? "02:00",
        night_audit_popup_snooze_min: Number(data?.night_audit_popup_snooze_min ?? 30),
        check_in_time: data?.check_in_time ?? "14:00",
        check_out_time: data?.check_out_time ?? "12:00",
        late_checkout_fee: data?.late_checkout_fee ?? 0
    };
}

export default function SettingsPage() {
    const [settings, setSettings] = useState<Settings>(DEFAULTS);
    const [eodStatus, setEodStatus] = useState<EodStatus | null>(null);
    const [saving, setSaving] = useState(false);
    const [runningEod, setRunningEod] = useState(false);
    const [loaded, setLoaded] = useState(false);
    const [msg, setMsg] = useState({ text: "", type: "" });
    const [eodNotes, setEodNotes] = useState("");

    const loadEodStatus = useCallback(async () => {
        try {
            const res = await fetch("/api/eod/status");
            const d = await res.json();
            if (d.success) setEodStatus(d);
        } catch { /* ignore */ }
    }, []);

    const load = useCallback(async () => {
        try {
            const res = await fetch("/api/settings");
            const data = await res.json();
            if (data.success && data.settings) {
                setSettings(mergeDefaults(data.settings));
            }
        } catch { /* ignore */ }
        setLoaded(true);
        await loadEodStatus();
    }, [loadEodStatus]);

    useEffect(() => { load(); }, [load]);

    function setField(field: keyof Settings, value: string | number) {
        setSettings(prev => ({ ...prev, [field]: value }));
    }

    async function handleSave(e: React.FormEvent) {
        e.preventDefault();
        setSaving(true);
        setMsg({ text: "", type: "" });
        try {
            const res = await fetch("/api/settings", {
                method: "PUT",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(settings)
            });
            const data = await res.json();
            if (res.ok) {
                // Apply server-confirmed values immediately (don't wait for load)
                if (data.settings) setSettings(mergeDefaults(data.settings));
                setMsg({ text: "✓ Settings saved successfully.", type: "ok" });
                // Also reload in background to sync business_date etc.
                load();
            } else {
                setMsg({ text: data.error ?? "Failed to save.", type: "err" });
            }
        } finally { setSaving(false); }
    }

    async function handleRunEod(force = false) {
        const dateLabel = eodStatus?.business_date || settings.business_date || "today";
        if (!confirm(`Run Night Audit for ${dateLabel}?\n\nThis will snapshot revenue and advance the business date.`)) return;
        setRunningEod(true);
        setMsg({ text: "", type: "" });
        try {
            const res = await fetch("/api/eod/run", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ notes: eodNotes, force })
            });
            const data = await res.json();
            if (res.ok) {
                const snap = data.snapshot;
                setMsg({
                    text: `✓ Night Audit complete for ${data.closed_date}.\n` +
                        `Revenue ฿${Number(snap?.total_revenue ?? 0).toLocaleString()} · ` +
                        `Occ ${snap?.occupancy_pct ?? 0}% · ` +
                        `Payment ฿${Number(snap?.payment_total ?? 0).toLocaleString()}\n` +
                        `New Business Date: ${data.new_business_date}`,
                    type: "ok"
                });
                setEodNotes("");
                load();
            } else {
                setMsg({ text: data.error ?? "EOD failed.", type: "err" });
            }
        } finally { setRunningEod(false); }
    }

    const eodUpToDate = eodStatus && !eodStatus.needs_eod;
    const eodOverdue = eodStatus?.needs_eod;
    const eodVeryLate = (eodStatus?.days_overdue ?? 0) > 1;

    if (!loaded || !settings) return (
        <div className="flex items-center justify-center h-64">
            <div className="btn-spinner" />
        </div>
    );

    return (
        <div key="settings-form-mounted" className="max-w-2xl mx-auto space-y-8 pb-12">
            <div>
                <h1 className="page-title">Settings</h1>
                <p className="text-sm text-[var(--text-secondary)]">Hotel configuration and Night Audit management</p>
            </div>

            {/* ── Night Audit Block (always visible) ─────────── */}
            <div className={`rounded-xl border p-4 space-y-3 ${eodVeryLate ? "bg-rose-50 border-rose-200" :
                eodOverdue ? "bg-amber-50 border-amber-200" :
                    "bg-[var(--bg-body)] border-[var(--border-default)]"
                }`}>
                <div className="flex items-start justify-between gap-2">
                    <div>
                        <p className={`text-sm font-bold ${eodVeryLate ? "text-rose-700" :
                            eodOverdue ? "text-amber-700" :
                                "text-[var(--text-table-cell)]"
                            }`}>
                            {eodVeryLate ? `🚨 Night Audit — ${eodStatus!.days_overdue} days overdue!` :
                                eodOverdue ? "⚠️ Night Audit Required" :
                                    eodUpToDate ? "✓ Night Audit — Up to Date" :
                                        "🌙 Night Audit"}
                        </p>
                        {eodStatus && (
                            <p className="text-xs text-[var(--text-secondary)] mt-0.5">
                                Business Date: <strong>{eodStatus.business_date}</strong>
                                {" · "}Calendar: <strong>{eodStatus.calendar_date}</strong>
                            </p>
                        )}
                        {!eodStatus && settings.business_date && (
                            <p className="text-xs text-[var(--text-secondary)] mt-0.5">
                                Business Date: <strong>{settings.business_date}</strong>
                            </p>
                        )}
                    </div>
                </div>

                <textarea
                    className="form-textarea text-sm"
                    placeholder="Night Audit notes (optional)…"
                    rows={2}
                    value={eodNotes}
                    onChange={(e) => setEodNotes(e.target.value)}
                />

                <div className="flex gap-2">
                    {/* Main EOD button — only active when overdue */}
                    {eodOverdue && (
                        <button
                            className="btn btn-primary flex-1"
                            onClick={() => handleRunEod(false)}
                            disabled={runningEod}
                        >
                            {runningEod ? "Running…" : `▶ Run Night Audit for ${eodStatus!.business_date}`}
                        </button>
                    )}

                    {/* Force Run — always available for testing */}
                    <button
                        className="btn btn-secondary flex-shrink-0"
                        onClick={() => handleRunEod(true)}
                        disabled={runningEod}
                        title="Force-run EOD for testing (even when business date = today)"
                    >
                        {runningEod ? "…" : eodUpToDate ? "Force Run (Test)" : "Force Run"}
                    </button>
                </div>

                {eodUpToDate && (
                    <p className="text-xs text-[var(--text-muted)]">
                        EOD auto-button appears tomorrow once the business day ends.
                        Use <em>Force Run</em> to test the flow now.
                    </p>
                )}
            </div>

            {/* Feedback */}
            {msg.text && (
                <div className={`rounded-lg border px-3 py-2 text-sm whitespace-pre-line ${msg.type === "ok"
                    ? "bg-emerald-50 border-emerald-200 text-emerald-700"
                    : "bg-rose-50 border-rose-200 text-rose-700"
                    }`}>
                    {msg.text}
                </div>
            )}

            {/* ── Settings Form ─────────────────────────────── */}
            <form onSubmit={handleSave} className="space-y-6">
                {/* Hotel Info */}
                <div className="rounded-xl border border-[var(--border-default)] bg-[var(--bg-surface)] p-4 space-y-4">
                    <h2 className="text-sm font-bold text-[var(--text-table-cell)] uppercase tracking-wide">Hotel Info</h2>
                    <div className="grid grid-cols-2 gap-3">
                        <div>
                            <label className="form-label">Hotel Name</label>
                            <input
                                className="form-input"
                                value={settings.hotel_name}
                                onChange={(e) => setField("hotel_name", e.target.value)}
                                placeholder="e.g. Orchid Guesthouse"
                            />
                        </div>
                        <div>
                            <label className="form-label">Timezone</label>
                            <select className="form-select" value={settings.hotel_timezone} onChange={(e) => setField("hotel_timezone", e.target.value)}>
                                {TIMEZONES.map((tz) => <option key={tz} value={tz}>{tz}</option>)}
                            </select>
                        </div>
                    </div>
                    <div>
                        <label className="form-label">Sellable Rooms (total)</label>
                        <input type="number" min="1" className="form-input" value={settings.sellable_rooms} onChange={(e) => setField("sellable_rooms", parseInt(e.target.value) || 0)} />
                        <p className="text-xs text-[var(--text-muted)] mt-1">Used to calculate Occupancy % and RevPAR in Night Audit</p>
                    </div>
                </div>

                {/* Check-in / Check-out Times */}
                <div className="rounded-xl border border-[var(--border-default)] bg-[var(--bg-surface)] p-4 space-y-4">
                    <h2 className="text-sm font-bold text-[var(--text-table-cell)] uppercase tracking-wide">Check-in / Check-out</h2>
                    <div className="grid grid-cols-2 gap-3">
                        <div>
                            <label className="form-label">Check-in Time</label>
                            <select className="form-select" value={settings.check_in_time} onChange={(e) => setField("check_in_time", e.target.value)}>
                                {TIME_OPTIONS.map((t) => <option key={t} value={t}>{t}</option>)}
                            </select>
                        </div>
                        <div>
                            <label className="form-label">Check-out Time</label>
                            <select className="form-select" value={settings.check_out_time} onChange={(e) => setField("check_out_time", e.target.value)}>
                                {TIME_OPTIONS.map((t) => <option key={t} value={t}>{t}</option>)}
                            </select>
                        </div>
                    </div>
                    <div>
                        <label className="form-label">Late Check-out Fee (THB)</label>
                        <div className="relative">
                            <span className="absolute left-3 top-2.5 text-sm text-[var(--text-muted)]">฿</span>
                            <input type="number" min="0" step="0.01" className="form-input pl-7" value={settings.late_checkout_fee} onChange={(e) => setField("late_checkout_fee", parseFloat(e.target.value) || 0)} />
                        </div>
                    </div>
                </div>

                {/* Night Audit Settings */}
                <div className="rounded-xl border border-[var(--border-default)] bg-[var(--bg-surface)] p-4 space-y-4">
                    <h2 className="text-sm font-bold text-[var(--text-table-cell)] uppercase tracking-wide">Night Audit Reminder</h2>
                    <div>
                        <label className="form-label">Remind at (time)</label>
                        <select className="form-select" value={settings.eod_reminder_time} onChange={(e) => setField("eod_reminder_time", e.target.value)}>
                            {TIME_OPTIONS.map((t) => <option key={t} value={t}>{t}</option>)}
                        </select>
                        <p className="text-xs text-[var(--text-muted)] mt-1">Dashboard shows an alert if Night Audit has not been run by this time</p>
                    </div>
                    <div>
                        <label className="form-label">Popup snooze (minutes)</label>
                        <input
                            type="number"
                            min="1"
                            max="1440"
                            className="form-input"
                            value={settings.night_audit_popup_snooze_min}
                            onChange={(e) => setField("night_audit_popup_snooze_min", Math.max(1, Math.min(1440, parseInt(e.target.value, 10) || 30)))}
                        />
                        <p className="text-xs text-[var(--text-muted)] mt-1">
                            Operational pages will hide the Night Audit warning for this many minutes after staff dismiss it.
                        </p>
                    </div>
                </div>

                <button type="submit" className="btn btn-primary w-full" disabled={saving}>
                    {saving ? "Saving…" : "💾 Save Settings"}
                </button>
            </form>
        </div>
    );
}
