import { normalizeExtraFeeCategory } from "@/lib/folio-fees";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { NextRequest, NextResponse } from "next/server";

function toNumber(value: unknown): number {
  const num = typeof value === "number" ? value : Number(value);
  return Number.isFinite(num) ? num : NaN;
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: { code: string } }
) {
  try {
    const code = String(params.code ?? "").trim().toUpperCase();
    if (!code) {
      return NextResponse.json({ error: "Missing template code." }, { status: 400 });
    }

    const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
    const updates: Record<string, unknown> = {};

    if (body.name !== undefined) {
      const name = String(body.name ?? "").trim();
      if (!name) {
        return NextResponse.json({ error: "name cannot be empty." }, { status: 400 });
      }
      updates.name = name;
    }

    if (body.default_price !== undefined) {
      const defaultPrice = toNumber(body.default_price);
      if (!Number.isFinite(defaultPrice) || defaultPrice < 0) {
        return NextResponse.json({ error: "default_price must be >= 0." }, { status: 400 });
      }
      updates.default_price = Number(defaultPrice.toFixed(2));
    }

    if (body.category !== undefined) {
      const category = normalizeExtraFeeCategory(body.category);
      if (!category) {
        return NextResponse.json({ error: "category must be service, penalty, damage, or policy." }, { status: 400 });
      }
      updates.category = category;
    }

    if (body.icon !== undefined) {
      updates.icon = body.icon ? String(body.icon) : null;
    }

    if (body.is_active !== undefined) {
      updates.is_active = Boolean(body.is_active);
    }

    if (body.sort_order !== undefined) {
      const sortOrder = toNumber(body.sort_order);
      if (!Number.isFinite(sortOrder)) {
        return NextResponse.json({ error: "sort_order must be a number." }, { status: 400 });
      }
      updates.sort_order = Math.trunc(sortOrder);
    }

    if (Object.keys(updates).length === 0) {
      return NextResponse.json({ error: "No valid fields to update." }, { status: 400 });
    }

    const supabase = createServerSupabaseClient();
    const { data, error } = await supabase
      .from("extra_fee_templates")
      .update(updates)
      .eq("code", code)
      .select("code, name, default_price, category, icon, is_active, sort_order, created_at")
      .maybeSingle();

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }
    if (!data) {
      return NextResponse.json({ error: "Template not found." }, { status: 404 });
    }

    return NextResponse.json({
      success: true,
      template: data,
    });
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
