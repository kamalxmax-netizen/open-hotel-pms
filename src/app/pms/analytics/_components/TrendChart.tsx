"use client";

import {
    CartesianGrid,
    Legend,
    Line,
    LineChart,
    ResponsiveContainer,
    Tooltip,
    XAxis,
    YAxis,
} from "recharts";
import type { AnalyticsTrendPoint } from "@/lib/analytics/types";
import { RECHARTS_THEME, RECHARTS_TOOLTIP_STYLE } from "../_design/recharts-theme";

export function TrendChart({ data }: { data: AnalyticsTrendPoint[] }) {
    return (
        <div className="a-card p-4">
            <div className="flex items-center justify-between mb-4">
                <h3 className="text-sm font-semibold tracking-wide">Usage Trend</h3>
                <span className="a-muted text-[11px] uppercase tracking-[0.15em]">Actual vs Predict vs Max</span>
            </div>
            <div style={{ width: "100%", height: 260 }}>
                <ResponsiveContainer>
                    <LineChart data={data} margin={{ top: 8, right: 16, left: 0, bottom: 0 }}>
                        <CartesianGrid stroke={RECHARTS_THEME.grid} strokeDasharray="3 3" />
                        <XAxis dataKey="period" stroke={RECHARTS_THEME.axis} fontSize={11} />
                        <YAxis stroke={RECHARTS_THEME.axis} fontSize={11} />
                        <Tooltip contentStyle={RECHARTS_TOOLTIP_STYLE} cursor={{ stroke: RECHARTS_THEME.grid }} />
                        <Legend wrapperStyle={{ fontSize: 11, color: RECHARTS_THEME.axis }} />
                        <Line type="monotone" dataKey="actual" stroke={RECHARTS_THEME.series.actual} strokeWidth={2} dot={false} />
                        <Line type="monotone" dataKey="predict" stroke={RECHARTS_THEME.series.predict} strokeWidth={1.5} strokeDasharray="4 4" dot={false} />
                        <Line type="monotone" dataKey="max" stroke={RECHARTS_THEME.series.max} strokeWidth={1.5} strokeDasharray="4 4" dot={false} />
                    </LineChart>
                </ResponsiveContainer>
            </div>
        </div>
    );
}
