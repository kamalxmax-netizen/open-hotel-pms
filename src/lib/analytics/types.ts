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
    predict: number | null;
    max: number | null;
    statistical?: number | null;
    source?: AmenityAnalyticsSource;
}

export interface AnalyticsQuery {
    window: AnalyticsWindow;
    start: string;
    end: string;
    category?: string[];
    room_type?: string[];
    source?: AmenityAnalyticsSource;
}

// ─── Phase 68.2b: Amenity Analytics ───────────────────────────────────────────
// D34: three values; 'all' = UNION of both flows tagged by source
export type AmenityAnalyticsSource = "fo_reconciled" | "audit_adjusted" | "all";

// Row emitted per product × source. When query.source='all' a product with
// data on both flows yields two rows (one per source).
export interface AmenityAnalyticsVarianceRow {
    category: string;
    label: string;
    source: Exclude<AmenityAnalyticsSource, "all">;
    actual: number;
    actual_source: "direct" | "allocated";
    baselines: {
        predict: AnalyticsBaseline | null;
        statistical: AnalyticsBaseline | null;
        max: AnalyticsBaseline | null;
    };
    pct_vs_predict: number | null;
    pct_vs_statistical: number | null;
    pct_vs_max: number | null;
    tier: VarianceTier;
    alert: boolean;
}

export interface AmenityAnalyticsTrendPoint {
    period: string;
    actual: number;
    predict: number | null;
    max: number | null;
    statistical: number | null;
    source: AmenityAnalyticsSource;
}

export interface AmenityAnalyticsCategoryOption {
    category_key: string;
    label: string;
    source_hint: Exclude<AmenityAnalyticsSource, "all">;
}

// D42: dedicated reconciliation-variance surface. Only populated when
// query.source ∈ {fo_reconciled, all}; empty otherwise.
export interface AmenityReconciliationVarianceNote {
    business_date: string;
    product_id: string;
    category: string;
    label: string;
    reconciled_consumed: number;
    maid_tap_total: number;
    delta: number;
    fo_return_note: string | null;
    recorded_at: string;
    recorded_by: string | null;
    batch_id: string;
}

export interface AmenityAnalyticsResponse {
    window: AnalyticsWindow;
    period_start: string;
    period_end: string;
    buckets: AmenityAnalyticsVarianceRow[];
    trend: AmenityAnalyticsTrendPoint[];
    reconciliationNotes: AmenityReconciliationVarianceNote[];
}

// D43: setup table row; room_type_id is bigint → number in TS
// (Agent B P0-1 fix: aligned with room_types.id bigserial)
export interface RoomTypeAmenitySetup {
    room_type_id: number;
    product_id: string;
    units_per_occupied_night: number;
    updated_at: string;
}

// ─── Phase 68.3: Unified Material Overview ────────────────────────────────────
// D44: no quantity sum across groups; ribbon is dimensionless only
// D45: 3 tiles at launch — Linen / Amenity FO / Amenity Audit
export type MaterialGroupKey = "linen" | "amenity_fo_reconciled" | "amenity_audit_adjusted";

export interface MaterialBucketCounts {
    red: number;
    yellow: number;
    green: number;
    na: number;
}

export interface MaterialGroupTile {
    group: MaterialGroupKey;
    label: string;
    unit: string;
    actual: number;
    max: number | null;
    usage_pct: number | null;
    tier: VarianceTier;
    alert_count: number;
    bucket_counts: MaterialBucketCounts;
    detail_href: string;
    errored: boolean;
}

export interface MaterialOverviewRibbon {
    total_alerts: number;
    worst_tier: VarianceTier;
    bucket_counts: MaterialBucketCounts;
    coverage_days: number;
}

export interface MaterialOverviewResponse {
    window: AnalyticsWindow;
    period_start: string;
    period_end: string;
    ribbon: MaterialOverviewRibbon;
    tiles: MaterialGroupTile[];
    partial: boolean;
    errors: Array<{ group: MaterialGroupKey; message: string }>;
}

// ─── Phase 69: Historical Consumption Analytics ──────────────────────────────
// Snapshot rows imported from historical Excel ETL. These are read-only
// baselines, not live operational facts.
export type HistoricalBaselineType = "amenity" | "linen" | "roomtype" | "all";

export interface AnalyticsHistoricalAmenity {
    id: number;
    period_start: string;
    year: number;
    month: number;
    num_days: number;
    total_room_nights: number;
    thai_room_nights: number;
    foreign_room_nights: number;
    unknown_room_nights: number;
    water_used: number;
    water_max: number;
    water_usage_pct: number | null;
    water_per_room_night: number | null;
    water_thai_allocated_qty: number;
    water_foreign_allocated_qty: number;
    water_unknown_allocated_qty: number;
    water_thai_per_rn: number | null;
    water_foreign_per_rn: number | null;
    coffee_used: number;
    coffee_max: number;
    coffee_usage_pct: number | null;
    coffee_thai_allocated_qty: number;
    coffee_foreign_allocated_qty: number;
    coffee_unknown_allocated_qty: number;
    data_source: string | null;
    created_at: string | null;
}

export interface AnalyticsHistoricalLinen {
    id: number;
    period_start: string;
    year: number;
    month: number;
    linen_item_id: number;
    linen_item_number: number | null;
    linen_item_name_th: string | null;
    linen_item_name_en: string | null;
    total_sent: number;
    max_capacity: number;
    linen_usage_pct: number | null;
    price_per_piece: number;
    total_cost: number;
    thai_allocated_qty: number;
    foreign_allocated_qty: number;
    unknown_allocated_qty: number;
    data_source: string | null;
    created_at: string | null;
}

export interface AnalyticsHistoricalRoomtype {
    id: number;
    period_start: string;
    year: number;
    month: number;
    room_type_code: string;
    room_nights: number;
    thai_nights: number;
    foreign_nights: number;
    water_allocated_qty: number;
    coffee_allocated_qty: number;
    water_per_room_night: number | null;
    coffee_per_room_night: number | null;
    data_source: string | null;
    created_at: string | null;
}

export interface AnalyticsHistoricalBaselineResponse {
    success: true;
    amenity: AnalyticsHistoricalAmenity[];
    linen: AnalyticsHistoricalLinen[];
    roomtype: AnalyticsHistoricalRoomtype[];
}
