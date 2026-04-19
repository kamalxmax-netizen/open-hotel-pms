import { createClient } from "@supabase/supabase-js";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

const upsertAmenitySchema = z.object({
  room_type_code: z.string().trim().min(1, "room_type_code is required"),
  items: z.array(
    z.object({
      item_name: z.string().trim().min(1, "item_name is required"),
      default_quantity: z.number().int().min(1).max(99),
      category: z.string().trim().min(1).max(40).default("Amenity"),
      product_id: z.string().uuid().optional().nullable(),
    })
  ),
});

const ALLOWED_AMENITY_CATEGORIES = ["Amenity", "Linen", "Equipment"] as const;

function normalizeCategory(input: string): string {
  const normalized = input.trim().toLowerCase();
  if (!normalized) return "Amenity";
  if (normalized === "water" || normalized === "amenity") return "Amenity";
  if (normalized === "linen") return "Linen";
  if (normalized === "equipment") return "Equipment";
  return "Amenity";
}

async function syncAmenityAnalyticsSetup(roomTypeCode: string) {
  const { data: roomType, error: roomTypeError } = await supabase
    .from("room_types")
    .select("id, code, name_en")
    .eq("code", roomTypeCode)
    .maybeSingle();

  if (roomTypeError) throw roomTypeError;
  if (!roomType?.id) return 0;

  const roomTypeName = String((roomType as any).name_en ?? "");
  if (String((roomType as any).code ?? "").toUpperCase() === "CLOSED" || roomTypeName.toLowerCase().includes("closed")) {
    return 0;
  }

  const { data: amenityProducts, error: productsError } = await supabase
    .from("products")
    .select("id")
    .eq("is_active", true)
    .in("stock_tracking_mode", ["amenity_prepare", "amenity_direct"]);

  if (productsError) throw productsError;

  const productIds = (amenityProducts ?? []).map((row: any) => String(row.id)).filter(Boolean);
  if (productIds.length > 0) {
    const { error: deleteError } = await supabase
      .from("room_type_amenity_setups")
      .delete()
      .eq("room_type_id", Number((roomType as any).id))
      .in("product_id", productIds);

    if (deleteError) throw deleteError;
  }

  const { data: activeTemplates, error: templatesError } = await supabase
    .from("checklist_templates")
    .select("product_id, default_quantity")
    .eq("room_type_code", roomTypeCode)
    .eq("is_active", true)
    .not("product_id", "is", null);

  if (templatesError) throw templatesError;

  const allowedProductIds = new Set(productIds);
  const byProduct = new Map<string, number>();
  for (const item of activeTemplates ?? []) {
    const productId = String((item as any).product_id ?? "");
    if (!productId || !allowedProductIds.has(productId)) continue;
    const qty = Math.max(0, Number((item as any).default_quantity ?? 0));
    if (qty <= 0) continue;
    byProduct.set(productId, Math.max(byProduct.get(productId) ?? 0, qty));
  }

  const rows = Array.from(byProduct.entries()).map(([product_id, units_per_occupied_night]) => ({
    room_type_id: Number((roomType as any).id),
    product_id,
    units_per_occupied_night,
  }));

  if (rows.length > 0) {
    const { error: upsertError } = await supabase
      .from("room_type_amenity_setups")
      .upsert(rows, { onConflict: "room_type_id,product_id" });

    if (upsertError) throw upsertError;
  }

  return rows.length;
}

export async function GET(request: NextRequest) {
  try {
    const roomTypeCode = request.nextUrl.searchParams.get("room_type_code");

    let query = supabase
      .from("checklist_templates")
      .select("id, room_type_code, item_name, default_quantity, category, product_id, sort_order, is_active")
      .eq("is_active", true)
      .order("room_type_code", { ascending: true })
      .order("sort_order", { ascending: true })
      .order("item_name", { ascending: true });

    if (roomTypeCode) {
      query = query.eq("room_type_code", roomTypeCode.trim());
    }

    const { data, error } = await query;
    if (error) {
      return NextResponse.json({ success: false, error: error.message }, { status: 500 });
    }

    return NextResponse.json({
      success: true,
      items: (data ?? []).map((row) => ({
        ...row,
        category: normalizeCategory(String(row.category ?? "Amenity")),
      })),
      allowed_categories: ALLOWED_AMENITY_CATEGORIES,
    });
  } catch (err: any) {
    return NextResponse.json({ success: false, error: err?.message ?? String(err) }, { status: 500 });
  }
}

export async function PUT(request: NextRequest) {
  try {
    const body = await request.json().catch(() => null);
    const parsed = upsertAmenitySchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { success: false, error: "Invalid payload", details: parsed.error.flatten() },
        { status: 400 }
      );
    }

    const roomTypeCode = parsed.data.room_type_code.trim();
    const items = parsed.data.items.map((item) => ({
      item_name: item.item_name.trim(),
      default_quantity: item.default_quantity,
      category: normalizeCategory(item.category),
      product_id: item.product_id ?? null,
    }));

    const dedupeSet = new Set<string>();
    for (const item of items) {
      const key = item.item_name.toLowerCase();
      if (dedupeSet.has(key)) {
        return NextResponse.json(
          { success: false, error: `Duplicate item name: ${item.item_name}` },
          { status: 400 }
        );
      }
      dedupeSet.add(key);
    }

    const { error: deactivateError } = await supabase
      .from("checklist_templates")
      .update({ is_active: false })
      .eq("room_type_code", roomTypeCode);

    if (deactivateError) {
      return NextResponse.json({ success: false, error: deactivateError.message }, { status: 500 });
    }

    if (items.length > 0) {
      const payload = items.map((item, idx) => ({
        room_type_code: roomTypeCode,
        item_name: item.item_name,
        default_quantity: item.default_quantity,
        category: item.category,
        product_id: item.product_id,
        sort_order: idx + 1,
        is_active: true,
      }));

      const { error: upsertError } = await supabase
        .from("checklist_templates")
        .upsert(payload, { onConflict: "room_type_code,item_name" });

      if (upsertError) {
        return NextResponse.json({ success: false, error: upsertError.message }, { status: 500 });
      }
    }

    const { data: refreshed, error: refreshError } = await supabase
      .from("checklist_templates")
      .select("id, room_type_code, item_name, default_quantity, category, product_id, sort_order, is_active")
      .eq("room_type_code", roomTypeCode)
      .eq("is_active", true)
      .order("sort_order", { ascending: true })
      .order("item_name", { ascending: true });

    if (refreshError) {
      return NextResponse.json({ success: false, error: refreshError.message }, { status: 500 });
    }

    const syncedSetupRows = await syncAmenityAnalyticsSetup(roomTypeCode);

    return NextResponse.json({
      success: true,
      items: (refreshed ?? []).map((row) => ({
        ...row,
        category: normalizeCategory(String(row.category ?? "Amenity")),
      })),
      allowed_categories: ALLOWED_AMENITY_CATEGORIES,
      analytics_setup_synced: syncedSetupRows,
    });
  } catch (err: any) {
    return NextResponse.json({ success: false, error: err?.message ?? String(err) }, { status: 500 });
  }
}
