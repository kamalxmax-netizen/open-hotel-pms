import { createServerSupabaseClient } from "@/lib/supabase/server";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

const paramsSchema = z.object({
  id: z.string().uuid("Invalid order id"),
});

const voidSchema = z.object({
  note: z.string().trim().max(500).optional(),
  voided_by: z.string().trim().max(120).optional(),
});

function isRpcMissing(error: { code?: string | null; message?: string | null } | null): boolean {
  const message = String(error?.message ?? "").toLowerCase();
  return error?.code === "42883" || message.includes("could not find the function") || message.includes("schema cache");
}

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

async function fallbackVoidOrder(
  supabase: ReturnType<typeof createServerSupabaseClient>,
  orderId: string,
  note: string | null,
  voidedBy: string | null
) {
  const { data: order, error: orderError } = await supabase
    .from("pos_orders")
    .select("id, order_number, order_type, reservation_id, status, total, note")
    .eq("id", orderId)
    .single();

  if (orderError || !order) throw new Error("Order not found");
  if (order.status === "voided") {
    const err = new Error("Order already voided");
    (err as any).code = "ORDER_ALREADY_VOIDED";
    throw err;
  }
  if (order.status !== "completed") {
    const err = new Error("Only completed orders can be voided");
    (err as any).code = "ORDER_NOT_COMPLETED";
    throw err;
  }

  const nowIso = new Date().toISOString();
  const today = thailandDateString();

  const mergedNote = note ? `${order.note ?? ""}${order.note ? "\n" : ""}VOID: ${note}` : order.note;
  const { error: updateError } = await supabase
    .from("pos_orders")
    .update({ status: "voided", note: mergedNote ?? null, updated_at: nowIso })
    .eq("id", orderId);
  if (updateError) throw new Error(updateError.message);

  const { data: items, error: itemsError } = await supabase
    .from("pos_order_items")
    .select("product_id, quantity")
    .eq("order_id", orderId);
  if (itemsError) throw new Error(itemsError.message);

  for (const item of items ?? []) {
    const qty = Number(item.quantity ?? 0);

    const { error: ensureError } = await supabase
      .from("main_stock")
      .upsert({ product_id: item.product_id, quantity: 0, reorder_level: 10, updated_at: nowIso }, { onConflict: "product_id" });
    if (ensureError) throw new Error(ensureError.message);

    const { error: addError } = await supabase
      .from("main_stock")
      .update({ updated_at: nowIso })
      .eq("product_id", item.product_id);
    if (addError) throw new Error(addError.message);

    const { data: mainRow, error: mainRowError } = await supabase
      .from("main_stock")
      .select("quantity")
      .eq("product_id", item.product_id)
      .single();
    if (mainRowError || !mainRow) throw new Error(mainRowError?.message || "Main stock not found");

    const { error: qtyError } = await supabase
      .from("main_stock")
      .update({ quantity: Number(mainRow.quantity ?? 0) + qty, updated_at: nowIso })
      .eq("product_id", item.product_id);
    if (qtyError) throw new Error(qtyError.message);

    const { error: txError } = await supabase.from("stock_transactions_v2").insert({
      transaction_date: today,
      product_id: item.product_id,
      action: "return",
      quantity_change: qty,
      from_location: null,
      to_location: "main",
      reference_type: "pos_order",
      reference_id: orderId,
      performed_by: voidedBy,
      note: note ?? "POS order void return",
    });
    if (txError) throw new Error(txError.message);
  }

  let refundPaymentId: string | null = null;
  if (order.order_type === "guest_charge" && order.reservation_id && Number(order.total ?? 0) > 0) {
    const { data: refund, error: refundError } = await supabase
      .from("folio_payments")
      .insert({
        reservation_id: order.reservation_id,
        tx_type: "refund",
        method: "other",
        amount: order.total,
        note: note ?? `POS void refund ${order.order_number}`,
        paid_at: nowIso,
        paid_date: today,
        pos_order_id: order.id,
      })
      .select("id")
      .single();
    if (refundError) throw new Error(refundError.message);
    refundPaymentId = refund.id;
  }

  return {
    order_id: order.id,
    order_number: order.order_number,
    status: "voided",
    refund_payment_id: refundPaymentId,
  };
}

export async function POST(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const parsedParams = paramsSchema.safeParse(params);
    if (!parsedParams.success) {
      return NextResponse.json({ success: false, error: "Invalid order id." }, { status: 400 });
    }

    const json = await request.json().catch(() => null);
    const parsedBody = voidSchema.safeParse(json ?? {});
    if (!parsedBody.success) {
      return NextResponse.json(
        { success: false, error: "Invalid payload.", details: parsedBody.error.flatten() },
        { status: 400 }
      );
    }

    const orderId = parsedParams.data.id;
    const note = parsedBody.data.note?.trim() || null;
    const voidedBy = parsedBody.data.voided_by?.trim() || null;
    const supabase = createServerSupabaseClient();

    const { data: rpcData, error: rpcError } = await supabase.rpc("pos_void_order_v2", {
      p_order_id: orderId,
      p_note: note,
      p_voided_by: voidedBy,
    });

    if (!rpcError) {
      return NextResponse.json({ success: true, mode: "atomic_rpc", result: rpcData });
    }

    if (!isRpcMissing(rpcError)) {
      const message = rpcError.message || "Failed to void order";
      if (message.toLowerCase().includes("already voided")) {
        return NextResponse.json({ success: false, error: message }, { status: 409 });
      }
      return NextResponse.json({ success: false, error: message }, { status: 500 });
    }

    const { data: order, error: orderLookupError } = await supabase
      .from("pos_orders")
      .select("id, order_type, reservation_id")
      .eq("id", orderId)
      .maybeSingle();

    if (orderLookupError) {
      return NextResponse.json({ success: false, error: orderLookupError.message }, { status: 500 });
    }

    if (order?.order_type === "guest_charge" && order?.reservation_id) {
      return NextResponse.json(
        { success: false, error: "POS deposit settlement migration is required before room-linked POS void can be used." },
        { status: 409 }
      );
    }

    const result = await fallbackVoidOrder(supabase, orderId, note, voidedBy);
    return NextResponse.json({ success: true, mode: "legacy_fallback", result });
  } catch (err: any) {
    console.error("pos/orders/:id/void POST failed", err);
    if (err?.code === "ORDER_ALREADY_VOIDED" || err?.code === "ORDER_NOT_COMPLETED") {
      return NextResponse.json({ success: false, error: err.message }, { status: 409 });
    }
    const message = err instanceof Error ? err.message : "Internal server error";
    return NextResponse.json({ success: false, error: message }, { status: 500 });
  }
}
