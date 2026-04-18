import type { SupabaseClient } from "@supabase/supabase-js";
import { calculateExpectedLinen } from "@/lib/linen/expected-calc";
import { computeBucket } from "@/lib/analytics/variance";
import type { AnalyticsMetric, AnalyticsQuery, AnalyticsTrendPoint } from "@/lib/analytics/types";

type LinenVarianceRpcRow = {
  linen_item_id: number;
  item_number: string;
  name_th: string;
  name_en: string | null;
  category_key: string;
  actual_qty: number | string | null;
  predict_qty: number | string | null;
  max_qty: number | string | null;
  active_rooms: number | string | null;
  days_in_period: number | string | null;
};

type LinenTrendRpcRow = {
  period_start: string;
  actual_qty: number | string | null;
  predict_qty: number | string | null;
  max_qty: number | string | null;
  statistical_qty: number | string | null;
};

type ExpectedItem = {
  linen_item_id: number;
  item_number: number;
  name_th: string;
  estimated_qty: number;
};

function toNumber(value: unknown): number {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) ? parsed : 0;
}

function listDates(start: string, end: string): string[] {
  const dates: string[] = [];
  const cursor = new Date(`${start}T00:00:00.000Z`);
  const endDate = new Date(`${end}T00:00:00.000Z`);
  while (cursor <= endDate) {
    dates.push(cursor.toISOString().slice(0, 10));
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }
  return dates;
}

function periodStart(date: string, window: AnalyticsQuery["window"]): string {
  const parsed = new Date(`${date}T00:00:00.000Z`);
  if (window === "month") {
    return `${parsed.getUTCFullYear()}-${String(parsed.getUTCMonth() + 1).padStart(2, "0")}-01`;
  }
  if (window === "week") {
    const day = parsed.getUTCDay() || 7;
    parsed.setUTCDate(parsed.getUTCDate() - day + 1);
  }
  return parsed.toISOString().slice(0, 10);
}

function categoryKey(itemNumber: number, nameEn?: string | null): string {
  switch (itemNumber) {
    case 1: return "linen.pillowcase";
    case 2: return "linen.bath_towel";
    case 3: return "linen.bath_mat";
    case 4: return "linen.single_bed_sheet";
    case 5: return "linen.double_bed_sheet";
    case 6: return "linen.king_bed_sheet";
    case 7: return "linen.single_duvet_cover";
    case 8: return "linen.double_duvet_cover";
    case 9: return "linen.king_duvet_cover";
    default:
      return `linen.${String(nameEn ?? itemNumber).toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "")}`;
  }
}

function categoryAllowed(item: ExpectedItem, categories?: string[]): boolean {
  if (!categories || categories.length === 0) return true;
  const key = categoryKey(Number(item.item_number));
  return categories.includes(key) || categories.includes(String(item.item_number));
}

async function expectedByItem(
  supabase: SupabaseClient,
  query: AnalyticsQuery
): Promise<Map<number, number>> {
  const totals = new Map<number, number>();
  const days = listDates(query.start, query.end);
  const results = await Promise.all(
    days.map((businessDate) => calculateExpectedLinen(supabase, { businessDate }))
  );

  for (const result of results) {
    for (const item of result.items) {
      if (!categoryAllowed(item, query.category)) continue;
      totals.set(item.linen_item_id, (totals.get(item.linen_item_id) ?? 0) + toNumber(item.estimated_qty));
    }
  }
  return totals;
}

async function expectedTrend(
  supabase: SupabaseClient,
  query: AnalyticsQuery
): Promise<Map<string, number>> {
  const totals = new Map<string, number>();
  const days = listDates(query.start, query.end);
  const results = await Promise.all(
    days.map(async (businessDate) => ({
      businessDate,
      expected: await calculateExpectedLinen(supabase, { businessDate }),
    }))
  );

  for (const row of results) {
    const bucket = periodStart(row.businessDate, query.window);
    const total = row.expected.items
      .filter((item) => categoryAllowed(item, query.category))
      .reduce((sum, item) => sum + toNumber(item.estimated_qty), 0);
    totals.set(bucket, (totals.get(bucket) ?? 0) + total);
  }
  return totals;
}

export async function fetchLinenVariance(
  supabase: SupabaseClient,
  query: AnalyticsQuery
): Promise<AnalyticsMetric> {
  const [{ data, error }, predictMap] = await Promise.all([
    supabase.rpc("fn_linen_analytics_variance", {
      p_start: query.start,
      p_end: query.end,
      p_categories: query.category ?? null,
      p_room_types: null,
    } as any),
    expectedByItem(supabase, query),
  ]);

  if (error) throw new Error(error.message);

  const buckets = ((data ?? []) as LinenVarianceRpcRow[]).map((row) => {
    const actual = toNumber(row.actual_qty);
    const predict = toNumber(predictMap.get(Number(row.linen_item_id)));
    const max = toNumber(row.max_qty);
    return computeBucket({
      category: String(row.category_key ?? categoryKey(Number(row.item_number), row.name_en)),
      label: String(row.name_en || row.name_th || row.item_number),
      actual,
      baselines: {
        predict: {
          source: "predict",
          value: predict,
          computed_from: { start_date: query.start, end_date: query.end, sample_size: toNumber(row.days_in_period) },
        },
        statistical: null,
        max: {
          source: "max",
          value: max,
          computed_from: { start_date: query.start, end_date: query.end, sample_size: toNumber(row.active_rooms) },
        },
      },
    });
  });

  buckets.sort((a, b) => {
    const rank: Record<string, number> = { red: 0, yellow: 1, green: 2, na: 3 };
    const tierDiff = rank[a.tier] - rank[b.tier];
    if (tierDiff !== 0) return tierDiff;
    return b.actual - a.actual || a.label.localeCompare(b.label, undefined, { sensitivity: "base" });
  });

  return {
    window: query.window,
    period_start: query.start,
    period_end: query.end,
    buckets,
  };
}

export async function fetchLinenTrend(
  supabase: SupabaseClient,
  query: AnalyticsQuery
): Promise<AnalyticsTrendPoint[]> {
  const [{ data, error }, predictMap] = await Promise.all([
    supabase.rpc("fn_linen_analytics_trend", {
      p_start: query.start,
      p_end: query.end,
      p_window: query.window,
      p_categories: query.category ?? null,
      p_room_types: null,
    } as any),
    expectedTrend(supabase, query),
  ]);

  if (error) throw new Error(error.message);

  return ((data ?? []) as LinenTrendRpcRow[]).map((row) => {
    const period = String(row.period_start).slice(0, 10);
    return {
      period,
      actual: toNumber(row.actual_qty),
      predict: toNumber(predictMap.get(period)),
      max: toNumber(row.max_qty),
      statistical: null,
    };
  });
}
