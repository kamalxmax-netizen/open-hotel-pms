// Phase 68.0 — Analytics type contracts
// D15: 'week' = ISO week (Mon–Sun)
export type AnalyticsWindow = "day" | "week" | "month";

export type BaselineSource = "predict" | "statistical" | "max";

export interface AnalyticsBaseline {
    source: BaselineSource;
    value: number;
    computed_from?: { start_date: string; end_date: string; sample_size: number };
}

// D10: 'na' when baseline <= 0 or missing
export type VarianceTier = "green" | "yellow" | "red" | "na";

export interface VarianceBucket {
    category: string;
    label: string;
    actual: number;
    actual_source?: "direct" | "allocated";
    baselines: {
        predict: AnalyticsBaseline;
        statistical: AnalyticsBaseline | null;
        max: AnalyticsBaseline;
    };
    pct_vs_predict: number | null;
    pct_vs_statistical: number | null;
    pct_vs_max: number | null;
    tier: VarianceTier;
    alert: boolean;
}

export interface AnalyticsMetric {
    window: AnalyticsWindow;
    period_start: string;
    period_end: string;
    buckets: VarianceBucket[];
}

export interface AnalyticsSummaryKpi {
    label: string;
    value: number;
    unit: string;
    tier: VarianceTier;
    delta_pct: number | null;
}

export interface AnalyticsSummary {
    window: AnalyticsWindow;
    period_start: string;
    period_end: string;
    kpis: AnalyticsSummaryKpi[];
    trend: AnalyticsTrendPoint[];
}

export interface AnalyticsTrendPoint {
    period: string;
    actual: number;
    predict: number;
    max: number;
    statistical?: number | null;
}

export interface AnalyticsQuery {
    window: AnalyticsWindow;
    start: string;
    end: string;
    category?: string[];
    room_type?: string[];
}
