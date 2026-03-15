import { createServerSupabaseClient } from "@/lib/supabase/server";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

export const dynamic = "force-dynamic";
export const fetchCache = "force-no-store";
const STOCK_FLOORS = [1, 2, 3] as const;

const productCreateSchema = z.object({
  name: z.string().trim().min(1, "name is required").max(120),
  sku: z.string().trim().max(80).optional().nullable(),
  category: z.enum(["amenity", "pos", "both"]).default("amenity"),
  fulfillment_mode: z.enum(["standard", "daily_prepare"]).default("standard"),
  unit: z.string().trim().min(1, "unit is required").max(30).default("pieces"),
  sale_price: z.number().min(0).max(9999999).nullable().optional(),
  is_active: z.boolean().optional().default(true),
});

const productQuerySchema = z.object({
  category: z.enum(["amenity", "pos", "both"]).optional(),
  fulfillment_mode: z.enum(["standard", "daily_prepare"]).optional(),
  is_active: z.enum(["true", "false"]).optional(),
  for_sale: z.enum(["true", "false"]).optional(),
  q: z.string().trim().optional(),
});

export async function GET(request: NextRequest) {
  try {
    const parsedQuery = productQuerySchema.safeParse({
      category: request.nextUrl.searchParams.get("category") ?? undefined,
      fulfillment_mode: request.nextUrl.searchParams.get("fulfillment_mode") ?? undefined,
      is_active: request.nextUrl.searchParams.get("is_active") ?? undefined,
      for_sale: request.nextUrl.searchParams.get("for_sale") ?? undefined,
      q: request.nextUrl.searchParams.get("q") ?? undefined,
    });

    if (!parsedQuery.success) {
      return NextResponse.json(
        { success: false, error: "Invalid query.", details: parsedQuery.error.flatten() },
        { status: 400 }
      );
    }

    const { category, fulfillment_mode, is_active, for_sale, q } = parsedQuery.data;
    const supabase = createServerSupabaseClient();

    let query = supabase
      .from("products")
      .select("id, name, sku, category, fulfillment_mode, unit, sale_price, is_active, created_at, updated_at")
      .order("name", { ascending: true });

    if (category) query = query.eq("category", category);
    if (fulfillment_mode) query = query.eq("fulfillment_mode", fulfillment_mode);
    if (is_active) query = query.eq("is_active", is_active === "true");
    if (for_sale === "true") query = query.not("sale_price", "is", null);
    if (for_sale === "false") query = query.is("sale_price", null);
    if (q && q.length > 0) {
      query = query.or(`name.ilike.%${q}%,sku.ilike.%${q}%`);
    }

    const initial = await query;
    const data: any[] | null = (initial.data as any[] | null) ?? null;
    const error: { message?: string | null } | null = initial.error;

    if (error) {
      const message = String(error.message ?? "").toLowerCase();
      if (message.includes("fulfillment_mode")) {
        return NextResponse.json(
          {
            success: false,
            error:
              "DB migration required: apply 20260302_phase10_fo_prepare_flow.sql before using products API.",
          },
          { status: 500 }
        );
      }
      return NextResponse.json({ success: false, error: error.message }, { status: 500 });
    }

    const rows = (data ?? []).map((row: any) => ({
      ...row,
      fulfillment_mode: row.fulfillment_mode ?? "standard",
    }));

    const filteredRows =
      fulfillment_mode != null
        ? rows.filter((row: any) => row.fulfillment_mode === fulfillment_mode)
        : rows;

    return NextResponse.json({ success: true, products: filteredRows });
  } catch (err) {
    console.error("products GET failed", err);
    const message = err instanceof Error ? err.message : "Internal server error";
    return NextResponse.json({ success: false, error: message }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const json = await request.json().catch(() => null);
    const parsed = productCreateSchema.safeParse(json);

    if (!parsed.success) {
      return NextResponse.json(
        { success: false, error: "Invalid payload.", details: parsed.error.flatten() },
        { status: 400 }
      );
    }

    const body = parsed.data;
    const supabase = createServerSupabaseClient();

    const payload = {
      name: body.name,
      sku: body.sku?.trim() || null,
      category: body.category,
      fulfillment_mode: body.fulfillment_mode ?? "standard",
      unit: body.unit,
      sale_price: body.sale_price ?? null,
      is_active: body.is_active ?? true,
    };

    const result = await supabase
      .from("products")
      .insert(payload)
      .select("id, name, sku, category, fulfillment_mode, unit, sale_price, is_active, created_at, updated_at")
      .single();

    const { data, error } = result;

    if (error) {
      const message = String(error.message ?? "").toLowerCase();
      if (message.includes("fulfillment_mode")) {
        return NextResponse.json(
          {
            success: false,
            error:
              "DB migration required: apply 20260302_phase10_fo_prepare_flow.sql before creating products.",
          },
          { status: 500 }
        );
      }
      if (error.code === "23505") {
        return NextResponse.json(
          { success: false, error: "Product name or SKU already exists." },
          { status: 409 }
        );
      }
      return NextResponse.json({ success: false, error: error.message }, { status: 500 });
    }

    // Ensure new product is visible in Stock page immediately.
    const nowIso = new Date().toISOString();
    const { error: ensureMainStockError } = await supabase
      .from("main_stock")
      .upsert(
        {
          product_id: (data as any).id,
          quantity: 0,
          reorder_level: 10,
          updated_at: nowIso,
        },
        { onConflict: "product_id", ignoreDuplicates: true }
      );

    if (ensureMainStockError) {
      return NextResponse.json(
        { success: false, error: `Product created but failed to initialize stock row: ${ensureMainStockError.message}` },
        { status: 500 }
      );
    }

    const floorSeedRows = STOCK_FLOORS.map((floorNumber) => ({
      floor_number: floorNumber,
      product_id: (data as any).id,
      quantity: 0,
      updated_at: nowIso,
    }));

    const { error: ensureFloorStockError } = await supabase
      .from("floor_stock")
      .upsert(floorSeedRows, { onConflict: "floor_number,product_id", ignoreDuplicates: true });

    if (ensureFloorStockError) {
      return NextResponse.json(
        {
          success: false,
          error: `Product created but failed to initialize floor stock rows: ${ensureFloorStockError.message}`,
        },
        { status: 500 }
      );
    }

    return NextResponse.json(
      { success: true, product: { ...(data as any), fulfillment_mode: (data as any)?.fulfillment_mode ?? "standard" } },
      { status: 201 }
    );
  } catch (err) {
    console.error("products POST failed", err);
    const message = err instanceof Error ? err.message : "Internal server error";
    return NextResponse.json({ success: false, error: message }, { status: 500 });
  }
}
