"use client";

import { useCallback, useEffect, useRef, useState } from "react";

/* ─── Types ─────────────────────────────────────────── */
type ProfileData = {
    id: string;
    first_name: string | null;
    last_name: string;
    phone: string | null;
    email: string | null;
    nationality: string | null;
    nationality_code: string | null;
    passport_no: string | null;
    stay_count: number;
    profile_status: string | null;
};

type DuplicatePair = {
    id: string;
    profile_a: string;
    profile_b: string;
    score: number;
    match_fields: Record<string, any>;
    status: string;
    profile_a_data: ProfileData | null;
    profile_b_data: ProfileData | null;
};

/* ─── Page ───────────────────────────────────────────── */
export default function DuplicatesPage() {
    const [pairs, setPairs] = useState<DuplicatePair[]>([]);
    const [total, setTotal] = useState(0);
    const [loading, setLoading] = useState(true);
    const [actionLoading, setActionLoading] = useState<string | null>(null);
    const [scanning, setScanning] = useState(false);
    const [error, setError] = useState("");
    const [statusFilter, setStatusFilter] = useState("pending");
    const autoScanTriggeredRef = useRef(false);

    const load = useCallback(async () => {
        setLoading(true);
        setError("");
        try {
            const res = await fetch(`/api/guests/duplicates?status=${statusFilter}&limit=50&t=${Date.now()}`);
            const d = await res.json();
            if (d.success) {
                setPairs(d.items);
                setTotal(d.total);
            } else {
                setError(d.error ?? "Failed to load");
            }
        } catch { setError("Network error"); }
        finally { setLoading(false); }
    }, [statusFilter]);

    useEffect(() => { load(); }, [load]);

    useEffect(() => {
        if (statusFilter !== "pending") return;
        if (loading || scanning) return;
        if (total > 0) return;
        if (autoScanTriggeredRef.current) return;
        autoScanTriggeredRef.current = true;
        void handleScan();
    }, [statusFilter, loading, scanning, total]);

    useEffect(() => {
        if (statusFilter === "pending") {
            autoScanTriggeredRef.current = false;
        }
    }, [statusFilter]);

    async function handleScan() {
        setScanning(true);
        try {
            const res = await fetch("/api/guests/duplicates", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({}),
            });
            const d = await res.json();
            if (!res.ok || !d?.success) {
                alert(d?.error ?? "Scan failed");
                return;
            }
            await load();
        } catch {
            alert("Network error");
        } finally {
            setScanning(false);
        }
    }

    async function handleMerge(masterId: string, sourceId: string, pairId: string) {
        if (!confirm(`Merge into master? Source profile will be marked as merged.`)) return;
        setActionLoading(pairId);
        try {
            const res = await fetch("/api/guests/merge", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ master_id: masterId, source_id: sourceId, reason: "manual_merge_from_queue" }),
            });
            const d = await res.json();
            if (d.success) {
                setPairs((prev) => prev.filter((p) => p.id !== pairId));
                setTotal((t) => Math.max(t - 1, 0));
            } else {
                alert(d.error ?? "Merge failed");
            }
        } catch { alert("Network error"); }
        finally { setActionLoading(null); }
    }

    async function handleAction(pairId: string, action: "dismissed" | "do_not_merge") {
        setActionLoading(pairId);
        try {
            // Direct update on profile_match_scores
            const res = await fetch(`/api/guests/duplicates`, {
                method: "PATCH",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ id: pairId, status: action }),
            });
            const d = await res.json();
            if (d.success) {
                setPairs((prev) => prev.filter((p) => p.id !== pairId));
                setTotal((t) => Math.max(t - 1, 0));
            } else {
                alert(d.error ?? "Action failed");
            }
        } catch { alert("Network error"); }
        finally { setActionLoading(null); }
    }

    const fmtName = (p: ProfileData | null) => {
        if (!p) return "—";
        return [p.first_name, p.last_name].filter(Boolean).join(" ") || "—";
    };

    return (
        <div className="flex flex-col gap-5 max-w-full">
            {/* Header */}
            <div className="flex items-center justify-between flex-wrap gap-3">
                <div>
                    <p className="text-xs font-semibold uppercase tracking-widest text-brand-600">Guests</p>
                    <h1 className="text-2xl font-bold text-[var(--text-primary)] mt-0.5">Duplicate Profiles</h1>
                    <p className="text-sm text-[var(--text-muted)] mt-0.5">{total} suspect pairs</p>
                </div>
                <div className="flex w-full flex-wrap items-center gap-2 sm:w-auto sm:justify-end">
                    <select className="form-select text-sm py-1.5" value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}>
                        <option value="pending">Pending</option>
                        <option value="merged">Merged</option>
                        <option value="dismissed">Dismissed</option>
                        <option value="do_not_merge">Do Not Merge</option>
                    </select>
                    <button
                        className="btn btn-primary btn-sm"
                        onClick={() => void handleScan()}
                        disabled={scanning || loading}
                        title="Scan active profiles and queue duplicate pairs"
                    >
                        {scanning ? "Scanning..." : "Scan Duplicates"}
                    </button>
                    <button className="btn btn-secondary btn-sm" onClick={load}>↻ Refresh</button>
                </div>
            </div>

            {error && <div className="rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">{error}</div>}

            {loading ? (
                <div className="space-y-3">
                    {Array.from({ length: 5 }).map((_, i) => (
                        <div key={i} className="card p-4 animate-pulse">
                            <div className="flex gap-4">
                                <div className="flex-1 space-y-2"><div className="h-4 w-32 bg-[var(--bg-muted)] rounded" /><div className="h-3 w-48 bg-[var(--bg-muted)] rounded" /></div>
                                <div className="flex-1 space-y-2"><div className="h-4 w-32 bg-[var(--bg-muted)] rounded" /><div className="h-3 w-48 bg-[var(--bg-muted)] rounded" /></div>
                            </div>
                        </div>
                    ))}
                </div>
            ) : pairs.length === 0 ? (
                <div className="card p-8 text-center">
                    <p className="text-4xl mb-2">✅</p>
                    <p className="text-sm font-semibold text-[var(--text-secondary)]">No {statusFilter} duplicates</p>
                    {statusFilter === "pending" && (
                        <div className="mt-4">
                            <button
                                className="btn btn-primary btn-sm"
                                onClick={() => void handleScan()}
                                disabled={scanning || loading}
                            >
                                {scanning ? "Scanning..." : "Scan Duplicates Now"}
                            </button>
                        </div>
                    )}
                </div>
            ) : (
                <div className="space-y-3">
                    {pairs.map((pair) => {
                        const a = pair.profile_a_data;
                        const b = pair.profile_b_data;
                        const isLoading = actionLoading === pair.id;
                        const scorePct = Math.min(pair.score, 100);
                        const scoreColor = pair.score >= 70 ? "text-emerald-600 bg-emerald-50" : "text-amber-600 bg-amber-50";

                        return (
                            <div key={pair.id} className="card p-4">
                                {/* Score badge */}
                                <div className="flex items-center justify-between mb-3">
                                    <div className="flex items-center gap-2">
                                        <span className={`text-sm font-bold px-2 py-0.5 rounded ${scoreColor}`}>
                                            Score: {pair.score}
                                        </span>
                                        <div className="h-1.5 w-24 rounded-full bg-[var(--bg-muted)] overflow-hidden">
                                            <div className={`h-full rounded-full ${pair.score >= 70 ? "bg-emerald-500" : "bg-amber-400"}`} style={{ width: `${scorePct}%` }} />
                                        </div>
                                    </div>
                                    {/* Match reasons */}
                                    <div className="flex gap-1 flex-wrap">
                                        {Object.entries(pair.match_fields).map(([k, v]) => (
                                            <span key={k} className="text-[9px] px-1.5 py-0.5 bg-[var(--bg-surface-hover)] text-[var(--text-muted)] rounded font-medium">
                                                {k}: {String(v)}
                                            </span>
                                        ))}
                                    </div>
                                </div>

                                {/* Two profiles side by side */}
                                <div className="grid grid-cols-2 gap-4 mb-3">
                                    <ProfileCard profile={a} label="Profile A" />
                                    <ProfileCard profile={b} label="Profile B" />
                                </div>

                                {/* Actions */}
                                {statusFilter === "pending" && (
                                    <div className="flex items-center gap-2 pt-2 border-t border-[var(--border-subtle)]">
                                        <button
                                            disabled={isLoading}
                                            onClick={() => handleMerge(pair.profile_a, pair.profile_b, pair.id)}
                                            className="btn btn-sm bg-emerald-600 text-white hover:bg-emerald-700 disabled:opacity-50"
                                        >
                                            ← Merge into A
                                        </button>
                                        <button
                                            disabled={isLoading}
                                            onClick={() => handleMerge(pair.profile_b, pair.profile_a, pair.id)}
                                            className="btn btn-sm bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-50"
                                        >
                                            Merge into B →
                                        </button>
                                        <div className="flex-1" />
                                        <button
                                            disabled={isLoading}
                                            onClick={() => handleAction(pair.id, "dismissed")}
                                            className="btn btn-sm btn-secondary disabled:opacity-50"
                                        >
                                            Dismiss
                                        </button>
                                        <button
                                            disabled={isLoading}
                                            onClick={() => handleAction(pair.id, "do_not_merge")}
                                            className="btn btn-sm text-rose-600 border-rose-200 bg-rose-50 hover:bg-rose-100 disabled:opacity-50"
                                        >
                                            🚫 Do Not Merge
                                        </button>
                                    </div>
                                )}
                            </div>
                        );
                    })}
                </div>
            )}
        </div>
    );
}

/* ─── Profile Card ───────────────────────────────────── */
function ProfileCard({ profile, label }: { profile: ProfileData | null; label: string }) {
    if (!profile) return <div className="rounded-lg bg-[var(--bg-body)] p-3 text-sm text-[var(--text-muted)]">Profile not found</div>;

    const name = [profile.first_name, profile.last_name].filter(Boolean).join(" ") || "—";

    return (
        <div className="rounded-lg border border-[var(--border-default)] p-3 bg-[var(--bg-body)]">
            <div className="flex items-center justify-between mb-2">
                <span className="text-[10px] font-bold text-[var(--text-muted)] uppercase">{label}</span>
                {profile.profile_status && (
                    <span className={`text-[10px] px-1.5 py-0.5 rounded font-bold uppercase ${profile.profile_status === "verified" ? "bg-emerald-100 text-emerald-700"
                        : profile.profile_status === "merged" ? "bg-[var(--bg-muted)] text-[var(--text-secondary)]"
                            : "bg-amber-100 text-amber-700"
                        }`}>{profile.profile_status}</span>
                )}
            </div>
            <p className="text-sm font-bold text-[var(--text-primary)]">{name}</p>
            <div className="grid grid-cols-2 gap-x-3 gap-y-1 mt-1.5 text-xs text-[var(--text-secondary)]">
                {profile.phone && <span>📱 {profile.phone}</span>}
                {profile.email && <span>✉️ {profile.email}</span>}
                {profile.nationality_code && <span>🏳️ {profile.nationality_code}</span>}
                {profile.passport_no && <span>🪪 {profile.passport_no}</span>}
                <span>🏨 {profile.stay_count} stays</span>
            </div>
        </div>
    );
}
