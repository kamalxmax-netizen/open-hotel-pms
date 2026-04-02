"use client";

import PmsModal from "@/components/pms-modal";
import { useCallback, useEffect, useRef, useState } from "react";

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
    match_fields: Record<string, unknown>;
    status: string;
    profile_a_data: ProfileData | null;
    profile_b_data: ProfileData | null;
};

type ManualSearchProfile = {
    id: string;
    member_no: string | null;
    first_name: string | null;
    last_name: string | null;
    phone: string | null;
    email: string | null;
    nationality_code: string | null;
    country: string | null;
    profile_status: string | null;
    stay_count: number;
    vip_tier: string | null;
    last_stay_date: string | null;
};

type ManualSearchResponse = {
  success: boolean;
  profiles?: ManualSearchProfile[];
  matches?: Array<{
    profile: ManualSearchProfile;
    score: number;
    match_level: string;
  }>;
  error?: string;
};

function formatProfileName(profile: ProfileData | ManualSearchProfile | null) {
    if (!profile) return "—";
    return [profile.first_name, profile.last_name].filter(Boolean).join(" ") || "—";
}

function formatLastStay(value: string | null | undefined) {
    if (!value) return "—";
    const date = new Date(`${value}T00:00:00`);
    if (Number.isNaN(date.getTime())) return value;
    return new Intl.DateTimeFormat("en-GB", {
        day: "2-digit",
        month: "2-digit",
        year: "2-digit",
    }).format(date);
}

function ManualMergePicker({
    label,
    hint,
    query,
    loading,
    results,
    selected,
    onQueryChange,
    onSelect,
}: {
    label: string;
    hint: string;
    query: string;
    loading: boolean;
    results: ManualSearchProfile[];
    selected: ManualSearchProfile | null;
    onQueryChange: (value: string) => void;
    onSelect: (profile: ManualSearchProfile) => void;
}) {
    return (
        <div className="rounded-2xl border border-[var(--border-default)] bg-[var(--bg-body)] p-4">
            <div className="mb-3 flex items-center justify-between gap-3">
                <div>
                    <p className="text-sm font-semibold text-[var(--text-primary)]">{label}</p>
                    <p className="text-xs text-[var(--text-muted)]">{hint}</p>
                </div>
                {selected ? (
                    <span className="badge text-xs bg-emerald-50 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-400">
                        Selected
                    </span>
                ) : null}
            </div>

            <input
                className="form-input"
                value={query}
                onChange={(event) => onQueryChange(event.target.value)}
                placeholder="Type at least 3 characters..."
            />

            <div className="mt-3 min-h-[264px] rounded-xl border border-[var(--border-default)] bg-[var(--bg-surface)]">
                {selected ? (
                    <button
                        type="button"
                        className="flex w-full flex-col gap-1 rounded-xl border border-brand-200 bg-brand-50 px-4 py-3 text-left dark:border-brand-500/30 dark:bg-brand-500/10"
                        onClick={() => onSelect(selected)}
                    >
                        <span className="font-semibold text-[var(--text-primary)]">{formatProfileName(selected)}</span>
                        <span className="text-xs text-[var(--text-secondary)]">
                            {(selected.member_no || selected.id.slice(0, 8)).toUpperCase()} · {selected.phone || "No phone"} · {selected.email || "No email"}
                        </span>
                        <span className="text-xs text-[var(--text-muted)]">
                            {(selected.vip_tier || "regular").toUpperCase()} · {selected.stay_count} stays · last stay {formatLastStay(selected.last_stay_date)}
                        </span>
                    </button>
                ) : null}

                {!selected && query.trim().length < 3 ? (
                    <div className="px-4 py-10 text-center text-sm text-[var(--text-muted)]">
                        Start typing to search guest profiles.
                    </div>
                ) : null}

                {!selected && query.trim().length >= 3 && loading ? (
                    <div className="px-4 py-10 text-center text-sm text-[var(--text-muted)]">Searching...</div>
                ) : null}

                {!selected && query.trim().length >= 3 && !loading && results.length === 0 ? (
                    <div className="px-4 py-10 text-center text-sm text-[var(--text-muted)]">No profiles found.</div>
                ) : null}

                {!selected && results.length > 0 ? (
                    <div className="divide-y divide-[var(--border-default)]">
                        {results.map((profile) => (
                            <button
                                key={profile.id}
                                type="button"
                                className="flex w-full flex-col gap-1 px-4 py-3 text-left transition hover:bg-[var(--bg-body)]"
                                onClick={() => onSelect(profile)}
                            >
                                <span className="font-semibold text-[var(--text-primary)]">{formatProfileName(profile)}</span>
                                <span className="text-xs text-[var(--text-secondary)]">
                                    {(profile.member_no || profile.id.slice(0, 8)).toUpperCase()} · {profile.phone || "No phone"} · {profile.email || "No email"}
                                </span>
                                <span className="text-xs text-[var(--text-muted)]">
                                    {(profile.vip_tier || "regular").toUpperCase()} · {profile.stay_count} stays · last stay {formatLastStay(profile.last_stay_date)}
                                </span>
                            </button>
                        ))}
                    </div>
                ) : null}
            </div>
        </div>
    );
}

export default function DuplicatesPage() {
    const [pairs, setPairs] = useState<DuplicatePair[]>([]);
    const [total, setTotal] = useState(0);
    const [loading, setLoading] = useState(true);
    const [actionLoading, setActionLoading] = useState<string | null>(null);
    const [scanning, setScanning] = useState(false);
    const [error, setError] = useState("");
    const [statusFilter, setStatusFilter] = useState("pending");
    const [showManualMerge, setShowManualMerge] = useState(false);
    const [manualMergeError, setManualMergeError] = useState("");
    const [manualMergeLoading, setManualMergeLoading] = useState(false);
    const [mergeReason, setMergeReason] = useState("manual_merge_from_picker");
    const [sourceQuery, setSourceQuery] = useState("");
    const [masterQuery, setMasterQuery] = useState("");
    const [sourceResults, setSourceResults] = useState<ManualSearchProfile[]>([]);
    const [masterResults, setMasterResults] = useState<ManualSearchProfile[]>([]);
    const [sourceLoading, setSourceLoading] = useState(false);
    const [masterLoading, setMasterLoading] = useState(false);
    const [selectedSource, setSelectedSource] = useState<ManualSearchProfile | null>(null);
    const [selectedMaster, setSelectedMaster] = useState<ManualSearchProfile | null>(null);
    const autoScanTriggeredRef = useRef(false);

    const load = useCallback(async () => {
        setLoading(true);
        setError("");
        try {
            const res = await fetch(`/api/guests/duplicates?status=${statusFilter}&limit=50&t=${Date.now()}`);
            const data = await res.json();
            if (data.success) {
                setPairs(data.items);
                setTotal(data.total);
            } else {
                setError(data.error ?? "Failed to load");
            }
        } catch {
            setError("Network error");
        } finally {
            setLoading(false);
        }
    }, [statusFilter]);

    useEffect(() => {
        void load();
    }, [load]);

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

    useEffect(() => {
        if (typeof window === "undefined") return;
        const params = new URLSearchParams(window.location.search);
        setShowManualMerge(params.get("manual") === "1");
    }, []);

    const closeManualMerge = useCallback(() => {
        setShowManualMerge(false);
        setManualMergeError("");
        setManualMergeLoading(false);
        setSourceQuery("");
        setMasterQuery("");
        setSourceResults([]);
        setMasterResults([]);
        setSelectedSource(null);
        setSelectedMaster(null);
        setMergeReason("manual_merge_from_picker");
        if (typeof window === "undefined") return;
        const params = new URLSearchParams(window.location.search);
        params.delete("manual");
        const query = params.toString();
        window.history.replaceState({}, "", query ? `/pms/guests/duplicates?${query}` : "/pms/guests/duplicates");
    }, []);

    const openManualMerge = useCallback(() => {
        setShowManualMerge(true);
        setManualMergeError("");
        if (typeof window === "undefined") return;
        const params = new URLSearchParams(window.location.search);
        params.set("manual", "1");
        window.history.replaceState({}, "", `/pms/guests/duplicates?${params.toString()}`);
    }, []);

    const searchProfiles = useCallback(async (value: string, target: "source" | "master") => {
        const trimmed = value.trim();
        if (target === "source") {
            setSelectedSource(null);
            if (trimmed.length < 3) {
                setSourceResults([]);
                setSourceLoading(false);
                return;
            }
            setSourceLoading(true);
        } else {
            setSelectedMaster(null);
            if (trimmed.length < 3) {
                setMasterResults([]);
                setMasterLoading(false);
                return;
            }
            setMasterLoading(true);
        }

        try {
            const res = await fetch(`/api/guests/match?t=${Date.now()}`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                cache: "no-store",
                body: JSON.stringify({ query: trimmed }),
            });
            const data = (await res.json()) as ManualSearchResponse;
            if (!res.ok || data.success === false) {
                throw new Error(data.error || "Search failed");
            }
            const items = (data.matches ?? [])
                .map((match) => match.profile)
                .filter((profile) => profile.profile_status !== "merged");
            if (target === "source") {
                setSourceResults(items);
            } else {
                setMasterResults(items);
            }
        } catch (err) {
            setManualMergeError(err instanceof Error ? err.message : "Search failed");
            if (target === "source") setSourceResults([]);
            if (target === "master") setMasterResults([]);
        } finally {
            if (target === "source") setSourceLoading(false);
            if (target === "master") setMasterLoading(false);
        }
    }, []);

    useEffect(() => {
        const timer = window.setTimeout(() => {
            void searchProfiles(sourceQuery, "source");
        }, 320);
        return () => window.clearTimeout(timer);
    }, [searchProfiles, sourceQuery]);

    useEffect(() => {
        const timer = window.setTimeout(() => {
            void searchProfiles(masterQuery, "master");
        }, 320);
        return () => window.clearTimeout(timer);
    }, [masterQuery, searchProfiles]);

    async function handleScan() {
        setScanning(true);
        try {
            const res = await fetch("/api/guests/duplicates", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({}),
            });
            const data = await res.json();
            if (!res.ok || !data?.success) {
                alert(data?.error ?? "Scan failed");
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
        if (!confirm("Merge into master? Source profile will be marked as merged.")) return;
        setActionLoading(pairId);
        try {
            const res = await fetch("/api/guests/merge", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ master_id: masterId, source_id: sourceId, reason: "manual_merge_from_queue" }),
            });
            const data = await res.json();
            if (data.success) {
                setPairs((prev) => prev.filter((pair) => pair.id !== pairId));
                setTotal((current) => Math.max(current - 1, 0));
            } else {
                alert(data.error ?? "Merge failed");
            }
        } catch {
            alert("Network error");
        } finally {
            setActionLoading(null);
        }
    }

    async function handleManualMerge() {
        if (!selectedSource || !selectedMaster) {
            setManualMergeError("Please select both source and master profiles.");
            return;
        }
        if (selectedSource.id === selectedMaster.id) {
            setManualMergeError("Source and master profiles must be different.");
            return;
        }

        setManualMergeLoading(true);
        setManualMergeError("");
        try {
            const res = await fetch("/api/guests/merge", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    master_id: selectedMaster.id,
                    source_id: selectedSource.id,
                    reason: mergeReason.trim() || "manual_merge_from_picker",
                }),
            });
            const data = await res.json();
            if (!res.ok || !data?.success) {
                throw new Error(data?.error || "Merge failed");
            }
            closeManualMerge();
            await load();
            alert(`Merged ${formatProfileName(selectedSource)} into ${formatProfileName(selectedMaster)}.`);
        } catch (err) {
            setManualMergeError(err instanceof Error ? err.message : "Merge failed");
        } finally {
            setManualMergeLoading(false);
        }
    }

    async function handleAction(pairId: string, action: "dismissed" | "do_not_merge") {
        setActionLoading(pairId);
        try {
            const res = await fetch("/api/guests/duplicates", {
                method: "PATCH",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ id: pairId, status: action }),
            });
            const data = await res.json();
            if (data.success) {
                setPairs((prev) => prev.filter((pair) => pair.id !== pairId));
                setTotal((current) => Math.max(current - 1, 0));
            } else {
                alert(data.error ?? "Action failed");
            }
        } catch {
            alert("Network error");
        } finally {
            setActionLoading(null);
        }
    }

    return (
        <div className="flex max-w-full flex-col gap-5">
            <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                    <p className="text-xs font-semibold uppercase tracking-widest text-brand-600">Guests</p>
                    <h1 className="mt-0.5 text-2xl font-bold text-[var(--text-primary)]">Duplicate Profiles</h1>
                    <p className="mt-0.5 text-sm text-[var(--text-muted)]">{total} suspect pairs</p>
                </div>
                <div className="flex w-full flex-wrap items-center gap-2 sm:w-auto sm:justify-end">
                    <button
                        type="button"
                        className="btn btn-secondary btn-sm dark:bg-slate-500/20 dark:text-slate-400 dark:border-slate-500/30"
                        onClick={openManualMerge}
                    >
                        Manual Merge
                    </button>
                    <select className="form-select py-1.5 text-sm" value={statusFilter} onChange={(event) => setStatusFilter(event.target.value)}>
                        <option value="pending">Pending</option>
                        <option value="merged">Merged</option>
                        <option value="dismissed">Dismissed</option>
                        <option value="do_not_merge">Do Not Merge</option>
                    </select>
                    <button
                        type="button"
                        className="btn btn-primary btn-sm dark:bg-brand-500/20 dark:text-brand-400 dark:border-brand-500/30"
                        onClick={() => void handleScan()}
                        disabled={scanning || loading}
                        title="Scan active profiles and queue duplicate pairs"
                    >
                        {scanning ? "Scanning..." : "Scan Duplicates"}
                    </button>
                    <button
                        type="button"
                        className="btn btn-secondary btn-sm dark:bg-slate-500/20 dark:text-slate-400 dark:border-slate-500/30"
                        onClick={() => void load()}
                    >
                        ↻ Refresh
                    </button>
                </div>
            </div>

            {error ? (
                <div className="rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700 dark:border-rose-800 dark:bg-rose-950/40 dark:text-rose-400">
                    {error}
                </div>
            ) : null}

            {loading ? (
                <div className="space-y-3">
                    {Array.from({ length: 5 }).map((_, index) => (
                        <div key={index} className="card animate-pulse p-4">
                            <div className="flex gap-4">
                                <div className="flex-1 space-y-2">
                                    <div className="h-4 w-32 rounded bg-[var(--bg-muted)]" />
                                    <div className="h-3 w-48 rounded bg-[var(--bg-muted)]" />
                                </div>
                                <div className="flex-1 space-y-2">
                                    <div className="h-4 w-32 rounded bg-[var(--bg-muted)]" />
                                    <div className="h-3 w-48 rounded bg-[var(--bg-muted)]" />
                                </div>
                            </div>
                        </div>
                    ))}
                </div>
            ) : pairs.length === 0 ? (
                <div className="card p-8 text-center">
                    <p className="mb-2 text-4xl">✅</p>
                    <p className="text-sm font-semibold text-[var(--text-secondary)]">No {statusFilter} duplicates</p>
                    {statusFilter === "pending" ? (
                        <div className="mt-4 flex items-center justify-center gap-2">
                            <button
                                type="button"
                                className="btn btn-primary btn-sm dark:bg-brand-500/20 dark:text-brand-400 dark:border-brand-500/30"
                                onClick={() => void handleScan()}
                                disabled={scanning || loading}
                            >
                                {scanning ? "Scanning..." : "Scan Duplicates Now"}
                            </button>
                            <button
                                type="button"
                                className="btn btn-secondary btn-sm dark:bg-slate-500/20 dark:text-slate-400 dark:border-slate-500/30"
                                onClick={openManualMerge}
                            >
                                Manual Merge
                            </button>
                        </div>
                    ) : null}
                </div>
            ) : (
                <div className="space-y-3">
                    {pairs.map((pair) => {
                        const isLoading = actionLoading === pair.id;
                        const scorePct = Math.min(pair.score, 100);
                        const scoreColor =
                            pair.score >= 70
                                ? "text-emerald-600 bg-emerald-50 dark:text-emerald-400 dark:bg-emerald-950/40"
                                : "text-amber-600 bg-amber-50 dark:text-amber-400 dark:bg-amber-950/40";

                        return (
                            <div key={pair.id} className="card p-4">
                                <div className="mb-3 flex items-center justify-between">
                                    <div className="flex items-center gap-2">
                                        <span className={`rounded px-2 py-0.5 text-sm font-bold ${scoreColor}`}>Score: {pair.score}</span>
                                        <div className="h-1.5 w-24 overflow-hidden rounded-full bg-[var(--bg-muted)]">
                                            <div
                                                className={`h-full rounded-full ${pair.score >= 70 ? "bg-emerald-500" : "bg-amber-400"}`}
                                                style={{ width: `${scorePct}%` }}
                                            />
                                        </div>
                                    </div>
                                    <div className="flex flex-wrap gap-1">
                                        {Object.entries(pair.match_fields).map(([key, value]) => (
                                            <span
                                                key={key}
                                                className="rounded bg-[var(--bg-surface-hover)] px-1.5 py-0.5 text-[9px] font-medium text-[var(--text-muted)]"
                                            >
                                                {key}: {String(value)}
                                            </span>
                                        ))}
                                    </div>
                                </div>

                                <div className="mb-3 grid grid-cols-2 gap-4">
                                    <ProfileCard profile={pair.profile_a_data} label="Profile A" />
                                    <ProfileCard profile={pair.profile_b_data} label="Profile B" />
                                </div>

                                {statusFilter === "pending" ? (
                                    <div className="flex items-center gap-2 border-t border-[var(--border-subtle)] pt-2">
                                        <button
                                            type="button"
                                            disabled={isLoading}
                                            onClick={() => void handleMerge(pair.profile_a, pair.profile_b, pair.id)}
                                            className="btn btn-sm bg-emerald-600 text-white hover:bg-emerald-700 disabled:opacity-50 dark:bg-emerald-500/20 dark:text-emerald-400 dark:border-emerald-500/30"
                                        >
                                            ← Merge into A
                                        </button>
                                        <button
                                            type="button"
                                            disabled={isLoading}
                                            onClick={() => void handleMerge(pair.profile_b, pair.profile_a, pair.id)}
                                            className="btn btn-sm bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-50 dark:bg-blue-500/20 dark:text-blue-400 dark:border-blue-500/30"
                                        >
                                            Merge into B →
                                        </button>
                                        <div className="flex-1" />
                                        <button
                                            type="button"
                                            disabled={isLoading}
                                            onClick={() => void handleAction(pair.id, "dismissed")}
                                            className="btn btn-sm btn-secondary dark:bg-slate-500/20 dark:text-slate-400 dark:border-slate-500/30 disabled:opacity-50"
                                        >
                                            Dismiss
                                        </button>
                                        <button
                                            type="button"
                                            disabled={isLoading}
                                            onClick={() => void handleAction(pair.id, "do_not_merge")}
                                            className="btn btn-sm border-rose-200 bg-rose-50 text-rose-600 hover:bg-rose-100 disabled:opacity-50 dark:border-rose-800 dark:bg-rose-950/40 dark:text-rose-400 dark:hover:bg-rose-950/60"
                                        >
                                            🚫 Do Not Merge
                                        </button>
                                    </div>
                                ) : null}
                            </div>
                        );
                    })}
                </div>
            )}

            {showManualMerge ? (
                <PmsModal
                    title="Manual Merge Profiles"
                    size="xl"
                    onClose={closeManualMerge}
                    footer={
                        <>
                            <button type="button" className="btn btn-secondary" onClick={closeManualMerge} disabled={manualMergeLoading}>
                                Cancel
                            </button>
                            <button
                                type="button"
                                className="btn btn-primary"
                                onClick={() => void handleManualMerge()}
                                disabled={manualMergeLoading || !selectedSource || !selectedMaster || selectedSource.id === selectedMaster.id}
                            >
                                {manualMergeLoading ? "Merging..." : "Merge Now"}
                            </button>
                        </>
                    }
                >
                    <div className="space-y-4">
                        <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800 dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-300">
                            Pick the duplicate profile on the left as <strong>Source</strong>, then pick the profile to keep on the right as <strong>Master</strong>.
                        </div>

                        {manualMergeError ? (
                            <div className="rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700 dark:border-rose-800 dark:bg-rose-950/40 dark:text-rose-300">
                                {manualMergeError}
                            </div>
                        ) : null}

                        <div className="grid gap-4 lg:grid-cols-2">
                            <ManualMergePicker
                                label="Source Profile (will be merged away)"
                                hint="Pick the duplicate or weaker record."
                                query={sourceQuery}
                                loading={sourceLoading}
                                results={sourceResults.filter((profile) => profile.id !== selectedMaster?.id)}
                                selected={selectedSource}
                                onQueryChange={setSourceQuery}
                                onSelect={setSelectedSource}
                            />
                            <ManualMergePicker
                                label="Master Profile (will be kept)"
                                hint="Pick the strongest profile to keep."
                                query={masterQuery}
                                loading={masterLoading}
                                results={masterResults.filter((profile) => profile.id !== selectedSource?.id)}
                                selected={selectedMaster}
                                onQueryChange={setMasterQuery}
                                onSelect={setSelectedMaster}
                            />
                        </div>

                        <div className="rounded-2xl border border-[var(--border-default)] bg-[var(--bg-surface)] p-4">
                            <label className="form-label">Merge Reason</label>
                            <input
                                className="form-input"
                                value={mergeReason}
                                onChange={(event) => setMergeReason(event.target.value)}
                                placeholder="manual_merge_from_picker"
                            />
                            <p className="mt-2 text-xs text-[var(--text-muted)]">This reason is written into the merge audit trail.</p>
                        </div>

                        <div className="rounded-2xl border border-[var(--border-default)] bg-[var(--bg-body)] p-4">
                            <p className="text-sm font-semibold text-[var(--text-primary)]">Quick Summary</p>
                            <div className="mt-3 grid gap-3 lg:grid-cols-2">
                                <div className="rounded-xl border border-[var(--border-default)] bg-[var(--bg-surface)] px-4 py-3 text-sm">
                                    <p className="text-xs uppercase tracking-wide text-[var(--text-muted)]">Source</p>
                                    <p className="mt-1 font-semibold text-[var(--text-primary)]">{formatProfileName(selectedSource)}</p>
                                    <p className="mt-1 text-xs text-[var(--text-secondary)]">
                                        {selectedSource
                                            ? `${selectedSource.stay_count} stays · ${selectedSource.phone || "No phone"} · ${selectedSource.email || "No email"}`
                                            : "Select a source profile"}
                                    </p>
                                </div>
                                <div className="rounded-xl border border-[var(--border-default)] bg-[var(--bg-surface)] px-4 py-3 text-sm">
                                    <p className="text-xs uppercase tracking-wide text-[var(--text-muted)]">Master</p>
                                    <p className="mt-1 font-semibold text-[var(--text-primary)]">{formatProfileName(selectedMaster)}</p>
                                    <p className="mt-1 text-xs text-[var(--text-secondary)]">
                                        {selectedMaster
                                            ? `${selectedMaster.stay_count} stays · ${selectedMaster.phone || "No phone"} · ${selectedMaster.email || "No email"}`
                                            : "Select a master profile"}
                                    </p>
                                </div>
                            </div>
                        </div>
                    </div>
                </PmsModal>
            ) : null}
        </div>
    );
}

function ProfileCard({ profile, label }: { profile: ProfileData | null; label: string }) {
    if (!profile) return <div className="rounded-lg bg-[var(--bg-body)] p-3 text-sm text-[var(--text-muted)]">Profile not found</div>;

    return (
        <div className="rounded-lg border border-[var(--border-default)] bg-[var(--bg-body)] p-3">
            <div className="mb-2 flex items-center justify-between">
                <span className="text-[10px] font-bold uppercase text-[var(--text-muted)]">{label}</span>
                {profile.profile_status ? (
                    <span
                        className={`rounded px-1.5 py-0.5 text-[10px] font-bold uppercase ${
                            profile.profile_status === "verified"
                                ? "bg-emerald-100 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-400"
                                : profile.profile_status === "merged"
                                    ? "bg-[var(--bg-muted)] text-[var(--text-secondary)]"
                                    : "bg-amber-100 text-amber-700 dark:bg-amber-950/40 dark:text-amber-400"
                        }`}
                    >
                        {profile.profile_status}
                    </span>
                ) : null}
            </div>
            <p className="text-sm font-bold text-[var(--text-primary)]">{formatProfileName(profile)}</p>
            <div className="mt-1.5 grid grid-cols-2 gap-x-3 gap-y-1 text-xs text-[var(--text-secondary)]">
                {profile.phone ? <span>📱 {profile.phone}</span> : null}
                {profile.email ? <span>✉️ {profile.email}</span> : null}
                {profile.nationality_code ? <span>🏳️ {profile.nationality_code}</span> : null}
                {profile.passport_no ? <span>🪪 {profile.passport_no}</span> : null}
                <span>🏨 {profile.stay_count} stays</span>
            </div>
        </div>
    );
}
