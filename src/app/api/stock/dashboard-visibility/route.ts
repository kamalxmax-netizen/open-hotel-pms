import { createServerSupabaseClient } from "@/lib/supabase/server";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

const payloadSchema = z.object({
  product_id: z.string().uuid(),
  show_on_inventory_dashboard: z.boolean(),
});

export async function POST(request: NextRequest) {
  try {
    const json = await request.json().catch(() => null);
    const parsed = payloadSchema.safeParse(json);
    if (!parsed.success) {
      return NextResponse.json(
        { success: false, error: "Invalid payload.", details: parsed.error.flatten() },
        { status: 400 }
      );
    }

    const { product_id, show_on_inventory_dashboard } = parsed.data;
    const supabase = createServerSupabaseClient();

    const { data, error } = await supabase
      .from("products")
      .update({ show_on_inventory_dashboard })
      .eq("id", product_id)
      .select("id, name, show_on_inventory_dashboard")
      .single();

    if (error) {
      if (error.code === "PGRST116") {
        return NextResponse.json({ success: false, error: "Product not found." }, { status: 404 });
      }
      const message = String(error.message ?? "").toLowerCase();
      if (message.includes("show_on_inventory_dashboard")) {
        return NextResponse.json(
          {
            success: false,
            error:
              "DB migration required: apply 20260303_phase11_inventory_dashboard_visibility.sql before updating dashboard visibility.",
          },
          { status: 500 }
        );
      }
      return NextResponse.json({ success: false, error: error.message }, { status: 500 });
    }

    return NextResponse.json({
      success: true,
      product: data,
    });
  } catch (err) {
    console.error("stock/dashboard-visibility POST failed", err);
    const message = err instanceof Error ? err.message : "Internal server error";
    return NextResponse.json({ success: false, error: message }, { status: 500 });
  }
}
