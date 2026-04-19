import type { SupabaseClient } from "@supabase/supabase-js";
import { computeBucket } from "@/lib/analytics/variance";
import type {
  AmenityAnalyticsCategoryOption,
  AmenityAnalyticsResponse,
  AmenityAnalyticsSource,
  AmenityAnalyticsTrendPoint,
  AmenityAnalyticsVarianceRow,
  AmenityReconciliationVarianceNote,
  AnalyticsQuery,
} from "@/lib/analytics/types";

type AmenityVarianceRpcRow = {
  category: string;
  label: string;
  source: Exclude<AmenityAnalyticsSource, "all">;
  actual_qty: number | string | null;
  predict_qty: number | string | null;
  max_qty: number | string | null;
  statistical_qty: number | string | null;
  actual_source: "direct" | "allocated" | null;
  has_setup: boolean | null;
  history_sample_size: number | string | null;
  days_in_period: number | string | null;
};

type AmenityTrendRpcRow = {
  period: string;
  actual: number | string | null;
  predict: number | string | null;
  max: number | string | null;
  statistical: number | string | null;
};

type AmenityNoteRpcRow = {
  business_date: string;
  product_id: string;
  category: string;
  label: string;
  reconciled_consumed: number | string | null;
  maid_tap_total: number | string | null;
  delta: number | string | null;
  fo_return_note: string | null;
  recorded_at: string;
  recorded_by: string | null;
  batch_id: string;
};

function toNumber(value: unknown): number {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) ? parsed : 0;
}

function toNullableNumber(value: unknown): number | null {
  if (value === null || value === undefined) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function source(query: AnalyticsQuery): AmenityAnalyticsSource {
  return query.source ?? "all";
}

export async function fetchAmenityVariance(
  supabase: SupabaseClient,
  query: AnalyticsQuery,
  options: { includeExtras?: boolean } = {}
): Promise<AmenityAnalyticsResponse> {
  const includeExtras = options.includeExtras ?? true;
  const sourceFilter = source(query);
  const { data, error } = await supabase.rpc("fn_amenity_analytics_variance", {
    p_start: query.start,
    p_end: query.end,
    p_categories: query.category ?? null,
    p_source: sourceFilter,
    p_room_type_codes: query.room_type ?? null,
  } as any);

  if (error) throw new Error(error.message);

  const actualIsAllocated = Boolean(query.room_type && query.room_type.length > 0);
  const buckets = ((data ?? []) as AmenityVarianceRpcRow[]).map((row): AmenityAnalyticsVarianceRow => {
    const actual = toNumber(row.actual_qty);
    const predict = toNullableNumber(row.predict_qty);
    const max = toNullableNumber(row.max_qty);
    const statistical = toNullableNumber(row.statistical_qty);
    const computed = computeBucket({
      category: row.category,
      label: row.label,
      actual,
      baselines: {
        predict: {
          source: "predict",
          value: predict ?? 0,
          computed_from: {
            start_date: query.start,
            end_date: query.end,
            sample_size: toNumber(row.history_sample_size),
          },
        },
        statistical: statistical === null ? null : { source: "statistical", value: statistical },
        max: {
          source: "max",
          value: max ?? 0,
          computed_from: {
            start_date: query.start,
            end_date: query.end,
            sample_size: toNumber(row.days_in_period),
          },
        },
      },
    });

    return {
      category: computed.category,
      label: computed.label,
      source: row.source,
      actual: computed.actual,
      actual_source: row.actual_source ?? (actualIsAllocated ? "allocated" : "direct"),
      baselines: {
        predict: predict === null ? null : computed.baselines.predict,
        statistical: computed.baselines.statistical,
        max: max === null ? null : computed.baselines.max,
      },
      pct_vs_predict: predict === null ? null : computed.pct_vs_predict,
      pct_vs_statistical: computed.pct_vs_statistical,
      pct_vs_max: max === null ? null : computed.pct_vs_max,
      tier: computed.tier,
      alert: computed.alert,
    };
  });

  buckets.sort((a, b) => {
    const rank: Record<string, number> = { red: 0, yellow: 1, green: 2, na: 3 };
    const tierDiff = rank[a.tier] - rank[b.tier];
    if (tierDiff !== 0) return tierDiff;
    return b.actual - a.actual || a.label.localeCompare(b.label, undefined, { sensitivity: "base" });
  });

  const [trend, reconciliationNotes] = includeExtras
    ? await Promise.all([
        fetchAmenityTrend(supabase, query),
        sourceFilter === "audit_adjusted" ? Promise.resolve([]) : fetchAmenityReconciliationNotes(supabase, query),
      ])
    : [[], []];

  return {
    window: query.window,
    period_start: query.start,
    period_end: query.end,
    buckets,
    trend,
    reconciliationNotes,
  };
}

export async function fetchAmenityTrend(
  supabase: SupabaseClient,
  query: AnalyticsQuery
): Promise<AmenityAnalyticsTrendPoint[]> {
  const sourceFilter = source(query);
  const rpcArgs: Record<string, unknown> = {
    p_start: query.start,
    p_end: query.end,
    p_window: query.window,
    p_source: sourceFilter,
    p_room_type_codes: query.room_type ?? null,
  };
  if (query.category && query.category.length > 0) {
    rpcArgs.p_categories = query.category;
  }

  const { data, error } = await supabase.rpc("fn_amenity_analytics_trend", rpcArgs as any);

  if (error) throw new Error(error.message);

  return ((data ?? []) as AmenityTrendRpcRow[]).map((row) => ({
    period: String(row.period).slice(0, 10),
    actual: toNumber(row.actual),
    predict: toNullableNumber(row.predict),
    max: toNullableNumber(row.max),
    statistical: toNullableNumber(row.statistical),
    source: sourceFilter,
  }));
}

export async function fetchAmenityCategories(
  supabase: SupabaseClient
): Promise<AmenityAnalyticsCategoryOption[]> {
  const { data, error } = await supabase.rpc("fn_amenity_analytics_categories");
  if (error) throw new Error(error.message);
  return ((data ?? []) as AmenityAnalyticsCategoryOption[]).map((row) => ({
    category_key: String(row.category_key),
    label: String(row.label),
    source_hint: row.source_hint,
  }));
}

export async function fetchAmenityReconciliationNotes(
  supabase: SupabaseClient,
  query: AnalyticsQuery
): Promise<AmenityReconciliationVarianceNote[]> {
  const { data, error } = await supabase.rpc("fn_amenity_reconciliation_variance_notes", {
    p_start: query.start,
    p_end: query.end,
    p_categories: query.category ?? null,
  } as any);

  if (error) throw new Error(error.message);

  return ((data ?? []) as AmenityNoteRpcRow[]).map((row) => ({
    business_date: String(row.business_date).slice(0, 10),
    product_id: String(row.product_id),
    category: String(row.category),
    label: String(row.label),
    reconciled_consumed: toNumber(row.reconciled_consumed),
    maid_tap_total: toNumber(row.maid_tap_total),
    delta: toNumber(row.delta),
    fo_return_note: row.fo_return_note,
    recorded_at: String(row.recorded_at),
    recorded_by: row.recorded_by,
    batch_id: String(row.batch_id),
  }));
}
