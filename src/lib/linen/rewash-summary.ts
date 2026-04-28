export type RewashSummarySource = {
  id?: string | number | null;
  linen_item_id?: number | string | null;
  name_th?: string | null;
  item_name_th?: string | null;
  qty?: number | string | null;
  resolved_qty?: number | string | null;
  is_dayuse?: boolean | null;
  status?: string | null;
};

export type LinenSummaryRow = {
  id: string;
  linen_item_id: number;
  name: string;
  qty: number;
  is_dayuse: boolean;
  status: string | null;
};

export function toRewashSummaryRows(events: RewashSummarySource[] | null | undefined): LinenSummaryRow[] {
  return (events ?? [])
    .map((event, index) => {
      const linenItemId = Number(event.linen_item_id ?? 0);
      const qty = Number(event.qty ?? 0);
      const name = String(event.name_th ?? event.item_name_th ?? `Item ${linenItemId || index + 1}`);

      return {
        id: String(event.id ?? `${linenItemId}-${index}`),
        linen_item_id: linenItemId,
        name,
        qty,
        is_dayuse: Boolean(event.is_dayuse),
        status: event.status ? String(event.status) : null,
      };
    })
    .filter((row) => row.qty > 0);
}

export function formatLinenSummaryLines(rows: Array<{ name: string; qty: number }>) {
  return rows.map((row) => `${row.name}: ${row.qty} ชิ้น`).join("\n");
}

export function toResolvedRewashSummaryRows(events: RewashSummarySource[] | null | undefined): LinenSummaryRow[] {
  const rows = new Map<string, LinenSummaryRow>();

  for (const event of events ?? []) {
    const linenItemId = Number(event.linen_item_id ?? 0);
    const qty = Number(event.resolved_qty ?? event.qty ?? 0);
    if (linenItemId <= 0 || qty <= 0) continue;

    const name = String(event.name_th ?? event.item_name_th ?? `Item ${linenItemId}`);
    const key = `${linenItemId}:${Boolean(event.is_dayuse)}`;
    const existing = rows.get(key);
    rows.set(key, {
      id: existing?.id ?? String(event.id ?? key),
      linen_item_id: linenItemId,
      name,
      qty: (existing?.qty ?? 0) + qty,
      is_dayuse: Boolean(event.is_dayuse),
      status: event.status ? String(event.status) : null,
    });
  }

  return [...rows.values()];
}

type ReturnEventSource = {
  event_type?: string | null;
  data?: Record<string, unknown> | null;
};

type LinenNameSource = {
  linen_item_id?: number | string | null;
  name_th?: string | null;
  source_batch_id?: string | null;
  source_business_date?: string | null;
  source_pickup_round?: number | string | null;
};

type ReturnEventItem = {
  pending_item_id?: string | null;
  source_batch_id?: string | null;
  linen_item_id?: number | string | null;
  received_qty?: number | string | null;
  returned_pending_qty?: number | string | null;
  qty?: number | string | null;
  pending_qty?: number | string | null;
  is_dayuse?: boolean | null;
};

export type ReturnSummaryRow = {
  id: string;
  linen_item_id: number;
  name: string;
  qty: number;
  is_dayuse: boolean;
  source: "normal" | "pending_resolved";
};

export type PendingSummarySource = {
  id?: string | null;
  source_batch_id?: string | null;
  linen_item_id?: number | string | null;
  pending_qty?: number | string | null;
  name_th?: string | null;
  source_batch_date?: string | null;
  source_business_date?: string | null;
  source_pickup_round?: number | string | null;
  created_at?: string | null;
};

export type PendingSummaryRow = {
  id: string;
  source_batch_id: string;
  linen_item_id: number;
  name: string;
  qty: number;
  sourceDate: string;
  sourceRound: string;
};

function latestFoReturnEvent(events: ReturnEventSource[] | null | undefined) {
  return [...(events ?? [])].reverse().find((event) => event.event_type === "fo_return_counted");
}

function buildNameByItemId(nameSources: LinenNameSource[] | null | undefined) {
  const nameByItemId = new Map<number, string>();
  for (const item of nameSources ?? []) {
    const itemId = Number(item.linen_item_id ?? 0);
    if (itemId > 0 && item.name_th) nameByItemId.set(itemId, item.name_th);
  }
  return nameByItemId;
}

export function toReturnSummaryRows(
  events: ReturnEventSource[] | null | undefined,
  nameSources: LinenNameSource[] | null | undefined = []
): ReturnSummaryRow[] {
  const latestReturnEvent = latestFoReturnEvent(events);
  if (!latestReturnEvent?.data) return [];

  const nameByItemId = buildNameByItemId(nameSources);

  const rows = new Map<string, ReturnSummaryRow>();
  const addRow = (
    item: ReturnEventItem,
    qtyField: "received_qty" | "qty",
    source: ReturnSummaryRow["source"],
    qtyOverride?: number
  ) => {
    const itemId = Number(item.linen_item_id ?? 0);
    const qty = qtyOverride ?? Number(item[qtyField] ?? 0);
    if (itemId <= 0 || qty <= 0) return;
    const key = `${source}:${itemId}:${Boolean(item.is_dayuse)}`;
    const baseName = nameByItemId.get(itemId) ?? `Item ${itemId}`;
    const name = item.is_dayuse ? `${baseName} (Day Use)` : baseName;
    const existing = rows.get(key);
    rows.set(key, {
      id: existing?.id ?? key,
      linen_item_id: itemId,
      name,
      qty: (existing?.qty ?? 0) + qty,
      is_dayuse: Boolean(item.is_dayuse),
      source,
    });
  };

  const returns = Array.isArray(latestReturnEvent.data.returns) ? latestReturnEvent.data.returns : [];
  const resolved = Array.isArray(latestReturnEvent.data.resolved) ? latestReturnEvent.data.resolved : [];
  for (const item of resolved as ReturnEventItem[]) addRow(item, "qty", "pending_resolved");
  for (const item of returns as ReturnEventItem[]) {
    const receivedQty = Number(item.received_qty ?? 0);
    const returnedPendingQty = Math.min(receivedQty, Math.max(0, Number(item.returned_pending_qty ?? 0)));
    addRow(item, "received_qty", "pending_resolved", returnedPendingQty);
    addRow(item, "received_qty", "normal", receivedQty - returnedPendingQty);
  }

  return [...rows.values()];
}

export function formatReturnSummaryLines(rows: Array<{ name: string; qty: number; source?: string }>) {
  const pendingRows = rows.filter((row) => row.source === "pending_resolved");
  const normalRows = rows.filter((row) => row.source !== "pending_resolved");
  const lines: string[] = [];

  if (pendingRows.length > 0) {
    lines.push(...pendingRows.map((row) => `${row.name}: ${row.qty} ชิ้น (คืนผ้าค้าง)`));
  }
  if (pendingRows.length > 0 && normalRows.length > 0) {
    lines.push("--------------------");
  }
  if (normalRows.length > 0) {
    lines.push(...normalRows.map((row) => `${row.name}: ${row.qty} ชิ้น`));
  }

  return lines.join("\n");
}

export function formatReturnSummaryRowsForDisplay(rows: ReturnSummaryRow[]) {
  return rows.map((row) => ({
    name: row.source === "pending_resolved" ? `${row.name} (คืนผ้าค้าง)` : row.name,
    qty: row.qty,
  }));
}

export function toAdjustedPendingSummaryRows(
  pendingItems: PendingSummarySource[] | null | undefined,
  events: ReturnEventSource[] | null | undefined,
  nameSources: LinenNameSource[] | null | undefined = []
): PendingSummaryRow[] {
  const latestReturnEvent = latestFoReturnEvent(events);
  const returns = latestReturnEvent?.data && Array.isArray(latestReturnEvent.data.returns)
    ? (latestReturnEvent.data.returns as ReturnEventItem[])
    : [];
  const resolved = latestReturnEvent?.data && Array.isArray(latestReturnEvent.data.resolved)
    ? (latestReturnEvent.data.resolved as ReturnEventItem[])
    : [];

  const nameByItemId = buildNameByItemId(nameSources);
  const sourceByKey = new Map<string, { date: string; round: string }>();
  for (const source of nameSources ?? []) {
    const sourceBatchId = String(source.source_batch_id ?? "");
    const itemId = Number(source.linen_item_id ?? 0);
    if (!sourceBatchId || itemId <= 0) continue;
    sourceByKey.set(`${sourceBatchId}:${itemId}`, {
      date: source.source_business_date ? String(source.source_business_date) : "",
      round: source.source_pickup_round ? String(source.source_pickup_round) : "",
    });
  }

  const replacementByKey = new Map<string, PendingSummaryRow>();
  const returnedKeys = new Set<string>();
  for (const item of returns) {
    const sourceBatchId = String(item.source_batch_id ?? "");
    const itemId = Number(item.linen_item_id ?? 0);
    if (!sourceBatchId || itemId <= 0) continue;
    const key = `${sourceBatchId}:${itemId}`;
    returnedKeys.add(key);
    const pendingQty = Number(item.pending_qty ?? 0);
    if (pendingQty <= 0) continue;
    const source = sourceByKey.get(key);
    const existing = replacementByKey.get(key);
    replacementByKey.set(key, {
      id: existing?.id ?? `current-${key}`,
      source_batch_id: sourceBatchId,
      linen_item_id: itemId,
      name: nameByItemId.get(itemId) ?? `Item ${itemId}`,
      qty: (existing?.qty ?? 0) + pendingQty,
      sourceDate: existing?.sourceDate ?? source?.date ?? "",
      sourceRound: existing?.sourceRound ?? source?.round ?? "",
    });
  }

  const resolvedPendingIds = new Set(
    resolved.map((item) => String(item.pending_item_id ?? "")).filter(Boolean)
  );

  const rowsByKey = new Map<string, PendingSummaryRow>();
  for (const item of pendingItems ?? []) {
    const sourceBatchId = String(item.source_batch_id ?? "");
    const itemId = Number(item.linen_item_id ?? 0);
    const qty = Number(item.pending_qty ?? 0);
    if (!sourceBatchId || itemId <= 0 || qty <= 0) continue;
    const key = `${sourceBatchId}:${itemId}`;
    if (returnedKeys.has(key) || resolvedPendingIds.has(String(item.id ?? ""))) continue;
    const existing = rowsByKey.get(key);
    rowsByKey.set(key, {
      id: existing?.id ?? String(item.id ?? key),
      source_batch_id: sourceBatchId,
      linen_item_id: itemId,
      name: item.name_th ?? nameByItemId.get(itemId) ?? `Item ${itemId}`,
      qty: (existing?.qty ?? 0) + qty,
      sourceDate: existing?.sourceDate ?? String(item.source_batch_date ?? item.source_business_date ?? ""),
      sourceRound: existing?.sourceRound ?? String(item.source_pickup_round ?? ""),
    });
  }

  return [...replacementByKey.values(), ...rowsByKey.values()].filter((row) => row.qty > 0);
}

export function formatPendingSummaryLines(rows: PendingSummaryRow[]) {
  return rows.map((item) => {
    const source = item.sourceDate
      ? ` (ค้างจาก ${item.sourceDate}${item.sourceRound ? ` รอบ ${item.sourceRound}` : ""})`
      : "";
    return `${item.name}: ${item.qty} ชิ้น${source}`;
  }).join("\n");
}
