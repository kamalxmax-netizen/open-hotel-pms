import type { AnalyticsSummaryKpi } from "@/lib/analytics/types";
import { VarianceBadge } from "./VarianceBadge";

export function HeroKpiGrid({ kpis }: { kpis: AnalyticsSummaryKpi[] }) {
    return (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            {kpis.map((kpi) => (
                <div key={kpi.label} className="a-card p-4 flex flex-col gap-3">
                    <div className="flex items-center justify-between">
                        <span className="a-secondary text-xs uppercase tracking-[0.15em]">{kpi.label}</span>
                        <VarianceBadge tier={kpi.tier} />
                    </div>
                    <div className="flex items-baseline gap-1">
                        <span className="a-mono text-3xl font-semibold">{kpi.value}</span>
                        {kpi.unit && <span className="a-muted text-sm">{kpi.unit}</span>}
                    </div>
                    <div className="a-muted text-[11px]">
                        {kpi.delta_pct === null ? "No prior period" : `${kpi.delta_pct > 0 ? "+" : ""}${kpi.delta_pct}% vs last`}
                    </div>
                </div>
            ))}
        </div>
    );
}
