import { createServerSupabaseClient } from "@/lib/supabase/server";
import { NextRequest, NextResponse } from "next/server";

// Single-cell rate upsert — used by inline PriceCell click-to-edit
export async function POST(request: NextRequest) {
    try {
        const supabase = createServerSupabaseClient();
        const { room_id, date, price } = await request.json();

        if (!room_id || !date || price === undefined) {
            return NextResponse.json({ error: "Missing room_id, date, or price." }, { status: 400 });
        }
        if (price < 0) {
            return NextResponse.json({ error: "Price cannot be negative." }, { status: 400 });
        }

        const { error } = await supabase
            .from("rate_templates")
            .upsert(
                { room_id, stay_date: date, price },
                { onConflict: "stay_date,room_id" }
            );

        if (error) return NextResponse.json({ error: error.message }, { status: 500 });

        return NextResponse.json({ success: true });
    } catch (err) {
        return NextResponse.json({ error: String(err) }, { status: 500 });
    }
}
