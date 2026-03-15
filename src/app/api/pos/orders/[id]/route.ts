import { createServerSupabaseClient } from "@/lib/supabase/server";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

export const fetchCache = "force-no-store";

const paramsSchema = z.object({
  id: z.string().uuid("Invalid order id"),
});

export async function GET(
  _request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const parsedParams = paramsSchema.safeParse(params);
    if (!parsedParams.success) {
      return NextResponse.json({ success: false, error: "Invalid order id." }, { status: 400 });
    }

    const orderId = parsedParams.data.id;
    const supabase = createServerSupabaseClient();

    const { data: order, error: orderError } = await supabase
      .from("pos_orders")
      .select(
        "id, order_number, order_type, reservation_id, guest_name, status, subtotal, total, payment_method, note, created_by, order_date, created_at, updated_at"
      )
      .eq("id", orderId)
      .single();

    if (orderError || !order) {
      return NextResponse.json({ success: false, error: "Order not found." }, { status: 404 });
    }

    const [{ data: items, error: itemsError }, { data: folioPayments, error: folioError }] =
      await Promise.all([
        supabase
          .from("pos_order_items")
          .select("id, order_id, product_id, product_name, quantity, unit_price, line_total, created_at")
          .eq("order_id", orderId)
          .order("created_at", { ascending: true }),
        supabase
          .from("folio_payments")
          .select("id, reservation_id, tx_type, method, amount, note, paid_at, paid_date, pos_order_id, revenue_category, is_record_only")
          .eq("pos_order_id", orderId)
          .order("paid_at", { ascending: true }),
      ]);

    if (itemsError) {
      return NextResponse.json({ success: false, error: itemsError.message }, { status: 500 });
    }
    if (folioError) {
      return NextResponse.json({ success: false, error: folioError.message }, { status: 500 });
    }

    return NextResponse.json({
      success: true,
      order,
      items: items ?? [],
      folio_payments: folioPayments ?? [],
    });
  } catch (err) {
    console.error("pos/orders/:id GET failed", err);
    const message = err instanceof Error ? err.message : "Internal server error";
    return NextResponse.json({ success: false, error: message }, { status: 500 });
  }
}
