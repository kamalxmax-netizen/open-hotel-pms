import type { SupabaseClient } from "@supabase/supabase-js";
import type {
  LinenMonthlyDaily,
  LinenMonthlyDailyCell,
  LinenMonthlyExtra,
  LinenMonthlyMegaResponse,
  LinenMonthlyColumnKind,
  LinenMonthlySummary,
  LinenMonthlySummaryRow,
  LinenMonthlyDayuseSummary,
  LinenVarianceConfig,
} from "@/lib/types";

type MonthlySummaryRpcRow = {
  linen_item_id: number;
  item_number: number;
  name_th: string;
  name_en: string;
  rate: number | string | null;
  qty_sent: number | string | null;
  qty_returned: number | string | null;
  qty_pending: number | string | null;
  qty_extra: number | string | null;
  qty_dayuse: number | string | null;
  total_baht: number | string | null;
};

type MonthlyDailyRpcRow = {
  linen_item_id: number;
  item_number: number;
  day_of_month: number;
  qty_sent: number | string | null;
};

const EXTRA_LABELS = new Map<number, string>([
  [1, "ปลอกหมอนเพิ่ม"],
  [2, "ขนหนูเพิ่ม"],
]);

function numberValue(value: unknown): number {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) ? parsed : 0;
}

function dateUtc(year: number, month: number, day: number): Date {
  return new Date(Date.UTC(year, month - 1, day));
}

export function daysInMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

export function monthStartDate(year: number, month: number): string {
  return dateUtc(year, month, 1).toISOString().slice(0, 10);
}

export function monthDateString(year: number, month: number, day: number): string {
  return dateUtc(year, month, day).toISOString().slice(0, 10);
}

export function normalizeEffectiveMonth(value: string): string {
  const match = value.match(/^(\d{4})-(\d{2})(?:-\d{2})?$/);
  if (!match) throw new Error("Invalid effective_month. Use YYYY-MM or YYYY-MM-01.");
  return `${match[1]}-${match[2]}-01`;
}

export async function getVarianceConfig(supabase: SupabaseClient): Promise<LinenVarianceConfig> {
  const { data, error } = await supabase
    .from("linen_variance_config")
    .select("*")
    .eq("id", 1)
    .maybeSingle();

  if (error) throw new Error(error.message);

  return {
    id: 1,
    green_min: numberValue((data as any)?.green_min ?? 90),
    green_max: numberValue((data as any)?.green_max ?? 110),
    yellow_min: numberValue((data as any)?.yellow_min ?? 70),
    yellow_max: numberValue((data as any)?.yellow_max ?? 130),
    updated_at: String((data as any)?.updated_at ?? new Date(0).toISOString()),
    updated_by: (data as any)?.updated_by ?? null,
  };
}

export async function getMonthlyCloseStatus(
  supabase: SupabaseClient,
  year: number,
  month: number
): Promise<{ closed: boolean; closed_at: string | null }> {
  const { data, error } = await supabase
    .from("laundry_monthly_close")
    .select("closed_at, reopened_at")
    .eq("year", year)
    .eq("month", month)
    .maybeSingle();

  if (error) throw new Error(error.message);
  const closed = Boolean(data?.closed_at && !data?.reopened_at);
  return { closed, closed_at: closed ? String(data?.closed_at) : null };
}

export async function getMonthlySummary(
  supabase: SupabaseClient,
  year: number,
  month: number
): Promise<LinenMonthlySummary> {
  const [{ data, error }, close] = await Promise.all([
    (supabase as any).rpc("fn_linen_monthly_summary", { p_year: year, p_month: month }),
    getMonthlyCloseStatus(supabase, year, month),
  ]);

  if (error) throw new Error(error.message);

  const rows = ((data ?? []) as MonthlySummaryRpcRow[]).map((row): LinenMonthlySummaryRow => {
    const rate = numberValue(row.rate);
    const qtySent = numberValue(row.qty_sent);
    const qtyReturned = numberValue(row.qty_returned);
    const qtyDayuse = numberValue(row.qty_dayuse);
    return {
      linen_item_id: Number(row.linen_item_id),
      item_number: Number(row.item_number),
      name_th: String(row.name_th ?? ""),
      name_en: String(row.name_en ?? ""),
      rate,
      qty_sent: qtySent,
      qty_returned: qtyReturned,
      qty_pending: numberValue(row.qty_pending),
      qty_extra: numberValue(row.qty_extra),
      qty_dayuse: qtyDayuse,
      total_baht: Number((rate * (qtySent + qtyDayuse)).toFixed(2)),
    };
  });

  const extras: LinenMonthlyExtra[] = rows
    .filter((row) => EXTRA_LABELS.has(row.item_number) && row.qty_extra > 0)
    .map((row) => ({
      item_name: EXTRA_LABELS.get(row.item_number) ?? `${row.name_th}เพิ่ม`,
      linen_item_id: row.linen_item_id,
      qty: row.qty_extra,
    }));

  const dayuse: LinenMonthlyDayuseSummary[] = rows
    .filter((row) => row.qty_dayuse > 0)
    .map((row) => ({
      linen_item_id: row.linen_item_id,
      item_number: row.item_number,
      name_th: row.name_th,
      qty: row.qty_dayuse,
    }));

  const totalPieces = rows.reduce((sum, row) => sum + row.qty_sent + row.qty_dayuse, 0);
  const totalBaht = rows.reduce((sum, row) => sum + (row.qty_sent + row.qty_dayuse) * row.rate, 0);

  return {
    year,
    month,
    closed: close.closed,
    closed_at: close.closed_at,
    total_pieces: totalPieces,
    total_baht: Number(totalBaht.toFixed(2)),
    items: rows,
    extras,
    dayuse,
  };
}

export async function getMonthlyDaily(
  supabase: SupabaseClient,
  year: number,
  month: number
): Promise<LinenMonthlyDaily> {
  const { data, error } = await (supabase as any).rpc("fn_linen_monthly_daily", {
    p_year: year,
    p_month: month,
  });

  if (error) throw new Error(error.message);

  const cells: LinenMonthlyDailyCell[] = ((data ?? []) as MonthlyDailyRpcRow[]).map((row) => ({
    linen_item_id: Number(row.linen_item_id),
    item_number: Number(row.item_number),
    day_of_month: Number(row.day_of_month),
    qty_sent: numberValue(row.qty_sent),
  }));

  return {
    year,
    month,
    days_in_month: daysInMonth(year, month),
    cells,
  };
}

function columnKey(day: number, round: number, kind: LinenMonthlyColumnKind) {
  return `${day}_R${round}_${kind}`;
}

function isKindIncluded(kind: LinenMonthlyColumnKind, filters: { includeN: boolean; includeO: boolean; includeRw: boolean }) {
  if (kind === "N") return filters.includeN;
  if (kind === "O") return filters.includeO;
  return filters.includeRw;
}

export async function getMonthlyMegaGrid(
  supabase: SupabaseClient,
  year: number,
  month: number,
  options: {
    includeN?: boolean;
    includeO?: boolean;
    includeRw?: boolean;
    includeRounds?: number[];
  } = {}
): Promise<LinenMonthlyMegaResponse> {
  const includeN = options.includeN ?? true;
  const includeO = options.includeO ?? true;
  const includeRw = options.includeRw ?? true;
  const includeRounds = options.includeRounds?.length ? new Set(options.includeRounds) : null;
  const startDate = monthStartDate(year, month);
  const endDate = month === 12 ? monthStartDate(year + 1, 1) : monthStartDate(year, month + 1);

  const [{ items: summaryRows }, batchesRes] = await Promise.all([
    getMonthlySummary(supabase, year, month),
    supabase
      .from("laundry_batches")
      .select("id, business_date, pickup_round")
      .gte("business_date", startDate)
      .lt("business_date", endDate)
      .order("business_date", { ascending: true })
      .order("pickup_round", { ascending: true }),
  ]);

  if (batchesRes.error) throw new Error(batchesRes.error.message);
  const batches = (batchesRes.data ?? []) as Array<{ id: string; business_date: string; pickup_round: number }>;
  const batchById = new Map(batches.map((batch) => [String(batch.id), batch]));
  const batchIds = batches.map((batch) => String(batch.id));

  const [itemsRes, rewashRes] = batchIds.length
    ? await Promise.all([
        supabase
          .from("laundry_batch_items")
          .select("batch_id, linen_item_id, is_dayuse, sent_by_hotel")
          .in("batch_id", batchIds),
        supabase
          .from("laundry_rewash_events")
          .select("sent_in_batch_id, linen_item_id, qty")
          .in("sent_in_batch_id", batchIds),
      ])
    : [{ data: [], error: null }, { data: [], error: null }];

  if (itemsRes.error) throw new Error(itemsRes.error.message);
  if (rewashRes.error) throw new Error(rewashRes.error.message);

  const cellQty = new Map<string, number>();
  const columnMeta = new Map<string, { day_of_month: number; pickup_round: number; kind: LinenMonthlyColumnKind }>();

  function addCell(linenItemId: number, batchId: string, kind: LinenMonthlyColumnKind, qty: number) {
    const batch = batchById.get(batchId);
    if (!batch || qty <= 0) return;
    if (includeRounds && !includeRounds.has(Number(batch.pickup_round))) return;
    if (!isKindIncluded(kind, { includeN, includeO, includeRw })) return;

    const day = Number(String(batch.business_date).slice(8, 10));
    const key = columnKey(day, Number(batch.pickup_round), kind);
    columnMeta.set(key, { day_of_month: day, pickup_round: Number(batch.pickup_round), kind });
    const cellKey = `${linenItemId}:${key}`;
    cellQty.set(cellKey, (cellQty.get(cellKey) ?? 0) + qty);
  }

  for (const item of itemsRes.data ?? []) {
    addCell(
      Number((item as any).linen_item_id),
      String((item as any).batch_id),
      (item as any).is_dayuse ? "O" : "N",
      numberValue((item as any).sent_by_hotel)
    );
  }

  for (const event of rewashRes.data ?? []) {
    addCell(
      Number((event as any).linen_item_id),
      String((event as any).sent_in_batch_id),
      "RW",
      numberValue((event as any).qty)
    );
  }

  const columns = Array.from(columnMeta.entries())
    .map(([key, meta]) => ({ key, ...meta }))
    .sort((a, b) => (
      a.day_of_month - b.day_of_month ||
      a.pickup_round - b.pickup_round ||
      ["N", "O", "RW"].indexOf(a.kind) - ["N", "O", "RW"].indexOf(b.kind)
    ));

  const perColumn: Record<string, number> = {};
  const perColumnBaht: Record<string, number> = {};
  for (const column of columns) {
    perColumn[column.key] = 0;
    perColumnBaht[column.key] = 0;
  }

  let grandTotalQty = 0;
  let grandTotalBaht = 0;
  let rewashTotalQty = 0;

  const rows = summaryRows.map((summary) => {
    let totalQty = 0;
    let totalRewashQty = 0;
    const cells = columns.map((column) => {
      const qty = cellQty.get(`${summary.linen_item_id}:${column.key}`) ?? 0;
      perColumn[column.key] = (perColumn[column.key] ?? 0) + qty;
      if (column.kind === "RW") {
        totalRewashQty += qty;
        rewashTotalQty += qty;
      } else {
        totalQty += qty;
        perColumnBaht[column.key] = (perColumnBaht[column.key] ?? 0) + qty * summary.rate;
      }
      return { column_key: column.key, qty };
    });
    const totalBaht = Number((totalQty * summary.rate).toFixed(2));
    grandTotalQty += totalQty;
    grandTotalBaht += totalBaht;
    return {
      linen_item_id: summary.linen_item_id,
      item_number: summary.item_number,
      name_th: summary.name_th,
      rate_baht: summary.rate,
      total_qty: totalQty,
      total_baht: totalBaht,
      total_rewash_qty: totalRewashQty,
      cells,
    };
  });

  for (const key of Object.keys(perColumnBaht)) {
    perColumnBaht[key] = Number(perColumnBaht[key].toFixed(2));
  }

  return {
    year,
    month,
    days_in_month: daysInMonth(year, month),
    columns,
    rows,
    totals: {
      per_column: perColumn,
      per_column_baht: perColumnBaht,
      grand_total_qty: grandTotalQty,
      grand_total_baht: Number(grandTotalBaht.toFixed(2)),
      rewash_total_qty: rewashTotalQty,
    },
  };
}
