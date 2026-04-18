"use client";

import type { AnalyticsMetric } from "@/lib/analytics/types";
import { worstTier } from "@/lib/analytics/variance";
import { VarianceBadge } from "../../../_components/VarianceBadge";

function compact(value: number): string {
    return new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 }).format(Math.round(value));
}

function pct(actual: number, baseline: number): number | null {
    if (baseline <= 0) return null;
    return Math.round((actual / baseline) * 100);
}

export function LinenKpiRow({ metric }: { metric: AnalyticsMetric | null }) {
    const buckets = metric?.buckets ?? [];
    const totalActual = buckets.reduce((sum, b) => sum + b.actual, 0);
    const totalPredict = buckets.reduce((sum, b) => sum + b.baselines.predict.value, 0);
    const totalMax = buckets.reduce((sum, b) => sum + b.baselines.max.value, 0);
    const alerts = buckets.filter((b) => b.alert).length;
    const usagePct = pct(totalActual, totalMax);
    const tier = worstTier(buckets);

    const cards = [
        { label: "Total Actual", value: compact(totalActual), hint: "Sent by hotel", tier },
        { label: "Total Predict", value: compact(totalPredict), hint: "Expected linen engine", tier: "na" as const },
        { label: "Total Max", value: compact(totalMax), hint: usagePct === null ? "No max baseline" : `${usagePct}% of max`, tier: "na" as const },
        { label: "Alerts", value: compact(alerts), hint: "Buckets outside threshold", tier: alerts > 0 ? "red" as const : "green" as const },
    ];

    return (
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
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
