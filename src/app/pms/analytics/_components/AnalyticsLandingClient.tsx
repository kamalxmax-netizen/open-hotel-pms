"use client";

import { useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import { FilterBar } from "./FilterBar";
import { HeroKpiGrid } from "./HeroKpiGrid";
import { SectionCard } from "./SectionCard";
import { TrendChart } from "./TrendChart";
import type { AnalyticsSummary, AnalyticsWindow } from "@/lib/analytics/types";

function defaultStart() {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-01`;
}
function defaultEnd() {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

export default function AnalyticsLandingClient() {
    const params = useSearchParams();
    const [summary, setSummary] = useState<AnalyticsSummary | null>(null);
    const [error, setError] = useState<string | null>(null);

    const window = (params.get("window") as AnalyticsWindow) || "month";
    const start = params.get("start") || defaultStart();
    const end = params.get("end") || defaultEnd();

    useEffect(() => {
        let cancelled = false;
        setError(null);
        const qs = new URLSearchParams({ window, start, end });
        fetch(`/api/analytics/summary?${qs.toString()}`)
            .then((r) => r.json())
            .then((body) => {
                if (cancelled) return;
                if (body?.success) {
                    setSummary(body.data);
                } else {
                    setSummary(null);
                    setError(body?.error ?? "Failed to load summary");
                }
            })
            .catch((err) => {
                if (cancelled) return;
                setSummary(null);
                setError(err instanceof Error ? err.message : "Network error");
            });
        return () => {
            cancelled = true;
        };
    }, [window, start, end]);

    return (
        <div className="max-w-[1400px] mx-auto p-6 space-y-5 pb-24">
            <header className="flex items-end justify-between gap-4">
                <div>
                    <h1 className="text-2xl font-semibold tracking-tight">Data Analysis</h1>
                    <p className="a-secondary text-sm mt-1">
                        Variance-driven analytics across materials, rooms, and budget.
                    </p>
                </div>
                <div className="a-muted text-xs a-mono">Phase 68.1 · Linen live</div>
            </header>

            <FilterBar />

            {error && (
                <div className="a-card p-4 border-l-2 border-[var(--a-accent-rose)] a-secondary text-sm">
                    {error}
                </div>
            )}

            <HeroKpiGrid kpis={summary?.kpis ?? []} />

            {summary && <TrendChart data={summary.trend} />}

            <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                <SectionCard
                    href="/pms/analytics/material"
                    title="Material"
                    subtitle="Linen and Amenity variance. Usage vs Predict and Max."
                    phase="Phase 68"
                    enabled
                />
                <SectionCard
                    href="/pms/analytics/room"
                    title="Room"
                    subtitle="Occupancy, RevPAR, ADR. Coming in Phase 69."
                    phase="Phase 69"
                    enabled={false}
                />
                <SectionCard
                    href="/pms/analytics/budget"
                    title="Budget"
                    subtitle="Electricity, water, and revenue baselines. Coming in Phase 70."
                    phase="Phase 70"
                    enabled={false}
                />
            </div>
        </div>
    );
}
