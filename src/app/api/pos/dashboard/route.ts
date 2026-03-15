import { createServerSupabaseClient } from "@/lib/supabase/server";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

export const dynamic = "force-dynamic";
export const fetchCache = "force-no-store";

const querySchema = z.object({
  date_from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  date_to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
});

function thailandDateString(): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Bangkok",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date());
  const y = parts.find((p) => p.type === "year")?.value;
  const m = parts.find((p) => p.type === "month")?.value;
  const d = parts.find((p) => p.type === "day")?.value;
  return `${y}-${m}-${d}`;
}

export async function GET(request: NextRequest) {
  try {
    const parsed = querySchema.safeParse({
      date_from: request.nextUrl.searchParams.get("date_from") ?? undefined,
      date_to: request.nextUrl.searchParams.get("date_to") ?? undefined,
    });

    if (!parsed.success) {
      return NextResponse.json(
        { success: false, error: "Invalid query.", details: parsed.error.flatten() },
        { status: 400 }
      );
    }

    const today = thailandDateString();
    const dateFrom = parsed.data.date_from ?? today;
    const dateTo = parsed.data.date_to ?? today;

    const supabase = createServerSupabaseClient();

    const { data: orders, error: ordersError } = await supabase
      .from("pos_orders")
      .select("id, order_type, status, total, payment_method, order_date")
      .gte("order_date", dateFrom)
      .lte("order_date", dateTo);

    if (ordersError) {
      return NextResponse.json({ success: false, error: ordersError.message }, { status: 500 });
    }

    const orderIds = (orders ?? []).map((row) => row.id);

    const { data: orderItems, error: itemsError } = await supabase
      .from("pos_order_items")
      .select("order_id, product_id, product_name, quantity, line_total")
      .in("order_id", orderIds.length > 0 ? orderIds : ["00000000-0000-0000-0000-000000000000"]);

    if (itemsError) {
      return NextResponse.json({ success: false, error: itemsError.message }, { status: 500 });
    }

    const ordersList = orders ?? [];
    const itemsList = orderItems ?? [];
    const completedOrders = ordersList.filter((row) => row.status === "completed");
    const voidedOrders = ordersList.filter((row) => row.status === "voided");

    const totalSales = completedOrders.reduce((sum, row) => sum + Number(row.total ?? 0), 0);
    const walkinSales = completedOrders
      .filter((row) => row.order_type === "walkin")
      .reduce((sum, row) => sum + Number(row.total ?? 0), 0);
    const guestChargeSales = completedOrders
      .filter((row) => row.order_type === "guest_charge")
      .reduce((sum, row) => sum + Number(row.total ?? 0), 0);

    const completedOrderIdSet = new Set(completedOrders.map((row) => row.id));
    const soldItems = itemsList.filter((item) => completedOrderIdSet.has(item.order_id));

    const totalItemsSold = soldItems.reduce((sum, item) => sum + Number(item.quantity ?? 0), 0);

    const paymentBreakdown = completedOrders.reduce<Record<string, number>>((acc, order) => {
      const key = order.order_type === "guest_charge" ? "guest_charge" : order.payment_method || "unknown";
      acc[key] = (acc[key] ?? 0) + Number(order.total ?? 0);
      return acc;
    }, {});

    const topProductsMap = new Map<
      string,
      { product_id: string; product_name: string; quantity: number; amount: number }
    >();

    for (const item of soldItems) {
      const key = String(item.product_id);
      const existing = topProductsMap.get(key) ?? {
        product_id: key,
        product_name: String(item.product_name ?? "Unknown"),
        quantity: 0,
        amount: 0,
      };
      existing.quantity += Number(item.quantity ?? 0);
      existing.amount += Number(item.line_total ?? 0);
      topProductsMap.set(key, existing);
    }

    const topProducts = Array.from(topProductsMap.values())
      .sort((a, b) => b.amount - a.amount)
      .slice(0, 10)
      .map((row) => ({ ...row, amount: Number(row.amount.toFixed(2)) }));

    const dailySeriesMap = new Map<string, { date: string; sales: number; orders: number }>();
    for (const order of completedOrders) {
      const key = String(order.order_date);
      const slot = dailySeriesMap.get(key) ?? { date: key, sales: 0, orders: 0 };
      slot.sales += Number(order.total ?? 0);
      slot.orders += 1;
      dailySeriesMap.set(key, slot);
    }

    const dailySeries = Array.from(dailySeriesMap.values())
      .sort((a, b) => a.date.localeCompare(b.date))
      .map((row) => ({ ...row, sales: Number(row.sales.toFixed(2)) }));

    return NextResponse.json({
      success: true,
      range: { date_from: dateFrom, date_to: dateTo },
      summary: {
        completed_orders: completedOrders.length,
        voided_orders: voidedOrders.length,
        total_sales: Number(totalSales.toFixed(2)),
        total_items_sold: totalItemsSold,
        walkin_sales: Number(walkinSales.toFixed(2)),
        guest_charge_sales: Number(guestChargeSales.toFixed(2)),
      },
      payment_breakdown: paymentBreakdown,
      top_products: topProducts,
      daily_series: dailySeries,
    });
  } catch (err) {
    console.error("pos/dashboard GET failed", err);
    const message = err instanceof Error ? err.message : "Internal server error";
    return NextResponse.json({ success: false, error: message }, { status: 500 });
  }
}
