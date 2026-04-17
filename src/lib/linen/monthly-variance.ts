import type { SupabaseClient } from "@supabase/supabase-js";
import type { LinenMonthlyVariance, LinenMonthlyVarianceRow, LinenVarianceConfig, LinenVarianceTier } from "@/lib/types";
import { calculateExpectedLinen } from "@/lib/linen/expected-calc";
import { daysInMonth, getMonthlySummary, getVarianceConfig, monthDateString } from "@/lib/linen/monthly";

function varianceTier(variancePct: number | null, config: LinenVarianceConfig): LinenVarianceTier {
  if (variancePct === null) return "na";
  if (variancePct >= config.green_min && variancePct <= config.green_max) return "green";
  if (variancePct >= config.yellow_min && variancePct <= config.yellow_max) return "yellow";
  return "red";
}

export async function computeMonthlyVariance(
  supabase: SupabaseClient,
  year: number,
  month: number
): Promise<LinenMonthlyVariance> {
  const [summary, config] = await Promise.all([
    getMonthlySummary(supabase, year, month),
    getVarianceConfig(supabase),
  ]);

  const expectedByItem = new Map<number, number>();
  const days = daysInMonth(year, month);

  for (let day = 1; day <= days; day += 1) {
    const businessDate = monthDateString(year, month, day);
    const expected = await calculateExpectedLinen(supabase, { businessDate });
    for (const item of expected.items) {
      expectedByItem.set(
        item.linen_item_id,
        (expectedByItem.get(item.linen_item_id) ?? 0) + Number(item.estimated_qty ?? 0)
      );
    }
  }

  const rows: LinenMonthlyVarianceRow[] = summary.items
    .filter((item) => item.item_number >= 1 && item.item_number <= 9)
    .map((item) => {
      const expectedQty = Math.round(expectedByItem.get(item.linen_item_id) ?? 0);
      const actualQty = item.qty_sent;
      const variancePct = expectedQty > 0 ? Number(((actualQty / expectedQty) * 100).toFixed(2)) : null;
      return {
        linen_item_id: item.linen_item_id,
        item_number: item.item_number,
        name_th: item.name_th,
        expected_qty: expectedQty,
        actual_qty: actualQty,
        variance_pct: variancePct,
        tier: varianceTier(variancePct, config),
      };
    });

  return {
    year,
    month,
    rows,
    config,
  };
}
