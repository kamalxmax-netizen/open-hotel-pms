import { createClient } from "@supabase/supabase-js";
import { NextResponse } from "next/server";

const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
);

type Params = { params: { id: string } };

// POST /api/setup/rooms/[id]/deductions — add a deduction to a room
export async function POST(req: Request, { params }: Params) {
    const { id: roomId } = params;
    try {
        const { category, label, deduct_points, template_id } = await req.json();

        if (!category || !label || !deduct_points) {
            return NextResponse.json({ success: false, error: "category, label, deduct_points required" }, { status: 400 });
        }

        const { data, error } = await supabase
            .from("room_condition_deductions")
            .insert({ room_id: roomId, category, label, deduct_points, template_id: template_id || null })
            .select()
            .single();
        if (error) throw error;

        // Fetch updated quality_score
        const { data: detail } = await supabase
            .from("room_detail")
            .select("quality_score, ac_deduct, furniture_deduct, bathroom_deduct, wifi_deduct")
            .eq("room_id", roomId)
            .single();

        return NextResponse.json({ success: true, deduction: data, updated_detail: detail });
    } catch (err: any) {
        return NextResponse.json({ success: false, error: err.message }, { status: 500 });
    }
}

// DELETE /api/setup/rooms/[id]/deductions?deduction_id=xxx
export async function DELETE(req: Request, { params }: Params) {
    const { id: roomId } = params;
    const { searchParams } = new URL(req.url);
    const deductionId = searchParams.get("deduction_id");

    if (!deductionId) {
        return NextResponse.json({ success: false, error: "deduction_id required" }, { status: 400 });
    }

    try {
        const { error } = await supabase
            .from("room_condition_deductions")
            .delete()
            .match({ id: deductionId, room_id: roomId });
        if (error) throw error;

        // Fetch updated quality_score
        const { data: detail } = await supabase
            .from("room_detail")
            .select("quality_score, ac_deduct, furniture_deduct, bathroom_deduct, wifi_deduct")
            .eq("room_id", roomId)
            .single();

        return NextResponse.json({ success: true, updated_detail: detail });
    } catch (err: any) {
        return NextResponse.json({ success: false, error: err.message }, { status: 500 });
    }
}
