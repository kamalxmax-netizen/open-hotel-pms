import { createServerSupabaseClient } from "@/lib/supabase/server";
import { NextRequest, NextResponse } from "next/server";

function toInt(value: unknown): number {
  const num = typeof value === "number" ? value : Number(value);
  return Number.isFinite(num) ? Math.trunc(num) : NaN;
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: { code: string } }
) {
  try {
    const code = String(params.code ?? "").trim().toUpperCase();
    if (!code) return NextResponse.json({ error: "Missing loan item code." }, { status: 400 });

    const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
    const updates: Record<string, unknown> = {};

    if (body.name !== undefined) {
      const name = String(body.name ?? "").trim();
      if (!name) return NextResponse.json({ error: "name cannot be empty." }, { status: 400 });
      updates.name = name;
    }
    if (body.icon !== undefined) updates.icon = body.icon ? String(body.icon) : null;
    if (body.total_qty !== undefined) {
      const totalQty = toInt(body.total_qty);
      if (!Number.isFinite(totalQty) || totalQty < 0) return NextResponse.json({ error: "total_qty must be >= 0." }, { status: 400 });
      updates.total_qty = totalQty;
    }
    if (body.available !== undefined) {
      const available = toInt(body.available);
      if (!Number.isFinite(available) || available < 0) return NextResponse.json({ error: "available must be >= 0." }, { status: 400 });
      updates.available = available;
    }
    if (body.requires_hk_collection !== undefined) updates.requires_hk_collection = Boolean(body.requires_hk_collection);
    if (body.requires_extra_charge_reminder !== undefined) updates.requires_extra_charge_reminder = Boolean(body.requires_extra_charge_reminder);
    if (body.linked_fee_template_code !== undefined) {
      updates.linked_fee_template_code = body.linked_fee_template_code ? String(body.linked_fee_template_code).trim().toUpperCase() : null;
    }

    if (Object.keys(updates).length === 0) {
      return NextResponse.json({ error: "No valid fields to update." }, { status: 400 });
    }

    const supabase = createServerSupabaseClient();
    const { data, error } = await supabase
      .from("loan_items")
      .update(updates)
      .eq("code", code)
      .select("*")
      .maybeSingle();

    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    if (!data) return NextResponse.json({ error: "Loan item not found." }, { status: 404 });
    return NextResponse.json({ success: true, item: data });
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}

export async function DELETE(
  _request: NextRequest,
  { params }: { params: { code: string } }
) {
  try {
    const code = String(params.code ?? "").trim().toUpperCase();
    if (!code) return NextResponse.json({ error: "Missing loan item code." }, { status: 400 });

    const supabase = createServerSupabaseClient();
    const { error } = await supabase
      .from("loan_items")
      .delete()
      .eq("code", code);

    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ success: true });
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
