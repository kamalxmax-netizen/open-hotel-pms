export type RewashSummarySource = {
  id?: string | number | null;
  linen_item_id?: number | string | null;
  name_th?: string | null;
  item_name_th?: string | null;
  qty?: number | string | null;
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

type ReturnEventSource = {
  event_type?: string | null;
  data?: Record<string, unknown> | null;
};

type LinenNameSource = {
  linen_item_id?: number | string | null;
  name_th?: string | null;
};

type ReturnEventItem = {
  linen_item_id?: number | string | null;
  received_qty?: number | string | null;
  qty?: number | string | null;
  is_dayuse?: boolean | null;
};

export function toReturnSummaryRows(
  events: ReturnEventSource[] | null | undefined,
  nameSources: LinenNameSource[] | null | undefined = []
): Array<{ name: string; qty: number }> {
  const latestReturnEvent = [...(events ?? [])].reverse().find((event) => event.event_type === "fo_return_counted");
  if (!latestReturnEvent?.data) return [];

  const nameByItemId = new Map<number, string>();
  for (const item of nameSources ?? []) {
    const itemId = Number(item.linen_item_id ?? 0);
    if (itemId > 0 && item.name_th) nameByItemId.set(itemId, item.name_th);
  }

  const rows = new Map<string, { name: string; qty: number }>();
  const addRow = (item: ReturnEventItem, qtyField: "received_qty" | "qty") => {
    const itemId = Number(item.linen_item_id ?? 0);
    const qty = Number(item[qtyField] ?? 0);
    if (itemId <= 0 || qty <= 0) return;
    const key = `${itemId}:${Boolean(item.is_dayuse)}`;
    const baseName = nameByItemId.get(itemId) ?? `Item ${itemId}`;
    const name = item.is_dayuse ? `${baseName} (Day Use)` : baseName;
    const existing = rows.get(key);
    rows.set(key, { name, qty: (existing?.qty ?? 0) + qty });
  };

  const returns = Array.isArray(latestReturnEvent.data.returns) ? latestReturnEvent.data.returns : [];
  const resolved = Array.isArray(latestReturnEvent.data.resolved) ? latestReturnEvent.data.resolved : [];
  for (const item of returns as ReturnEventItem[]) addRow(item, "received_qty");
  for (const item of resolved as ReturnEventItem[]) addRow(item, "qty");

  return [...rows.values()];
}
