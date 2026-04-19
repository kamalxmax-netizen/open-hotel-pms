import { createClient } from "@supabase/supabase-js";
import { NextResponse } from "next/server";
import { z } from "zod";

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

export const dynamic = "force-dynamic";
export const fetchCache = "force-no-store";

const setupRowSchema = z.object({
  room_type_id: z.coerce.number().int().positive(),
  product_id: z.string().uuid(),
  units_per_occupied_night: z.coerce.number().int().min(0).max(50),
});

const postSchema = z.object({
  rows: z.array(setupRowSchema).max(500),
});

export async function GET() {
  try {
    const [roomTypesResult, productsResult, setupsResult] = await Promise.all([
      supabase
        .from("room_types")
        .select("id, code, name_en")
        .neq("code", "CLOSED")
        .order("id", { ascending: true }),
      supabase
        .from("products")
        .select("id, name, stock_tracking_mode")
        .eq("is_active", true)
        .in("stock_tracking_mode", ["amenity_prepare", "amenity_direct"])
        .order("name", { ascending: true }),
      supabase
        .from("room_type_amenity_setups")
        .select("room_type_id, product_id, units_per_occupied_night, updated_at"),
    ]);

    if (roomTypesResult.error) throw roomTypesResult.error;
    if (productsResult.error) throw productsResult.error;
    if (setupsResult.error) throw setupsResult.error;

    const roomTypes = (roomTypesResult.data ?? [])
      .map((row: any) => ({
        id: Number(row.id),
        code: String(row.code ?? ""),
        name_en: String(row.name_en ?? row.code ?? ""),
      }))
      .filter((row) => row.code.toUpperCase() !== "CLOSED" && !row.name_en.toLowerCase().includes("closed"));

    return NextResponse.json({
      success: true,
      data: {
        room_types: roomTypes,
        products: (productsResult.data ?? []).map((row: any) => ({
          id: String(row.id),
          name: String(row.name ?? ""),
          stock_tracking_mode: String(row.stock_tracking_mode ?? ""),
        })),
        setups: setupsResult.data ?? [],
      },
    });
  } catch (err: any) {
    return NextResponse.json({ success: false, error: err.message }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    const json = await request.json().catch(() => null);
    const parsed = postSchema.safeParse(json);
    if (!parsed.success) {
      return NextResponse.json(
        { success: false, error: "Invalid payload.", details: parsed.error.flatten() },
        { status: 400 }
      );
    }

    const rows = parsed.data.rows;
    const { error: deleteError } = await supabase
      .from("room_type_amenity_setups")
      .delete()
      .gte("room_type_id", 0);
    if (deleteError) throw deleteError;

    const rowsToInsert = rows.filter((row) => row.units_per_occupied_night > 0);
    if (rowsToInsert.length > 0) {
      const { error: insertError } = await supabase
        .from("room_type_amenity_setups")
        .upsert(rowsToInsert, { onConflict: "room_type_id,product_id" });
      if (insertError) throw insertError;
    }

    return NextResponse.json({ success: true, saved: rowsToInsert.length });
  } catch (err: any) {
    return NextResponse.json({ success: false, error: err.message }, { status: 500 });
  }
}
