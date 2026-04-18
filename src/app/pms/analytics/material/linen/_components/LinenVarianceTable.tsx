"use client";

import type { VarianceBucket } from "@/lib/analytics/types";
import { VarianceBadge } from "../../../_components/VarianceBadge";

function number(value: number): string {
    return new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 }).format(Math.round(value));
}

function percent(value: number | null): string {
    if (value === null) return "—";
    return `${Math.round(value)}%`;
}

function varianceText(actual: number, baseline: number): string {
    if (baseline <= 0) return "—";
    const diff = actual - baseline;
    if (diff === 0) return "0";
    return `${diff > 0 ? "+" : ""}${number(diff)}`;
}

export function LinenVarianceTable({ buckets }: { buckets: VarianceBucket[] }) {
    if (buckets.length === 0) {
        return (
            <div className="a-card p-8 text-center">
                <div className="text-sm font-semibold">No linen activity in this period</div>
                <p className="a-secondary text-sm mt-2">
                    Try widening the date range or clearing category filters.
                </p>
            </div>
        );
    }

    return (
        <div className="a-card overflow-hidden">
            <div className="px-4 py-3 border-b border-[var(--a-border)] flex items-center justify-between gap-3">
                <div>
                    <h3 className="text-sm font-semibold tracking-wide">Variance by Linen Item</h3>
                    <p className="a-muted text-[11px] mt-1">Sorted by alert severity, then actual usage.</p>
                </div>
                <span className="a-muted a-mono text-[11px]">{buckets.length} buckets</span>
            </div>
            <div className="overflow-x-auto">
                <table className="w-full text-sm">
                    <thead>
                        <tr className="border-b border-[var(--a-border)] bg-[var(--a-bg-2)]/60">
                            <th className="text-left px-4 py-3 a-muted text-[11px] uppercase tracking-[0.14em]">Item</th>
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
                            <tr key={bucket.category} className="hover:bg-[var(--a-bg-2)]/45">
                                <td className="px-4 py-3">
                                    <div className="font-semibold">{bucket.label}</div>
                                    <div className="a-muted a-mono text-[11px] mt-0.5">{bucket.category}</div>
                                </td>
                                <td className="px-4 py-3 text-right a-mono">{number(bucket.actual)}</td>
                                <td className="px-4 py-3 text-right a-mono">{number(bucket.baselines.predict.value)}</td>
                                <td className="px-4 py-3 text-right">
                                    <div className="a-mono">{percent(bucket.pct_vs_predict)}</div>
                                    <div className="a-muted a-mono text-[11px]">
                                        {varianceText(bucket.actual, bucket.baselines.predict.value)}
                                    </div>
                                </td>
                                <td className="px-4 py-3 text-right a-mono">{number(bucket.baselines.max.value)}</td>
                                <td className="px-4 py-3 text-right">
                                    <div className="a-mono">{percent(bucket.pct_vs_max)}</div>
                                    <div className="a-muted a-mono text-[11px]">
                                        {varianceText(bucket.actual, bucket.baselines.max.value)}
                                    </div>
                                </td>
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
