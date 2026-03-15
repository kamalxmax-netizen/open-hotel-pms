import { normalizeExtraFeeCategory } from "@/lib/folio-fees";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { NextRequest, NextResponse } from "next/server";
import { unstable_noStore as noStore } from "next/cache";

function toNumber(value: unknown): number {
  const num = typeof value === "number" ? value : Number(value);
  return Number.isFinite(num) ? num : NaN;
}

function sanitizeCode(value: unknown): string {
  return String(value ?? "").trim().toUpperCase();
}

export async function GET(request: NextRequest) {
  noStore();
  try {
    const supabase = createServerSupabaseClient();
    const activeParam = request.nextUrl.searchParams.get("active");
    const categories = request.nextUrl.searchParams.getAll("category");
    const normalizedCategories = categories
      .map((value) => normalizeExtraFeeCategory(value))
      .filter((value): value is NonNullable<typeof value> => value !== null);

    let query = supabase
      .from("extra_fee_templates")
      .select("code, name, default_price, category, icon, is_active, sort_order, created_at")
      .order("sort_order", { ascending: true })
      .order("code", { ascending: true });

    if (activeParam === "true") query = query.eq("is_active", true);
    if (activeParam === "false") query = query.eq("is_active", false);
    if (normalizedCategories.length > 0) query = query.in("category", normalizedCategories);

    const { data, error } = await query;
    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json({
      success: true,
      templates: (data ?? []).map((row) => ({
        ...row,
        default_price: Number(row.default_price ?? 0),
        sort_order: Number(row.sort_order ?? 0),
      })),
    });
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
    const code = sanitizeCode(body.code);
    const name = String(body.name ?? "").trim();
    const category = normalizeExtraFeeCategory(body.category);
    const defaultPrice = toNumber(body.default_price ?? 0);
    const sortOrder = toNumber(body.sort_order ?? 0);

    if (!code) {
      return NextResponse.json({ error: "code is required." }, { status: 400 });
    }
    if (!name) {
      return NextResponse.json({ error: "name is required." }, { status: 400 });
    }
    if (!category) {
      return NextResponse.json({ error: "category must be service, penalty, damage, or policy." }, { status: 400 });
    }
    if (!Number.isFinite(defaultPrice) || defaultPrice < 0) {
      return NextResponse.json({ error: "default_price must be >= 0." }, { status: 400 });
    }
    if (!Number.isFinite(sortOrder)) {
      return NextResponse.json({ error: "sort_order must be a number." }, { status: 400 });
    }

    const supabase = createServerSupabaseClient();
    const { data, error } = await supabase
      .from("extra_fee_templates")
      .insert({
        code,
        name,
        default_price: Number(defaultPrice.toFixed(2)),
        category,
        icon: body.icon ? String(body.icon) : null,
        is_active: body.is_active == null ? true : Boolean(body.is_active),
        sort_order: Math.trunc(sortOrder),
      })
      .select("code, name, default_price, category, icon, is_active, sort_order, created_at")
      .maybeSingle();

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json({
      success: true,
      template: data,
    }, { status: 201 });
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
