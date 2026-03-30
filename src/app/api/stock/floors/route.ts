import { createServerSupabaseClient } from "@/lib/supabase/server";
import { NextRequest, NextResponse } from "next/server";

export const dynamic = "force-dynamic";
export const fetchCache = "force-no-store";
const STOCK_FLOORS = [1, 2, 3] as const;

async function ensureFloorStockCoverage(
  supabase: ReturnType<typeof createServerSupabaseClient>,
  floorNumber?: number
): Promise<string | null> {
  const floorNumbers =
    floorNumber == null
      ? STOCK_FLOORS
      : STOCK_FLOORS.includes(floorNumber as (typeof STOCK_FLOORS)[number])
        ? [floorNumber as (typeof STOCK_FLOORS)[number]]
        : [];

  if (floorNumbers.length === 0) return null;

  const { data: products, error: productsError } = await supabase
    .from("products")
    .select("id, category")
    .eq("is_active", true);

  if (productsError) return productsError.message;

  const productIds = Array.from(
    new Set(
      (products ?? [])
        .filter((row: any) => String(row.category ?? "").trim().toLowerCase() !== "pos")
        .map((row: any) => String(row.id ?? ""))
        .filter(Boolean)
    )
  );

  if (productIds.length === 0) return null;

  const nowIso = new Date().toISOString();
  const seedRows = floorNumbers.flatMap((currentFloor) =>
    productIds.map((productId) => ({
      floor_number: currentFloor,
      product_id: productId,
      quantity: 0,
      updated_at: nowIso,
    }))
  );

  const { error: ensureError } = await supabase
    .from("floor_stock")
    .upsert(seedRows, { onConflict: "floor_number,product_id", ignoreDuplicates: true });

  if (ensureError) return ensureError.message;
  return null;
}

export async function GET(request: NextRequest) {
  try {
    const supabase = createServerSupabaseClient();
    const floorParam = request.nextUrl.searchParams.get("floor_number");
    let parsedFloorNumber: number | undefined;

    if (floorParam) {
      const floorNumber = Number(floorParam);
      if (!Number.isInteger(floorNumber) || floorNumber <= 0) {
        return NextResponse.json({ success: false, error: "Invalid floor_number." }, { status: 400 });
      }
      parsedFloorNumber = floorNumber;
    }

    const coverageError = await ensureFloorStockCoverage(supabase, parsedFloorNumber);
    if (coverageError) {
      return NextResponse.json({ success: false, error: coverageError }, { status: 500 });
    }

    let query = supabase
      .from("floor_stock")
      .select(`
        id,
        floor_number,
        product_id,
        quantity,
        updated_at,
        products!inner(id, name, sku, category, unit, is_active, display_order)
      `)
      .order("floor_number", { ascending: true })
      .order("display_order", { ascending: true, foreignTable: "products" })
      .order("name", { ascending: true, foreignTable: "products" })
      .order("updated_at", { ascending: false });

    if (parsedFloorNumber != null) {
      query = query.eq("floor_number", parsedFloorNumber);
    }

    const { data, error } = await query;
    if (error) {
      return NextResponse.json({ success: false, error: error.message }, { status: 500 });
    }

    const rows = (data ?? [])
      .map((row: any) => ({
        id: row.id,
        floor_number: Number(row.floor_number ?? 0),
        product_id: row.product_id,
        product_name: row.products?.name ?? null,
        sku: row.products?.sku ?? null,
        category: row.products?.category ?? null,
        unit: row.products?.unit ?? null,
        display_order: Number(row.products?.display_order ?? 9999),
        quantity: Number(row.quantity ?? 0),
        updated_at: row.updated_at,
        is_active: Boolean(row.products?.is_active),
      }))
      .filter((row) => row.is_active && String(row.category ?? "").trim().toLowerCase() !== "pos");

    const floors: Record<string, typeof rows> = {};
    for (const row of rows) {
      const key = String(row.floor_number);
      if (!floors[key]) floors[key] = [];
      floors[key].push(row);
    }

    return NextResponse.json({ success: true, stocks: rows, floors });
  } catch (err) {
    console.error("stock/floors GET failed", err);
    const message = err instanceof Error ? err.message : "Internal server error";
    return NextResponse.json({ success: false, error: message }, { status: 500 });
  }
}
