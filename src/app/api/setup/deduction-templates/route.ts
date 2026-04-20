import { NextResponse } from "next/server";
import { createServerSupabaseClient } from "@/lib/supabase/server";

// GET /api/setup/deduction-templates — get all templates grouped by category
export async function GET() {
    try {
        const supabase = createServerSupabaseClient();
        const { data, error } = await supabase
            .from("condition_deduction_templates")
            .select("id, category, label, deduct_points")
            .eq("is_active", true)
            .order("category")
            .order("deduct_points", { ascending: false });
        if (error) throw error;

        // Group by category
        const grouped: Record<string, typeof data> = {};
        for (const t of data ?? []) {
            if (!grouped[t.category]) grouped[t.category] = [];
            grouped[t.category]!.push(t);
        }

        return NextResponse.json({ success: true, templates: data, grouped });
    } catch (err: any) {
        return NextResponse.json({ success: false, error: err.message }, { status: 500 });
    }
}

// POST /api/setup/deduction-templates — create a new template
export async function POST(req: Request) {
    try {
        const supabase = createServerSupabaseClient();
        const { category, label, deduct_points } = await req.json();

        if (!category || !label || !deduct_points) {
            return NextResponse.json({ success: false, error: "category, label, deduct_points required" }, { status: 400 });
        }

        const { data, error } = await supabase
            .from("condition_deduction_templates")
            .upsert({ category, label, deduct_points }, { onConflict: "category,label" })
            .select()
            .single();
        if (error) throw error;

        return NextResponse.json({ success: true, template: data });
    } catch (err: any) {
        return NextResponse.json({ success: false, error: err.message }, { status: 500 });
    }
}
