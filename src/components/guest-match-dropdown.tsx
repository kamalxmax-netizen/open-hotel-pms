"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { getFlagEmojiByNationalityCode } from "@/lib/nationality-map";

/* ─── Types ─────────────────────────────────────────── */
export interface MatchResult {
    profile: {
        id: string;
        first_name: string | null;
        last_name: string | null;
        phone: string | null;
        email: string | null;
        nationality_code: string | null;
        stay_count: number;
        vip_tier: string | null;
    };
    score: number;
}

interface GuestMatchDropdownProps {
    /** Current value of guest name input */
    guestName: string;
    /** Called when user selects an existing profile */
    onSelect: (match: MatchResult) => void;
    /** Called when user clicks "+ Create New Profile" */
    onCreate: () => void;
    /** Called when match results arrive (for Return Guest badge) */
    onMatchResults?: (matches: MatchResult[]) => void;
    /** Additional CSS class on the dropdown container */
    className?: string;
}

const DEBOUNCE_MS = 350;
const MIN_CHARS = 2;

export default function GuestMatchDropdown({
    guestName,
    onSelect,
    onCreate,
    onMatchResults,
    className = "",
}: GuestMatchDropdownProps) {
    const [matches, setMatches] = useState<MatchResult[]>([]);
    const [loading, setLoading] = useState(false);
    const [open, setOpen] = useState(false);
    const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    const wrapperRef = useRef<HTMLDivElement>(null);

    // Close on outside click
    useEffect(() => {
        function handleClick(e: MouseEvent) {
            if (wrapperRef.current && !wrapperRef.current.contains(e.target as Node)) {
                setOpen(false);
            }
        }
        document.addEventListener("mousedown", handleClick);
        return () => document.removeEventListener("mousedown", handleClick);
    }, []);

    const search = useCallback(async (query: string) => {
        if (query.trim().length < MIN_CHARS) {
            setMatches([]);
            setOpen(false);
            return;
        }
        setLoading(true);
        try {
            const res = await fetch("/api/guests/match", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ query: query.trim() }),
            });
            const data = await res.json();
            const results: MatchResult[] = data.matches ?? [];
            setMatches(results);
            setOpen(true);
            onMatchResults?.(results);
        } catch {
            setMatches([]);
        } finally {
            setLoading(false);
        }
    }, [onMatchResults]);

    // Debounced search on guestName change
    useEffect(() => {
        if (timerRef.current) clearTimeout(timerRef.current);
        if (guestName.trim().length < MIN_CHARS) {
            setMatches([]);
            setOpen(false);
            return;
        }
        timerRef.current = setTimeout(() => search(guestName), DEBOUNCE_MS);
        return () => { if (timerRef.current) clearTimeout(timerRef.current); };
    }, [guestName, search]);

    if (!open) return null;

    const strong = matches.filter((m) => m.score >= 70);
    const possible = matches.filter((m) => m.score >= 30 && m.score < 70);
    const lowConfidence = matches.filter((m) => m.score < 30);

    return (
        <div
            ref={wrapperRef}
            className={`absolute z-50 mt-2 w-full max-h-80 overflow-y-auto rounded-2xl border border-[var(--border-default)] bg-[var(--bg-surface)]/95 shadow-xl backdrop-blur-sm ${className}`}
        >
            {loading && (
                <div className="flex items-center gap-2 px-4 py-3 text-[11px] text-[var(--text-muted)]">
                    <svg className="w-4 h-4 animate-spin" viewBox="0 0 24 24" fill="none">
                        <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3" />
                        <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                    </svg>
                    Searching...
                </div>
            )}

            {!loading && matches.length === 0 && (
                <div className="px-4 py-3">
                    <p className="mb-2 text-[11px] text-[var(--text-muted)]">No matching profiles found</p>
                    <button
                        type="button"
                        onClick={() => { setOpen(false); onCreate(); }}
                        className="w-full rounded-xl bg-brand-50 dark:bg-indigo-500/20 px-4 py-2.5 text-[13px] font-semibold text-brand-600 dark:text-indigo-300 transition hover:bg-brand-100 dark:hover:bg-indigo-500/30"
                    >
                        + Create New Profile
                    </button>
                </div>
            )}

            {!loading && matches.length > 0 && (
                <>
                    {/* Strong matches */}
                    {strong.length > 0 && (
                        <div className="border-b border-[var(--border-subtle)] px-4 py-2.5">
                            <p className="text-[11px] font-bold uppercase tracking-wide text-emerald-600">
                                Strong Match ({strong.length})
                            </p>
                        </div>
                    )}
                    {strong.map((m) => (
                        <MatchRow key={m.profile.id} match={m} onSelect={() => { setOpen(false); onSelect(m); }} />
                    ))}

                    {/* Possible matches */}
                    {possible.length > 0 && (
                        <div className="border-b border-t border-[var(--border-subtle)] px-4 py-2.5">
                            <p className="text-[11px] font-bold uppercase tracking-wide text-amber-600">
                                Possible Match ({possible.length})
                            </p>
                        </div>
                    )}
                    {possible.map((m) => (
                        <MatchRow key={m.profile.id} match={m} onSelect={() => { setOpen(false); onSelect(m); }} />
                    ))}

                    {/* Low confidence matches (still useful for partial name typing) */}
                    {lowConfidence.length > 0 && (
                        <div className="border-b border-t border-[var(--border-subtle)] px-4 py-2.5">
                            <p className="text-[11px] font-bold uppercase tracking-wide text-[var(--text-muted)]">
                                Name Match ({lowConfidence.length})
                            </p>
                        </div>
                    )}
                    {lowConfidence.map((m) => (
                        <MatchRow key={m.profile.id} match={m} onSelect={() => { setOpen(false); onSelect(m); }} />
                    ))}

                    {/* Create new */}
                    <div className="border-t border-[var(--border-subtle)] px-4 py-3">
                        <button
                            type="button"
                            onClick={() => { setOpen(false); onCreate(); }}
                            className="w-full rounded-xl bg-brand-50 dark:bg-indigo-500/20 px-4 py-2.5 text-[13px] font-semibold text-brand-600 dark:text-indigo-300 transition hover:bg-brand-100 dark:hover:bg-indigo-500/30"
                        >
                            + Create New Profile
                        </button>
                    </div>
                </>
            )}
        </div>
    );
}

/* ─── Match Row ──────────────────────────────────────── */
function MatchRow({ match, onSelect }: { match: MatchResult; onSelect: () => void }) {
    const p = match.profile;
    const name = [p.first_name, p.last_name].filter(Boolean).join(" ");
    const badgeColor =
        match.score >= 70
            ? "bg-emerald-500"
            : match.score >= 30
                ? "bg-amber-500"
                : "bg-[var(--text-muted)]";

    return (
        <button
            type="button"
            onClick={onSelect}
            className="group flex w-full items-center gap-3 px-4 py-3 text-left transition hover:bg-[var(--bg-body)]/80"
        >
            {/* Avatar circle */}
            <div className={`flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-full text-sm font-bold text-white ${badgeColor}`}>
                {(p.last_name?.[0] ?? "?").toUpperCase()}
            </div>

            {/* Info */}
            <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                    <span className="truncate text-[15px] font-semibold text-[var(--text-primary)]">{name || "—"}</span>
                    {p.stay_count > 0 && (
                        <span className="flex-shrink-0 rounded-lg bg-blue-100 dark:bg-blue-500/20 px-2 py-0.5 text-[10px] font-bold text-blue-700 dark:text-blue-300">
                            Return · {p.stay_count} stays
                        </span>
                    )}
                    {p.vip_tier && p.vip_tier !== "regular" && (
                        <span className="flex-shrink-0 rounded-lg bg-violet-100 dark:bg-violet-500/20 px-2 py-0.5 text-[10px] font-bold uppercase text-violet-700 dark:text-violet-300">
                            {p.vip_tier}
                        </span>
                    )}
                </div>
                <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-[var(--text-muted)]">
                    {p.phone && <span>📱 {p.phone}</span>}
                    {p.nationality_code && <span>{getFlagEmojiByNationalityCode(p.nationality_code)} {p.nationality_code}</span>}
                    <span className="text-[var(--text-muted)]">Score: {match.score}</span>
                </div>
            </div>

            {/* Link icon */}
            <span className="flex-shrink-0 text-sm text-[var(--text-muted)] transition group-hover:text-brand-500">🔗</span>
        </button>
    );
}
