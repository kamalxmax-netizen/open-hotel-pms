import { createServerSupabaseClient } from "@/lib/supabase/server";
import { NextResponse } from "next/server";

export async function GET() {
    try {
        const supabase = createServerSupabaseClient();

        // 1. Fetch Room Types
        const { data: roomTypes, error: rtErr } = await supabase
            .from("room_types")
            .select("id, name_en, sort_order")
            .order("sort_order", { ascending: true });

        if (rtErr) throw rtErr;

        // 2. Fetch Features
        const { data: features, error: fErr } = await supabase
            .from("room_features")
            .select("*")
            .order("category", { ascending: true })
            .order("name", { ascending: true });

        if (fErr) throw fErr;

        // 3. Fetch Rooms (basic view to let frontend know which rooms map to which type)
        const { data: rooms, error: rErr } = await supabase
            .from("rooms")
            .select("id, room_number, room_type_id")
            .eq("is_sellable", true)
            .order("sort_order", { ascending: true });

        if (rErr) throw rErr;

        return NextResponse.json({
            success: true,
            roomTypes,
            features,
            rooms
        });
    } catch (err: any) {
        return NextResponse.json({ success: false, error: err.message }, { status: 500 });
    }
}
