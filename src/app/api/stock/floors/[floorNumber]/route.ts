import { createServerSupabaseClient } from "@/lib/supabase/server";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

const paramsSchema = z.object({
  floorNumber: z
    .string()
    .transform((value) => Number(value))
    .refine((value) => Number.isInteger(value) && value > 0, "Invalid floor number"),
});

const floorStockUpdateSchema = z.discriminatedUnion("action", [
  z.object({
    action: z.literal("receive"),
    product_id: z.string().uuid(),
    quantity: z.number().int().min(1).max(999999),
    note: z.string().trim().max(500).optional(),
    performed_by: z.string().trim().max(120).optional(),
  }),
  z.object({
    action: z.literal("adjust"),
    product_id: z.string().uuid(),
    new_quantity: z.number().int().min(0).max(999999),
    note: z.string().trim().max(500).optional(),
    performed_by: z.string().trim().max(120).optional(),
  }),
]);

export async function PUT(
  request: NextRequest,
  { params }: { params: { floorNumber: string } }
) {
  try {
    const parsedParams = paramsSchema.safeParse(params);
    if (!parsedParams.success) {
      return NextResponse.json({ success: false, error: "Invalid floor number." }, { status: 400 });
    }

    const json = await request.json().catch(() => null);
    const parsedBody = floorStockUpdateSchema.safeParse(json);
    if (!parsedBody.success) {
      return NextResponse.json(
        { success: false, error: "Invalid payload.", details: parsedBody.error.flatten() },
        { status: 400 }
      );
    }

    const floorNumber = parsedParams.data.floorNumber;
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
      .select("id, name, category, is_active")
      .eq("id", body.product_id)
      .single();

    if (productError || !product) {
      return NextResponse.json({ success: false, error: "Product not found." }, { status: 404 });
    }

    if (!product.is_active) {
      return NextResponse.json({ success: false, error: "Inactive product cannot be stocked on floors." }, { status: 400 });
    }

    if (String(product.category ?? "").trim().toLowerCase() === "pos") {
      return NextResponse.json({ success: false, error: "POS products are main-stock only and cannot be stocked on floors." }, { status: 400 });
    }

    const { error: ensureError } = await supabase
      .from("floor_stock")
      .upsert(
        {
          floor_number: floorNumber,
          product_id: body.product_id,
          quantity: 0,
          updated_at: nowIso,
        },
        { onConflict: "floor_number,product_id", ignoreDuplicates: true }
      );

    if (ensureError) {
      return NextResponse.json({ success: false, error: ensureError.message }, { status: 500 });
    }

    const { data: current, error: currentError } = await supabase
      .from("floor_stock")
      .select("id, quantity")
      .eq("floor_number", floorNumber)
      .eq("product_id", body.product_id)
      .single();

    if (currentError || !current) {
      return NextResponse.json({ success: false, error: "Floor stock row not found." }, { status: 500 });
    }

    const beforeQty = Number(current.quantity ?? 0);
    const afterQty = body.action === "receive" ? beforeQty + body.quantity : body.new_quantity;
    const delta = afterQty - beforeQty;

    const { data: updated, error: updateError } = await supabase
      .from("floor_stock")
      .update({ quantity: afterQty, updated_at: nowIso })
      .eq("floor_number", floorNumber)
      .eq("product_id", body.product_id)
      .select("id, floor_number, product_id, quantity, updated_at")
      .single();

    if (updateError) {
      return NextResponse.json({ success: false, error: updateError.message }, { status: 500 });
    }

    const { error: txError } = await supabase.from("stock_transactions_v2").insert({
      transaction_date: thailandDate,
      product_id: body.product_id,
      action: body.action === "receive" ? "receive" : "adjust",
      quantity_change: delta,
      from_location: body.action === "receive" ? null : `floor_${floorNumber}`,
      to_location: `floor_${floorNumber}`,
      reference_type: "manual",
      reference_id: null,
      room_number: null,
      floor_number: floorNumber,
      performed_by: body.performed_by?.trim() || null,
      note: body.note?.trim() || null,
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
    console.error("stock/floors/:floorNumber PUT failed", err);
    const message = err instanceof Error ? err.message : "Internal server error";
    return NextResponse.json({ success: false, error: message }, { status: 500 });
  }
}
