// Phase 68.0: deterministic mocks only. Replaced by live SQL in 68.1+.
import type {
    AnalyticsMetric,
    AnalyticsQuery,
    AnalyticsSummary,
    AnalyticsTrendPoint,
    VarianceBucket,
} from "./types";
import { computeBucket } from "./variance";
import { emptyBaseline, maxBaseline, predictBaseline } from "./baseline";
import { enumeratePeriods, formatISODate } from "./window";

type MockSpec = {
    category: string;
    label: string;
    actual: number;
    predict: number;
    units_per_room: number;
};

const LINEN_SPECS: MockSpec[] = [
    { category: "linen.bath_towel", label: "Bath Towel", actual: 180, predict: 220, units_per_room: 2 },
    { category: "linen.bath_mat", label: "Bath Mat", actual: 92, predict: 110, units_per_room: 1 },
    { category: "linen.pillowcase", label: "Pillowcase", actual: 240, predict: 220, units_per_room: 2 },
    { category: "linen.bed_sheet", label: "Bed Sheet", actual: 115, predict: 110, units_per_room: 1 },
];

const AMENITY_SPECS: MockSpec[] = [
    { category: "amenity.coffee", label: "Coffee", actual: 320, predict: 280, units_per_room: 2 },
    { category: "amenity.water", label: "Drinking Water", actual: 410, predict: 340, units_per_room: 2 },
    { category: "amenity.soap", label: "Soap", actual: 88, predict: 110, units_per_room: 1 },
    { category: "amenity.shampoo", label: "Shampoo", actual: 95, predict: 110, units_per_room: 1 },
];

const ACTIVE_ROOMS = 31;

function buildBuckets(specs: MockSpec[], daysInPeriod: number): VarianceBucket[] {
    return specs.map((s) =>
        computeBucket({
            category: s.category,
            label: s.label,
            actual: s.actual,
            baselines: {
                predict: predictBaseline(s.predict),
                statistical: null,
                max: maxBaseline({
                    units_per_room: s.units_per_room,
                    active_rooms: ACTIVE_ROOMS,
                    days_in_period: daysInPeriod,
                }),
            },
        })
    );
}

function daysBetween(start: string, end: string): number {
    const s = new Date(start);
    const e = new Date(end);
    return Math.max(1, Math.round((e.getTime() - s.getTime()) / 86400000) + 1);
}

export function mockLinenMetric(q: AnalyticsQuery): AnalyticsMetric {
    return {
        window: q.window,
        period_start: q.start,
        period_end: q.end,
        buckets: buildBuckets(LINEN_SPECS, daysBetween(q.start, q.end)),
    };
}

export function mockAmenityMetric(q: AnalyticsQuery): AnalyticsMetric {
    return {
        window: q.window,
        period_start: q.start,
        period_end: q.end,
        buckets: buildBuckets(AMENITY_SPECS, daysBetween(q.start, q.end)),
    };
}

function buildTrend(q: AnalyticsQuery): AnalyticsTrendPoint[] {
    const periods = enumeratePeriods(new Date(q.start), new Date(q.end), q.window);
    return periods.map((date, idx) => {
        const wave = Math.sin(idx / 2) * 40;
        return {
            period: formatISODate(date),
            actual: 220 + wave + (idx % 3) * 12,
            predict: 240,
            max: 340,
            statistical: null,
        };
    });
}

export function mockSummary(q: AnalyticsQuery): AnalyticsSummary {
    const linen = mockLinenMetric(q);
    const amenity = mockAmenityMetric(q);
    const linenActual = linen.buckets.reduce((s, b) => s + b.actual, 0);
    const linenMax = linen.buckets.reduce((s, b) => s + b.baselines.max.value, 0);
    const amenActual = amenity.buckets.reduce((s, b) => s + b.actual, 0);
    const amenMax = amenity.buckets.reduce((s, b) => s + b.baselines.max.value, 0);
    const alerts = [...linen.buckets, ...amenity.buckets].filter((b) => b.alert).length;

    return {
        window: q.window,
        period_start: q.start,
        period_end: q.end,
        kpis: [
            {
                label: "Linen Usage",
                value: linenMax > 0 ? Math.round((linenActual / linenMax) * 100) : 0,
                unit: "%",
                tier: "green",
                delta_pct: null,
            },
            {
                label: "Amenity Usage",
                value: amenMax > 0 ? Math.round((amenActual / amenMax) * 100) : 0,
                unit: "%",
                tier: "yellow",
                delta_pct: null,
            },
            {
                label: "Alerts",
                value: alerts,
                unit: "",
                tier: alerts > 0 ? "red" : "green",
                delta_pct: null,
            },
            {
                label: "Coverage",
                value: daysBetween(q.start, q.end),
                unit: "days",
                tier: "na",
                delta_pct: null,
            },
        ],
        trend: buildTrend(q),
    };
}

// Placeholder to reassure tree-shaking that emptyBaseline stays referenced in types.
export const _unused = emptyBaseline;
