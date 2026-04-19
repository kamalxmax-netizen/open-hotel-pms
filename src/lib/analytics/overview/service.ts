import type { SupabaseClient } from "@supabase/supabase-js";
import { fetchAmenityVariance } from "@/lib/analytics/amenity/service";
import { fetchLinenVariance } from "@/lib/analytics/linen/service";
import { toURLSearchParams } from "@/lib/analytics/query";
import { worstTierOfTiers } from "@/lib/analytics/variance";
import type {
  AmenityAnalyticsResponse,
  AnalyticsMetric,
  AnalyticsQuery,
  MaterialBucketCounts,
  MaterialGroupKey,
  MaterialGroupTile,
  MaterialOverviewResponse,
  VarianceBucket,
  VarianceTier,
} from "@/lib/analytics/types";

type GroupConfig = {
  group: MaterialGroupKey;
  label: string;
  unit: string;
  href: string;
};

type GroupResult = AnalyticsMetric | AmenityAnalyticsResponse;

const EMPTY_COUNTS: MaterialBucketCounts = { red: 0, yellow: 0, green: 0, na: 0 };

function inclusiveDayCount(start: string, end: string): number {
  const startMs = Date.parse(`${start}T00:00:00.000Z`);
  const endMs = Date.parse(`${end}T00:00:00.000Z`);
  if (!Number.isFinite(startMs) || !Number.isFinite(endMs) || endMs < startMs) return 0;
  return Math.floor((endMs - startMs) / 86_400_000) + 1;
}

function percent(actual: number, max: number | null): number | null {
  if (max === null || max <= 0) return null;
  return Math.round((actual / max) * 100);
}

function countsFromBuckets(buckets: Array<{ tier: VarianceTier }>): MaterialBucketCounts {
  return buckets.reduce<MaterialBucketCounts>(
    (counts, bucket) => {
      counts[bucket.tier] += 1;
      return counts;
    },
    { ...EMPTY_COUNTS }
  );
}

function addCounts(a: MaterialBucketCounts, b: MaterialBucketCounts): MaterialBucketCounts {
  return {
    red: a.red + b.red,
    yellow: a.yellow + b.yellow,
    green: a.green + b.green,
    na: a.na + b.na,
  };
}

function bucketMax(bucket: VarianceBucket | AmenityAnalyticsResponse["buckets"][number]): number | null {
  return bucket.baselines.max?.value ?? null;
}

function makeDetailHref(path: string, query: AnalyticsQuery, source?: string): string {
  const params = toURLSearchParams({
    window: query.window,
    start: query.start,
    end: query.end,
    room_type: query.room_type,
    source: source as AnalyticsQuery["source"],
  });
  return `${path}?${params.toString()}`;
}

function emptyTile(config: GroupConfig, message?: string): MaterialGroupTile {
  return {
    group: config.group,
    label: config.label,
    unit: config.unit,
    actual: 0,
    max: null,
    usage_pct: null,
    tier: "na",
    alert_count: 0,
    bucket_counts: { ...EMPTY_COUNTS },
    detail_href: config.href,
    errored: Boolean(message),
  };
}

function tileFromResult(config: GroupConfig, result: GroupResult): MaterialGroupTile {
  const buckets = result.buckets;
  const actual = buckets.reduce((sum, bucket) => sum + bucket.actual, 0);
  const maxValues = buckets.map(bucketMax).filter((value): value is number => value !== null);
  const max = maxValues.length === 0 ? null : maxValues.reduce((sum, value) => sum + value, 0);
  const tier = max === null ? "na" : worstTierOfTiers(buckets.map((bucket) => bucket.tier));

  return {
    group: config.group,
    label: config.label,
    unit: config.unit,
    actual,
    max,
    usage_pct: percent(actual, max),
    tier,
    alert_count: buckets.filter((bucket) => bucket.alert).length,
    bucket_counts: countsFromBuckets(buckets),
    detail_href: config.href,
    errored: false,
  };
}

function errorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (typeof error === "string") return error;
  return "Unknown analytics error";
}

export async function fetchMaterialOverview(
  supabase: SupabaseClient,
  query: AnalyticsQuery
): Promise<MaterialOverviewResponse> {
  const overviewQuery: AnalyticsQuery = {
    window: query.window,
    start: query.start,
    end: query.end,
    room_type: query.room_type,
  };

  const configs: GroupConfig[] = [
    {
      group: "linen",
      label: "Linen",
      unit: "pieces",
      href: makeDetailHref("/pms/analytics/material/linen", overviewQuery),
    },
    {
      group: "amenity_fo_reconciled",
      label: "Amenity — FO Reconciled",
      unit: "units",
      href: makeDetailHref("/pms/analytics/material/amenity", overviewQuery, "fo_reconciled"),
    },
    {
      group: "amenity_audit_adjusted",
      label: "Amenity — Audit Adjusted",
      unit: "units",
      href: makeDetailHref("/pms/analytics/material/amenity", overviewQuery, "audit_adjusted"),
    },
  ];

  const settled = await Promise.allSettled([
    fetchLinenVariance(supabase, overviewQuery),
    fetchAmenityVariance(supabase, { ...overviewQuery, source: "fo_reconciled" }, { includeExtras: false }),
    fetchAmenityVariance(supabase, { ...overviewQuery, source: "audit_adjusted" }, { includeExtras: false }),
  ]);

  const errors: MaterialOverviewResponse["errors"] = [];
  const successfulTiles: MaterialGroupTile[] = [];
  const tiles = settled.map((result, index): MaterialGroupTile => {
    const config = configs[index];
    if (result.status === "rejected") {
      errors.push({ group: config.group, message: errorMessage(result.reason) });
      return emptyTile(config, errorMessage(result.reason));
    }
    const tile = tileFromResult(config, result.value);
    successfulTiles.push(tile);
    return tile;
  });

  const bucket_counts = successfulTiles.reduce(
    (counts, tile) => addCounts(counts, tile.bucket_counts),
    { ...EMPTY_COUNTS }
  );
  const total_alerts = successfulTiles.reduce((sum, tile) => sum + tile.alert_count, 0);

  return {
    window: overviewQuery.window,
    period_start: overviewQuery.start,
    period_end: overviewQuery.end,
    ribbon: {
      total_alerts,
      worst_tier: worstTierOfTiers(successfulTiles.map((tile) => tile.tier)),
      bucket_counts,
      coverage_days: inclusiveDayCount(overviewQuery.start, overviewQuery.end),
    },
    tiles,
    partial: errors.length > 0,
    errors,
  };
}
