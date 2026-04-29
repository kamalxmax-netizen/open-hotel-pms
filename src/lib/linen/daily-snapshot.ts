import type { SupabaseClient } from "@supabase/supabase-js";
import type { LinenDailySnapshot, LinenDailySnapshotItem, LinenDailySnapshotTotals } from "@/lib/types";

type BatchRow = {
  id: string;
  business_date: string;
  pickup_round: number | null;
  status: string | null;
};

type BatchItemRow = {
  batch_id: string;
  linen_item_id: number;
  is_dayuse: boolean;
  sent_by_hotel: number;
};

type EventRow = {
  batch_id: string;
  event_type: string;
  data: Record<string, any> | null;
  created_at: string;
};

type RewashRow = {
  id: number;
  sent_in_batch_id: string;
  resolved_batch_id: string | null;
  linen_item_id: number;
  qty: number;
  resolved_qty: number | null;
  status: string | null;
};

type ItemAccumulator = {
  linen_item_id: number;
  item_number: number | null;
  name_th: string;
} & LinenDailySnapshotTotals;

const ZERO_TOTALS: LinenDailySnapshotTotals = {
  sent_normal: 0,
  sent_rewash: 0,
  sent_old_dayuse: 0,
  received_normal: 0,
  received_rewash: 0,
  received_pending: 0,
  received_old_dayuse: 0,
  balance_normal_today: 0,
  balance_old_dayuse: 0,
  balance_pending_old: 0,
  balance_rewash: 0,
  balance_vendor: 0,
};

function assertBusinessDate(value: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) throw new Error("Invalid business_date.");
}

function numberValue(value: unknown): number {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) ? Math.max(0, parsed) : 0;
}

function sourceKey(batchId: string, linenItemId: number, isDayuse: boolean) {
  return `${batchId}:${linenItemId}:${isDayuse ? "1" : "0"}`;
}

function sourceLooseKey(batchId: string, linenItemId: number) {
  return `${batchId}:${linenItemId}`;
}

function isSameOrBefore(left: string, right: string) {
  return left <= right;
}

function emptyAccumulator(row: { id: number; item_number: number | null; name_th: string }): ItemAccumulator {
  return {
    linen_item_id: Number(row.id),
    item_number: row.item_number == null ? null : Number(row.item_number),
    name_th: String(row.name_th ?? ""),
    ...ZERO_TOTALS,
  };
}

function add(acc: ItemAccumulator, key: keyof LinenDailySnapshotTotals, qty: unknown) {
  const value = numberValue(qty);
  if (value <= 0) return;
  acc[key] += value;
}

function getActiveEvents(events: EventRow[]) {
  const latestReopenIndex = events.reduce(
    (latest, event, index) => event.event_type === "reopened" ? index : latest,
    -1
  );
  return events.slice(latestReopenIndex + 1);
}

function normalizeSnapshot(row: any, items: any[]): LinenDailySnapshot {
  const totals: LinenDailySnapshotTotals = {
    sent_normal: numberValue(row.total_sent_normal),
    sent_rewash: numberValue(row.total_sent_rewash),
    sent_old_dayuse: numberValue(row.total_sent_old_dayuse),
    received_normal: numberValue(row.total_received_normal),
    received_rewash: numberValue(row.total_received_rewash),
    received_pending: numberValue(row.total_received_pending),
    received_old_dayuse: numberValue(row.total_received_old_dayuse),
    balance_normal_today: numberValue(row.total_balance_normal_today),
    balance_old_dayuse: numberValue(row.total_balance_old_dayuse),
    balance_pending_old: numberValue(row.total_balance_pending_old),
    balance_rewash: numberValue(row.total_balance_rewash),
    balance_vendor: numberValue(row.total_balance_vendor),
  };

  return {
    id: String(row.id),
    business_date: String(row.business_date),
    computed_at: String(row.computed_at),
    computed_by: row.computed_by ? String(row.computed_by) : null,
    recomputed_count: Number(row.recomputed_count ?? 0),
    recompute_reason: row.recompute_reason ? String(row.recompute_reason) : null,
    totals,
    meta: row.meta && typeof row.meta === "object" ? row.meta : {},
    items: items.map((item): LinenDailySnapshotItem => ({
      id: String(item.id),
      snapshot_id: String(item.snapshot_id),
      business_date: String(item.business_date),
      linen_item_id: Number(item.linen_item_id),
      item_number: item.item_number == null ? null : Number(item.item_number),
      name_th: String(item.name_th ?? ""),
      sent_normal: numberValue(item.sent_normal),
      sent_rewash: numberValue(item.sent_rewash),
      sent_old_dayuse: numberValue(item.sent_old_dayuse),
      received_normal: numberValue(item.received_normal),
      received_rewash: numberValue(item.received_rewash),
      received_pending: numberValue(item.received_pending),
      received_old_dayuse: numberValue(item.received_old_dayuse),
      balance_normal_today: numberValue(item.balance_normal_today),
      balance_old_dayuse: numberValue(item.balance_old_dayuse),
      balance_pending_old: numberValue(item.balance_pending_old),
      balance_rewash: numberValue(item.balance_rewash),
      balance_vendor: numberValue(item.balance_total),
    })),
  };
}

export async function getLinenDailySnapshot(supabase: SupabaseClient, businessDate: string): Promise<LinenDailySnapshot | null> {
  assertBusinessDate(businessDate);

  const { data: snapshot, error } = await supabase
    .from("linen_daily_snapshots")
    .select("*")
    .eq("business_date", businessDate)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!snapshot) return null;

  const { data: items, error: itemsError } = await supabase
    .from("linen_daily_snapshot_items")
    .select("*")
    .eq("snapshot_id", (snapshot as any).id)
    .order("item_number", { ascending: true });
  if (itemsError) throw new Error(itemsError.message);

  return normalizeSnapshot(snapshot, items ?? []);
}

export async function computeLinenDailySnapshot(
  supabase: SupabaseClient,
  businessDate: string,
  options: { actorUserId?: string | null; reason?: string | null } = {}
): Promise<LinenDailySnapshot> {
  assertBusinessDate(businessDate);

  const [itemsRes, batchesRes] = await Promise.all([
    supabase
      .from("linen_items")
      .select("id, item_number, name_th")
      .order("sort_order", { ascending: true })
      .order("item_number", { ascending: true }),
    supabase
      .from("laundry_batches")
      .select("id, business_date, pickup_round, status")
      .lte("business_date", businessDate)
      .order("business_date", { ascending: true })
      .order("pickup_round", { ascending: true }),
  ]);

  if (itemsRes.error) throw new Error(itemsRes.error.message);
  if (batchesRes.error) throw new Error(batchesRes.error.message);

  const itemRows = (itemsRes.data ?? []) as Array<{ id: number; item_number: number | null; name_th: string }>;
  const rowsByItemId = new Map<number, ItemAccumulator>();
  for (const item of itemRows) rowsByItemId.set(Number(item.id), emptyAccumulator(item));

  const batches = (batchesRes.data ?? []).map((row: any): BatchRow => ({
    id: String(row.id),
    business_date: String(row.business_date),
    pickup_round: row.pickup_round == null ? null : Number(row.pickup_round),
    status: row.status == null ? null : String(row.status),
  }));
  const batchById = new Map(batches.map((batch) => [batch.id, batch]));
  const batchIds = batches.map((batch) => batch.id);

  const [batchItemsRes, eventsRes, rewashRes] = batchIds.length
    ? await Promise.all([
        supabase
          .from("laundry_batch_items")
          .select("batch_id, linen_item_id, is_dayuse, sent_by_hotel")
          .in("batch_id", batchIds),
        supabase
          .from("laundry_batch_events")
          .select("batch_id, event_type, data, created_at")
          .in("batch_id", batchIds)
          .order("created_at", { ascending: true }),
        supabase
          .from("laundry_rewash_events")
          .select("id, sent_in_batch_id, resolved_batch_id, linen_item_id, qty, resolved_qty, status")
          .in("sent_in_batch_id", batchIds),
      ])
    : [{ data: [], error: null }, { data: [], error: null }, { data: [], error: null }];

  if (batchItemsRes.error) throw new Error(batchItemsRes.error.message);
  if (eventsRes.error) throw new Error(eventsRes.error.message);
  if (rewashRes.error && rewashRes.error.code !== "42P01") throw new Error(rewashRes.error.message);

  const batchItems = (batchItemsRes.data ?? []).map((row: any): BatchItemRow => ({
    batch_id: String(row.batch_id),
    linen_item_id: Number(row.linen_item_id),
    is_dayuse: Boolean(row.is_dayuse),
    sent_by_hotel: numberValue(row.sent_by_hotel),
  }));
  const events = (eventsRes.data ?? []).map((row: any): EventRow => ({
    batch_id: String(row.batch_id),
    event_type: String(row.event_type),
    data: row.data && typeof row.data === "object" ? row.data : null,
    created_at: String(row.created_at),
  }));
  const rewashRows = (rewashRes.data ?? []).map((row: any): RewashRow => ({
    id: Number(row.id),
    sent_in_batch_id: String(row.sent_in_batch_id),
    resolved_batch_id: row.resolved_batch_id ? String(row.resolved_batch_id) : null,
    linen_item_id: Number(row.linen_item_id),
    qty: numberValue(row.qty),
    resolved_qty: row.resolved_qty == null ? null : numberValue(row.resolved_qty),
    status: row.status == null ? null : String(row.status),
  }));

  const sourceItemByKey = new Map<string, BatchItemRow>();
  const sourceItemByLooseKey = new Map<string, BatchItemRow>();
  for (const item of batchItems) {
    sourceItemByKey.set(sourceKey(item.batch_id, item.linen_item_id, item.is_dayuse), item);
    const loose = sourceLooseKey(item.batch_id, item.linen_item_id);
    if (!sourceItemByLooseKey.has(loose) || !item.is_dayuse) sourceItemByLooseKey.set(loose, item);
  }

  const eventsByBatchId = new Map<string, EventRow[]>();
  for (const event of events) {
    const list = eventsByBatchId.get(event.batch_id) ?? [];
    list.push(event);
    eventsByBatchId.set(event.batch_id, list);
  }
  const activeEventsByBatchId = new Map<string, EventRow[]>();
  for (const batch of batches) activeEventsByBatchId.set(batch.id, getActiveEvents(eventsByBatchId.get(batch.id) ?? []));

  const receivedBySource = new Map<string, number>();
  const rewashResolvedByEventId = new Map<number, number>();
  const countedRewashResolvedToday = new Set<number>();

  function accumulator(linenItemId: number) {
    let row = rowsByItemId.get(linenItemId);
    if (!row) {
      row = emptyAccumulator({ id: linenItemId, item_number: null, name_th: `Item ${linenItemId}` });
      rowsByItemId.set(linenItemId, row);
    }
    return row;
  }

  function addReceivedToSource(batchId: string, linenItemId: number, isDayuse: boolean, qty: number) {
    const key = sourceKey(batchId, linenItemId, isDayuse);
    receivedBySource.set(key, (receivedBySource.get(key) ?? 0) + numberValue(qty));
  }

  for (const batch of batches) {
    if (!isSameOrBefore(batch.business_date, businessDate)) continue;
    const receiverIsToday = batch.business_date === businessDate;
    const activeEvents = activeEventsByBatchId.get(batch.id) ?? [];

    for (const event of activeEvents) {
      if (event.event_type === "fo_return_counted") {
        const returns = Array.isArray(event.data?.returns) ? event.data?.returns : [];
        for (const item of returns) {
          const sourceBatchId = String(item.source_batch_id ?? "");
          const linenItemId = Number(item.linen_item_id ?? 0);
          const qty = numberValue(item.received_qty);
          if (!sourceBatchId || !linenItemId || qty <= 0) continue;

          const explicitDayuse = typeof item.is_dayuse === "boolean" ? Boolean(item.is_dayuse) : null;
          const sourceItem = explicitDayuse == null ? sourceItemByLooseKey.get(sourceLooseKey(sourceBatchId, linenItemId)) : null;
          const isDayuse = explicitDayuse ?? Boolean(sourceItem?.is_dayuse);
          addReceivedToSource(sourceBatchId, linenItemId, isDayuse, qty);
          if (receiverIsToday) add(accumulator(linenItemId), isDayuse ? "received_old_dayuse" : "received_normal", qty);
        }

        const resolved = Array.isArray(event.data?.resolved) ? event.data?.resolved : [];
        for (const item of resolved) {
          const sourceBatchId = String(item.source_batch_id ?? "");
          const linenItemId = Number(item.linen_item_id ?? 0);
          const qty = numberValue(item.qty);
          if (!sourceBatchId || !linenItemId || qty <= 0) continue;

          const sourceItem = sourceItemByLooseKey.get(sourceLooseKey(sourceBatchId, linenItemId));
          addReceivedToSource(sourceBatchId, linenItemId, Boolean(sourceItem?.is_dayuse), qty);
          if (receiverIsToday) add(accumulator(linenItemId), "received_pending", qty);
        }
      }

      if (event.event_type === "rewash_resolved") {
        const rewashEventId = Number(event.data?.rewash_event_id ?? 0);
        const qty = numberValue(event.data?.resolved_qty);
        if (!rewashEventId || qty <= 0) continue;
        rewashResolvedByEventId.set(rewashEventId, (rewashResolvedByEventId.get(rewashEventId) ?? 0) + qty);
        if (receiverIsToday) {
          const rewash = rewashRows.find((row) => row.id === rewashEventId);
          if (rewash) {
            add(accumulator(rewash.linen_item_id), "received_rewash", qty);
            countedRewashResolvedToday.add(rewashEventId);
          }
        }
      }
    }
  }

  for (const item of batchItems) {
    const batch = batchById.get(item.batch_id);
    if (!batch || batch.business_date !== businessDate) continue;
    add(accumulator(item.linen_item_id), item.is_dayuse ? "sent_old_dayuse" : "sent_normal", item.sent_by_hotel);
  }

  for (const rewash of rewashRows) {
    const sentBatch = batchById.get(rewash.sent_in_batch_id);
    if (!sentBatch || sentBatch.business_date !== businessDate || rewash.status === "expired") continue;
    add(accumulator(rewash.linen_item_id), "sent_rewash", rewash.qty);
  }

  for (const rewash of rewashRows) {
    const resolvedBatch = rewash.resolved_batch_id ? batchById.get(rewash.resolved_batch_id) : null;
    if (
      resolvedBatch?.business_date === businessDate &&
      !countedRewashResolvedToday.has(rewash.id) &&
      numberValue(rewash.resolved_qty) > 0
    ) {
      add(accumulator(rewash.linen_item_id), "received_rewash", rewash.resolved_qty);
      rewashResolvedByEventId.set(rewash.id, Math.max(rewashResolvedByEventId.get(rewash.id) ?? 0, numberValue(rewash.resolved_qty)));
    }
  }

  for (const item of batchItems) {
    const batch = batchById.get(item.batch_id);
    if (!batch || !isSameOrBefore(batch.business_date, businessDate)) continue;
    const received = receivedBySource.get(sourceKey(item.batch_id, item.linen_item_id, item.is_dayuse)) ?? 0;
    const balance = Math.max(0, item.sent_by_hotel - received);
    if (balance <= 0) continue;

    const row = accumulator(item.linen_item_id);
    if (item.is_dayuse) {
      add(row, "balance_old_dayuse", balance);
    } else if (batch.business_date === businessDate) {
      add(row, "balance_normal_today", balance);
    } else {
      add(row, "balance_pending_old", balance);
    }
  }

  for (const rewash of rewashRows) {
    const batch = batchById.get(rewash.sent_in_batch_id);
    if (!batch || !isSameOrBefore(batch.business_date, businessDate) || rewash.status === "expired") continue;
    const eventResolved = rewashResolvedByEventId.get(rewash.id) ?? 0;
    const resolvedBatch = rewash.resolved_batch_id ? batchById.get(rewash.resolved_batch_id) : null;
    const rowResolved = resolvedBatch && isSameOrBefore(resolvedBatch.business_date, businessDate) ? numberValue(rewash.resolved_qty) : 0;
    const resolved = Math.max(eventResolved, rowResolved);
    const balance = Math.max(0, rewash.qty - resolved);
    if (balance > 0) add(accumulator(rewash.linen_item_id), "balance_rewash", balance);
  }

  const itemPayload = Array.from(rowsByItemId.values())
    .sort((a, b) => Number(a.item_number ?? 9999) - Number(b.item_number ?? 9999))
    .map((row) => {
      const balanceTotal = row.balance_normal_today + row.balance_old_dayuse + row.balance_pending_old + row.balance_rewash;
      row.balance_vendor = balanceTotal;
      return row;
    });

  const totals = itemPayload.reduce<LinenDailySnapshotTotals>((acc, row) => {
    for (const key of Object.keys(ZERO_TOTALS) as Array<keyof LinenDailySnapshotTotals>) {
      acc[key] += row[key];
    }
    return acc;
  }, { ...ZERO_TOTALS });

  const { data: existing, error: existingError } = await supabase
    .from("linen_daily_snapshots")
    .select("id, recomputed_count")
    .eq("business_date", businessDate)
    .maybeSingle();
  if (existingError) throw new Error(existingError.message);

  const recomputedCount = existing ? Number((existing as any).recomputed_count ?? 0) + 1 : 0;
  const { data: snapshot, error: snapshotError } = await supabase
    .from("linen_daily_snapshots")
    .upsert({
      business_date: businessDate,
      computed_at: new Date().toISOString(),
      computed_by: options.actorUserId ?? null,
      recomputed_count: recomputedCount,
      recompute_reason: options.reason?.trim() || null,
      total_sent_normal: totals.sent_normal,
      total_sent_rewash: totals.sent_rewash,
      total_sent_old_dayuse: totals.sent_old_dayuse,
      total_received_normal: totals.received_normal,
      total_received_rewash: totals.received_rewash,
      total_received_pending: totals.received_pending,
      total_received_old_dayuse: totals.received_old_dayuse,
      total_balance_normal_today: totals.balance_normal_today,
      total_balance_old_dayuse: totals.balance_old_dayuse,
      total_balance_pending_old: totals.balance_pending_old,
      total_balance_rewash: totals.balance_rewash,
      total_balance_vendor: totals.balance_vendor,
      meta: {
        active_batch_count: batches.filter((batch) => batch.business_date === businessDate).length,
        source_batch_count: batches.length,
        generated_by: "computeLinenDailySnapshot",
      },
    }, { onConflict: "business_date" })
    .select("*")
    .single();
  if (snapshotError) throw new Error(snapshotError.message);

  const snapshotId = String((snapshot as any).id);
  const { error: deleteItemsError } = await supabase
    .from("linen_daily_snapshot_items")
    .delete()
    .eq("business_date", businessDate);
  if (deleteItemsError) throw new Error(deleteItemsError.message);

  const insertRows = itemPayload.map((row) => ({
    snapshot_id: snapshotId,
    business_date: businessDate,
    linen_item_id: row.linen_item_id,
    item_number: row.item_number,
    name_th: row.name_th,
    sent_normal: row.sent_normal,
    sent_rewash: row.sent_rewash,
    sent_old_dayuse: row.sent_old_dayuse,
    received_normal: row.received_normal,
    received_rewash: row.received_rewash,
    received_pending: row.received_pending,
    received_old_dayuse: row.received_old_dayuse,
    balance_normal_today: row.balance_normal_today,
    balance_old_dayuse: row.balance_old_dayuse,
    balance_pending_old: row.balance_pending_old,
    balance_rewash: row.balance_rewash,
    balance_total: row.balance_vendor,
  }));

  if (insertRows.length > 0) {
    const { error: insertError } = await supabase.from("linen_daily_snapshot_items").insert(insertRows);
    if (insertError) throw new Error(insertError.message);
  }

  const stored = await getLinenDailySnapshot(supabase, businessDate);
  if (!stored) throw new Error("Snapshot was computed but could not be loaded.");
  return stored;
}
