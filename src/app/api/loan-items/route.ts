import { createServerSupabaseClient } from "@/lib/supabase/server";
import { NextRequest, NextResponse } from "next/server";
import { unstable_noStore as noStore } from "next/cache";

export const dynamic = "force-dynamic";

/* ─── GET /api/loan-items ────────────────────────────────────
   List all loan items with current stock levels
─────────────────────────────────────────────────────────── */
export async function GET(request: NextRequest) {
    noStore();
    try {
        const supabase = createServerSupabaseClient();

        const { data, error } = await supabase
            .from("loan_items")
            .select("*")
            .order("code");

        if (error) return NextResponse.json({ error: error.message }, { status: 500 });

        return NextResponse.json({ success: true, items: data ?? [] });
    } catch (err) {
        return NextResponse.json({ error: String(err) }, { status: 500 });
    }
}

export async function POST(request: NextRequest) {
    try {
        const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
        const code = String(body.code ?? "").trim().toUpperCase();
        const name = String(body.name ?? "").trim();
        const totalQty = Number(body.total_qty ?? 0);
        const available = Number(body.available ?? totalQty ?? 0);

        if (!code) return NextResponse.json({ error: "code is required." }, { status: 400 });
        if (!name) return NextResponse.json({ error: "name is required." }, { status: 400 });
        if (!Number.isFinite(totalQty) || totalQty < 0) return NextResponse.json({ error: "total_qty must be >= 0." }, { status: 400 });
        if (!Number.isFinite(available) || available < 0) return NextResponse.json({ error: "available must be >= 0." }, { status: 400 });

        const supabase = createServerSupabaseClient();
        const { data, error } = await supabase
            .from("loan_items")
            .insert({
                code,
                name,
                total_qty: Math.trunc(totalQty),
                available: Math.trunc(available),
                icon: body.icon ? String(body.icon) : null,
                requires_hk_collection: body.requires_hk_collection === undefined ? false : Boolean(body.requires_hk_collection),
                requires_extra_charge_reminder: body.requires_extra_charge_reminder === true,
                linked_fee_template_code: body.linked_fee_template_code ? String(body.linked_fee_template_code).trim().toUpperCase() : null,
            })
            .select("*")
            .maybeSingle();

        if (error) return NextResponse.json({ error: error.message }, { status: 500 });
        return NextResponse.json({ success: true, item: data }, { status: 201 });
    } catch (err) {
        return NextResponse.json({ error: String(err) }, { status: 500 });
    }
}
