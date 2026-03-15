import { createServerSupabaseClient } from "@/lib/supabase/server";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

const transferSchema = z.object({
  product_id: z.string().uuid(),
  floor_number: z.number().int().min(1),
  quantity: z.number().int().min(1),
  note: z.string().trim().max(500).optional(),
  performed_by: z.string().trim().max(120).optional(),
});

function isFunctionMissing(error: { code?: string | null; message?: string | null } | null): boolean {
  const message = String(error?.message ?? "").toLowerCase();
  return error?.code === "42883" || message.includes("could not find the function") || message.includes("schema cache");
}

export async function POST(request: NextRequest) {
  try {
    const json = await request.json().catch(() => null);
    const parsed = transferSchema.safeParse(json);
    if (!parsed.success) {
      return NextResponse.json(
        { success: false, error: "Invalid payload.", details: parsed.error.flatten() },
        { status: 400 }
      );
    }

    const body = parsed.data;
    const supabase = createServerSupabaseClient();

    const { data: rpcData, error: rpcError } = await supabase.rpc("stock_transfer", {
      p_product_id: body.product_id,
      p_floor_number: body.floor_number,
      p_quantity: body.quantity,
      p_note: body.note?.trim() || null,
      p_performed_by: body.performed_by?.trim() || null,
    });

    if (!rpcError) {
      return NextResponse.json({
        success: true,
        mode: "atomic_rpc",
        transfer: rpcData,
      });
    }

    const message = String(rpcError.message ?? "Stock transfer failed.");
    if (!isFunctionMissing(rpcError)) {
      if (message.toLowerCase().includes("insufficient")) {
        return NextResponse.json({ success: false, error: message }, { status: 409 });
      }
      return NextResponse.json({ success: false, error: message }, { status: 500 });
    }

    return NextResponse.json({
      success: false,
      error:
        "DB migration required: apply 20260302_phase10_pos_inventory.sql and reload schema to enable stock_transfer RPC.",
      details: message,
    });
  } catch (err) {
    console.error("stock/transfer POST failed", err);
    const message = err instanceof Error ? err.message : "Internal server error";
    return NextResponse.json({ success: false, error: message }, { status: 500 });
  }
}
