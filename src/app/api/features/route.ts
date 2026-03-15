import { createServerSupabaseClient } from "@/lib/supabase/server";
import { NextResponse } from "next/server";

export async function GET() {
    try {
        const supabase = createServerSupabaseClient();

        const { data: features, error } = await supabase
            .from("room_features")
            .select("*")
            .order("category", { ascending: true })
            .order("name", { ascending: true });

        if (error) throw error;

        return NextResponse.json({ success: true, features });
    } catch (err: any) {
        return NextResponse.json({ success: false, error: err.message }, { status: 500 });
    }
}
