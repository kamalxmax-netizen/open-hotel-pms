import { createServerSupabaseClient } from "@/lib/supabase/server";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

const paramsSchema = z.object({
  productId: z.string().uuid("Invalid product id"),
});

const stockUpdateSchema = z.discriminatedUnion("action", [
  z.object({
    action: z.literal("receive"),
    quantity: z.number().int().min(1).max(999999),
    note: z.string().trim().max(500).optional(),
    performed_by: z.string().trim().max(120).optional(),
  }),
  z.object({
    action: z.literal("adjust"),
    new_quantity: z.number().int().min(0).max(999999),
    note: z.string().trim().max(500).optional(),
    performed_by: z.string().trim().max(120).optional(),
  }),
]);

export async function PUT(
  request: NextRequest,
  { params }: { params: { productId: string } }
) {
  try {
    const parsedParams = paramsSchema.safeParse(params);
    if (!parsedParams.success) {
      return NextResponse.json({ success: false, error: "Invalid product id." }, { status: 400 });
    }

    const json = await request.json().catch(() => null);
    const parsedBody = stockUpdateSchema.safeParse(json);
    if (!parsedBody.success) {
      return NextResponse.json(
        { success: false, error: "Invalid payload.", details: parsedBody.error.flatten() },
        { status: 400 }
      );
    }

    const productId = parsedParams.data.productId;
    const body = parsedBody.data;
    const nowIso = new Date().toISOString();
    const thailandDate = new Date(
      new Date().toLocaleString("en-US", { timeZone: "Asia/Bangkok" })
    )
      .toISOString()
      .slice(0, 10);

    const supabase = createServerSupabaseClient();

    const { data: product, error: productError } = await supabase
      .from("products")
      .select("id, name")
      .eq("id", productId)
      .single();

    if (productError || !product) {
      return NextResponse.json({ success: false, error: "Product not found." }, { status: 404 });
    }

    const { error: ensureError } = await supabase
      .from("main_stock")
      .upsert(
        { product_id: productId, quantity: 0, reorder_level: 10, updated_at: nowIso },
        { onConflict: "product_id", ignoreDuplicates: true }
      );
    if (ensureError) {
      return NextResponse.json({ success: false, error: ensureError.message }, { status: 500 });
    }

    const { data: current, error: currentError } = await supabase
      .from("main_stock")
      .select("id, quantity, reorder_level")
      .eq("product_id", productId)
      .single();

    if (currentError || !current) {
      return NextResponse.json({ success: false, error: "Main stock row not found." }, { status: 500 });
    }

    const beforeQty = Number(current.quantity ?? 0);
    const afterQty = body.action === "receive" ? beforeQty + body.quantity : body.new_quantity;
    const delta = afterQty - beforeQty;

    const { data: updated, error: updateError } = await supabase
      .from("main_stock")
      .update({ quantity: afterQty, updated_at: nowIso })
      .eq("product_id", productId)
      .select("id, product_id, quantity, reorder_level, updated_at")
      .single();

    if (updateError) {
      return NextResponse.json({ success: false, error: updateError.message }, { status: 500 });
    }

    const txAction = body.action === "receive" ? "receive" : "adjust";
    const txNote = body.note?.trim() || null;

    const { error: txError } = await supabase.from("stock_transactions_v2").insert({
      transaction_date: thailandDate,
      product_id: productId,
      action: txAction,
      quantity_change: delta,
      from_location: body.action === "receive" ? null : "main",
      to_location: "main",
      reference_type: "manual",
      reference_id: null,
      room_number: null,
      floor_number: null,
      performed_by: body.performed_by?.trim() || null,
      note: txNote,
    });

    if (txError) {
      return NextResponse.json({ success: false, error: txError.message }, { status: 500 });
    }

    return NextResponse.json({
      success: true,
      stock: updated,
      product_name: product.name,
      before_quantity: beforeQty,
      after_quantity: Number(updated.quantity ?? 0),
      quantity_change: delta,
    });
  } catch (err) {
    console.error("stock/main/:productId PUT failed", err);
    const message = err instanceof Error ? err.message : "Internal server error";
    return NextResponse.json({ success: false, error: message }, { status: 500 });
  }
}
