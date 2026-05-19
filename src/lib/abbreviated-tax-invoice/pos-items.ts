export type PosItemRow = {
  order_id: string;
  order_number: string;
  order_date: string;
  product_id: string;
  label_th: string;
  quantity: number;
  unit_price: number;
  amount: number;
};

type RawPosItemQueryRow = {
  order_id?: unknown;
  product_id?: unknown;
  quantity?: unknown;
  unit_price?: unknown;
  line_total?: unknown;
  pos_orders?: unknown;
  products?: unknown;
};

function str(value: unknown): string {
  return String(value ?? "").trim();
}

function round2(value: unknown): number {
  const n = Number(value ?? 0);
  return Number.isFinite(n) ? Math.round(n * 100) / 100 : 0;
}

function firstRelation(value: unknown): Record<string, unknown> {
  const item = Array.isArray(value) ? value[0] : value;
  return item && typeof item === "object" ? (item as Record<string, unknown>) : {};
}

export function mapCompletedPositivePosItemRows(data: unknown[]): PosItemRow[] {
  return (data as RawPosItemQueryRow[])
    .map((row) => {
      const order = firstRelation(row.pos_orders);
      const product = firstRelation(row.products);
      const amount = round2(row.line_total);

      return {
        order,
        amount,
        productEnabled: product.pos_abbreviated_enabled === true,
        item: {
          order_id: str(row.order_id),
          order_number: str(order.order_number),
          order_date: str(order.order_date),
          product_id: str(row.product_id),
          label_th: str(product.name_th) || str(product.name),
          quantity: Number(row.quantity ?? 0),
          unit_price: round2(row.unit_price),
          amount,
        },
      };
    })
    .filter(({ order, amount, productEnabled, item }) => {
      if (str(order.status) !== "completed") return false;
      if (!productEnabled) return false;
      if (amount <= 0) return false;
      return Boolean(item.order_id && item.product_id && item.label_th);
    })
    .map(({ item }) => item);
}
