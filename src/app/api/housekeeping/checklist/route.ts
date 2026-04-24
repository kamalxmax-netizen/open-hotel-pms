import { createServerSupabaseClient } from "@/lib/supabase/server";
import { requireStaffAuth } from "@/lib/server-auth";
import { NextRequest, NextResponse } from "next/server";

export async function GET(request: NextRequest) {
    try {
        const supabase = createServerSupabaseClient();
        const auth = await requireStaffAuth(supabase, request);
        if (auth.error) return auth.error;

        const roomTypeCode = request.nextUrl.searchParams.get("room_type_code");

        if (!roomTypeCode) {
            return NextResponse.json(
                { error: "room_type_code is required." },
                { status: 400 }
            );
        }

        const { data, error } = await supabase
            .from("checklist_templates")
            .select("*")
            .eq("room_type_code", roomTypeCode)
            .eq("is_active", true)
            .order("sort_order", { ascending: true });

        if (error) {
            return NextResponse.json({ error: error.message }, { status: 500 });
        }

        return NextResponse.json({
            success: true,
            room_type_code: roomTypeCode,
            items: data ?? [],
        });
    } catch (err) {
        return NextResponse.json({ error: String(err) }, { status: 500 });
    }
}
