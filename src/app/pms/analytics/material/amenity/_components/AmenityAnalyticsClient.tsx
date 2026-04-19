"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import { FilterBar } from "../../../_components/FilterBar";
import { TrendChart } from "../../../_components/TrendChart";
import { VarianceBadge } from "../../../_components/VarianceBadge";
import { worstTier } from "@/lib/analytics/variance";
import type {
    AmenityAnalyticsCategoryOption,
    AmenityAnalyticsResponse,
    AmenityAnalyticsSource,
    AmenityAnalyticsVarianceRow,
    AmenityReconciliationVarianceNote,
    AnalyticsWindow,
} from "@/lib/analytics/types";

const FALLBACK_CATEGORY_OPTIONS = [
    { value: "amenity.water_bottle", label: "Water" },
    { value: "amenity.coffee", label: "Coffee" },
    { value: "amenity.soap", label: "Soap" },
    { value: "amenity.shampoo", label: "Shampoo" },
];

function defaultStart() {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-01`;
}

function defaultEnd() {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

async function fetchJson<T>(url: string): Promise<T> {
    const response = await fetch(url);
    const text = await response.text();
    let body: { success?: boolean; data?: T; error?: string } | null = null;

    try {
        body = text ? JSON.parse(text) : null;
    } catch {
        body = null;
    }

    if (!response.ok || !body?.success) {
        throw new Error(body?.error ?? `Request failed (${response.status})`);
    }
    return body.data as T;
}

function compact(value: number): string {
    return new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 }).format(Math.round(value));
}

function pct(actual: number, baseline: number): number | null {
    if (baseline <= 0) return null;
    return Math.round((actual / baseline) * 100);
}

function percent(value: number | null): string {
    if (value === null) return "-";
    return `${Math.round(value)}%`;
}

function baselineValue(value: number | null | undefined): string {
    if (value === null || value === undefined) return "-";
    return compact(value);
}

export default function AmenityAnalyticsClient() {
    const params = useSearchParams();
    const [data, setData] = useState<AmenityAnalyticsResponse | null>(null);
    const [categories, setCategories] = useState(FALLBACK_CATEGORY_OPTIONS);
    const [error, setError] = useState<string | null>(null);
    const [isLoading, setIsLoading] = useState(true);

    const window = (params.get("window") as AnalyticsWindow) || "month";
    const start = params.get("start") || defaultStart();
    const end = params.get("end") || defaultEnd();
    const category = params.get("category") || "";
    const roomType = params.get("room_type") || "";
    const source = (params.get("source") as AmenityAnalyticsSource) || "all";

    const queryString = useMemo(() => {
        const qs = new URLSearchParams({ window, start, end });
        if (category) qs.set("category", category);
        if (roomType) qs.set("room_type", roomType);
        if (source !== "all") qs.set("source", source);
        return qs.toString();
    }, [category, end, roomType, source, start, window]);

    useEffect(() => {
        let cancelled = false;
        fetchJson<AmenityAnalyticsCategoryOption[]>("/api/analytics/material/amenity/categories")
            .then((rows) => {
                if (cancelled || rows.length === 0) return;
                setCategories(rows.map((row) => ({ value: row.category_key, label: row.label })));
            })
            .catch(() => {
                // Keep fallback labels if the RPC migration is not applied yet.
            });
        return () => {
            cancelled = true;
        };
    }, []);

    useEffect(() => {
        let cancelled = false;
        setIsLoading(true);
        setError(null);

        fetchJson<AmenityAnalyticsResponse>(`/api/analytics/material/amenity?${queryString}`)
            .then((nextData) => {
                if (cancelled) return;
                setData(nextData);
            })
            .catch((err) => {
                if (cancelled) return;
                setData(null);
                setError(err instanceof Error ? err.message : "Failed to load amenity analytics");
            })
            .finally(() => {
                if (!cancelled) setIsLoading(false);
            });

        return () => {
            cancelled = true;
        };
    }, [queryString]);

    const buckets = data?.buckets ?? [];
    const notes = data?.reconciliationNotes ?? [];

    return (
        <div className="max-w-[1400px] mx-auto p-6 space-y-5 pb-24">
            <header className="flex flex-col lg:flex-row lg:items-end lg:justify-between gap-4">
                <div>
                    <div className="a-muted text-[11px] uppercase tracking-[0.2em]">Phase 68.2b · live</div>
                    <h1 className="text-2xl font-semibold tracking-tight mt-1">Amenity Analytics</h1>
                    <p className="a-secondary text-sm mt-1">
                        FO reconciled water/coffee and audit-adjusted direct amenities against sold-room capacity.
                    </p>
                </div>
                <Link href="/pms/analytics/material" className="a-card px-3 py-2 text-xs a-secondary hover:text-[var(--a-text-0)]">
                    Back to Material
                </Link>
            </header>

            <FilterBar
                categoryOptions={categories}
                showCategory
                showRoomType
                showSource
            />

            <div className="a-card p-3 border-l-2 border-[var(--a-accent-cyan)]">
                <p className="a-secondary text-xs">
                    Max uses sold room nights from the previous stay date. When Room Type is filtered, Actual is allocated from daily totals using setup × occupancy weighting, not measured per room type.
                </p>
            </div>

            {error && (
                <div className="a-card p-4 border-l-2 border-[var(--a-accent-rose)] text-sm">
                    <div className="font-semibold">Unable to load Amenity Analytics</div>
                    <p className="a-secondary mt-1">{error}</p>
                    {/function|rpc|schema cache|does not exist/i.test(error) && (
                        <p className="a-muted text-[11px] mt-2">
                            Apply migrations 202604190001 and 202604190002 for Phase 68.2b.
                        </p>
                    )}
                </div>
            )}

            {isLoading ? (
                <LoadingState />
            ) : (
                <>
                    <AmenityKpiRow buckets={buckets} notes={notes} />
                    <TrendChart data={data?.trend ?? []} />
                    <AmenityVarianceTable buckets={buckets} />
                    {source !== "audit_adjusted" && <ReconciliationNotes notes={notes} />}
                </>
            )}
        </div>
    );
}

function AmenityKpiRow({
    buckets,
    notes,
}: {
    buckets: AmenityAnalyticsVarianceRow[];
    notes: AmenityReconciliationVarianceNote[];
}) {
    const totalActual = buckets.reduce((sum, b) => sum + b.actual, 0);
    const totalPredict = buckets.reduce((sum, b) => sum + (b.baselines.predict?.value ?? 0), 0);
    const totalMax = buckets.reduce((sum, b) => sum + (b.baselines.max?.value ?? 0), 0);
    const alerts = buckets.filter((b) => b.alert).length;
    const usagePct = pct(totalActual, totalMax);
    const tier = worstTier(buckets as any);

    const cards = [
        { label: "Total Actual", value: compact(totalActual), hint: "FO reconciled + audit adjusted", tier },
        { label: "Total Predict", value: compact(totalPredict), hint: "FO median only; direct amenities show N/A", tier: "na" as const },
        { label: "Total Max", value: baselineValue(totalMax || null), hint: usagePct === null ? "Setup required" : `${usagePct}% of max`, tier: "na" as const },
        { label: "Recon Notes", value: compact(notes.length), hint: "FO vs maid-tap discrepancies", tier: notes.length > 0 ? "yellow" as const : "green" as const },
        { label: "Alerts", value: compact(alerts), hint: "Buckets outside threshold", tier: alerts > 0 ? "red" as const : "green" as const },
    ];

    return (
        <div className="grid grid-cols-2 lg:grid-cols-5 gap-3">
            {cards.map((card) => (
                <div key={card.label} className="a-card p-4">
                    <div className="flex items-center justify-between gap-2">
                        <span className="a-secondary text-xs uppercase tracking-[0.15em]">{card.label}</span>
                        <VarianceBadge tier={card.tier} />
                    </div>
                    <div className="a-mono text-3xl font-semibold mt-3">{card.value}</div>
                    <div className="a-muted text-[11px] mt-1">{card.hint}</div>
                </div>
            ))}
        </div>
    );
}

function AmenityVarianceTable({ buckets }: { buckets: AmenityAnalyticsVarianceRow[] }) {
    if (buckets.length === 0) {
        return (
            <div className="a-card p-8 text-center">
                <div className="text-sm font-semibold">No amenity activity in this period</div>
                <p className="a-secondary text-sm mt-2">Try widening the date range or clearing filters.</p>
            </div>
        );
    }

    return (
        <div className="a-card overflow-hidden">
            <div className="px-4 py-3 border-b border-[var(--a-border)] flex items-center justify-between gap-3">
                <div>
                    <h3 className="text-sm font-semibold tracking-wide">Variance by Amenity Item</h3>
                    <p className="a-muted text-[11px] mt-1">
                        Source-tagged rows stay separate so FO reconciled and audit-adjusted flows are not mixed.
                    </p>
                </div>
                <span className="a-muted a-mono text-[11px]">{buckets.length} buckets</span>
            </div>
            <div className="overflow-x-auto">
                <table className="w-full text-sm">
                    <thead>
                        <tr className="border-b border-[var(--a-border)] bg-[var(--a-bg-2)]/60">
                            <th className="text-left px-4 py-3 a-muted text-[11px] uppercase tracking-[0.14em]">Item</th>
                            <th className="text-left px-4 py-3 a-muted text-[11px] uppercase tracking-[0.14em]">Source</th>
                            <th className="text-right px-4 py-3 a-muted text-[11px] uppercase tracking-[0.14em]">Actual</th>
                            <th className="text-right px-4 py-3 a-muted text-[11px] uppercase tracking-[0.14em]">Predict</th>
                            <th className="text-right px-4 py-3 a-muted text-[11px] uppercase tracking-[0.14em]">vs Predict</th>
                            <th className="text-right px-4 py-3 a-muted text-[11px] uppercase tracking-[0.14em]">Max</th>
                            <th className="text-right px-4 py-3 a-muted text-[11px] uppercase tracking-[0.14em]">vs Max</th>
                            <th className="text-right px-4 py-3 a-muted text-[11px] uppercase tracking-[0.14em]">Tier</th>
                        </tr>
                    </thead>
                    <tbody className="divide-y divide-[var(--a-border)]">
                        {buckets.map((bucket) => (
                            <tr key={`${bucket.category}:${bucket.source}`} className="hover:bg-[var(--a-bg-2)]/45">
                                <td className="px-4 py-3">
                                    <div className="font-semibold">{bucket.label}</div>
                                    <div className="a-muted a-mono text-[11px] mt-0.5">{bucket.category}</div>
                                </td>
                                <td className="px-4 py-3">
                                    <span className="a-badge a-badge-na">{bucket.source === "fo_reconciled" ? "FO Reconciled" : "Audit Adjusted"}</span>
                                    {bucket.actual_source === "allocated" && (
                                        <div className="a-muted text-[11px] mt-1">Allocated Actual</div>
                                    )}
                                </td>
                                <td className="px-4 py-3 text-right a-mono">{compact(bucket.actual)}</td>
                                <td className="px-4 py-3 text-right a-mono">{baselineValue(bucket.baselines.predict?.value)}</td>
                                <td className="px-4 py-3 text-right a-mono">{percent(bucket.pct_vs_predict)}</td>
                                <td className="px-4 py-3 text-right a-mono">{baselineValue(bucket.baselines.max?.value)}</td>
                                <td className="px-4 py-3 text-right a-mono">{percent(bucket.pct_vs_max)}</td>
                                <td className="px-4 py-3 text-right">
                                    <VarianceBadge tier={bucket.tier} />
                                </td>
                            </tr>
                        ))}
                    </tbody>
                </table>
            </div>
        </div>
    );
}

function ReconciliationNotes({ notes }: { notes: AmenityReconciliationVarianceNote[] }) {
    const [expanded, setExpanded] = useState(false);
    if (notes.length === 0) return null;

    const visible = expanded ? notes : notes.slice(0, 10);
    return (
        <div className="a-card overflow-hidden">
            <div className="px-4 py-3 border-b border-[var(--a-border)] flex items-center justify-between gap-3">
                <div>
                    <h3 className="text-sm font-semibold tracking-wide">Reconciliation Variance Notes</h3>
                    <p className="a-muted text-[11px] mt-1">FO reconciled quantity compared with maid-app tap totals.</p>
                </div>
                {notes.length > 10 && (
                    <button onClick={() => setExpanded((v) => !v)} className="a-secondary text-xs underline">
                        {expanded ? "Show less" : `Show all ${notes.length}`}
                    </button>
                )}
            </div>
            <div className="overflow-x-auto">
                <table className="w-full text-sm">
                    <thead>
                        <tr className="border-b border-[var(--a-border)] bg-[var(--a-bg-2)]/60">
                            <th className="text-left px-4 py-3 a-muted text-[11px] uppercase tracking-[0.14em]">Date</th>
                            <th className="text-left px-4 py-3 a-muted text-[11px] uppercase tracking-[0.14em]">Product</th>
                            <th className="text-right px-4 py-3 a-muted text-[11px] uppercase tracking-[0.14em]">Reconciled</th>
                            <th className="text-right px-4 py-3 a-muted text-[11px] uppercase tracking-[0.14em]">Maid Tap</th>
                            <th className="text-right px-4 py-3 a-muted text-[11px] uppercase tracking-[0.14em]">Delta</th>
                            <th className="text-left px-4 py-3 a-muted text-[11px] uppercase tracking-[0.14em]">FO Note</th>
                        </tr>
                    </thead>
                    <tbody className="divide-y divide-[var(--a-border)]">
                        {visible.map((note) => (
                            <tr key={`${note.batch_id}:${note.product_id}`}>
                                <td className="px-4 py-3 a-mono">{note.business_date}</td>
                                <td className="px-4 py-3">{note.label}</td>
                                <td className="px-4 py-3 text-right a-mono">{compact(note.reconciled_consumed)}</td>
                                <td className="px-4 py-3 text-right a-mono">{compact(note.maid_tap_total)}</td>
                                <td className="px-4 py-3 text-right a-mono">{note.delta > 0 ? "+" : ""}{compact(note.delta)}</td>
                                <td className="px-4 py-3 a-secondary max-w-md">{note.fo_return_note || "-"}</td>
                            </tr>
                        ))}
                    </tbody>
                </table>
            </div>
        </div>
    );
}

function LoadingState() {
    return (
        <div className="space-y-3">
            <div className="grid grid-cols-2 lg:grid-cols-5 gap-3">
                {Array.from({ length: 5 }).map((_, idx) => (
                    <div key={idx} className="a-card h-28 animate-pulse bg-[var(--a-bg-2)]/40" />
                ))}
            </div>
            <div className="a-card h-72 animate-pulse bg-[var(--a-bg-2)]/40" />
            <div className="a-card h-80 animate-pulse bg-[var(--a-bg-2)]/40" />
        </div>
    );
}
