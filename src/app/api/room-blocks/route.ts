import { NextResponse } from "next/server";
import { createServerSupabaseClient } from "@/lib/supabase/server";

export async function GET() {
    try {
        const supabase = createServerSupabaseClient();

        const { data, error } = await supabase
            .from("room_blocks")
            .select(`
                *,
                rooms(room_number),
                profiles:created_by(full_name)
            `)
            .order("created_at", { ascending: false });

        if (error) throw error;

        const blocks = data.map(b => ({
            ...b,
            room_number: (b.rooms as any)?.room_number ?? null,
            created_by_name: (b.profiles as any)?.full_name || "System",
        }));

        return NextResponse.json({ success: true, blocks });
    } catch (err: any) {
        return NextResponse.json({ error: err.message }, { status: 500 });
    }
}

export async function POST(request: Request) {
    try {
        const json = await request.json();
        // Accept both room_id (new) and room_number (fallback for old UI)
        let { room_id, room_number, block_type, start_date, end_date, reason } = json;

        if (!block_type || !start_date || !end_date || !reason) {
            return NextResponse.json({ error: "Missing required fields." }, { status: 400 });
        }

        const supabase = createServerSupabaseClient();

        // Resolve room_id from room_number if needed
        if (!room_id && room_number) {
            const { data: roomObj } = await supabase
                .from("rooms")
                .select("id")
                .eq("room_number", room_number)
                .single();
            room_id = roomObj?.id ?? null;
        }

        if (!room_id) {
            return NextResponse.json({ error: "room_id or valid room_number required." }, { status: 400 });
        }

        const { data: { user } } = await supabase.auth.getUser();

        const { data, error } = await supabase
            .from("room_blocks")
            .insert({
                room_id,
                block_type,
                start_date,
                end_date,
                reason,
                created_by: user?.id || null
            })
            .select()
            .single();

        if (error) throw error;

        // If OOO block, unassign existing reservations for this room/period
        if (block_type === "OOO") {
            await supabase
                .from("reservation_nights")
                .update({ room_id: null })
                .eq("room_id", room_id)
                .gte("stay_date", start_date)
                .lt("stay_date", end_date)
                .is("cancelled_at", null);
        }

        return NextResponse.json({ success: true, block: data });
    } catch (err: any) {
        return NextResponse.json({ error: err.message }, { status: 500 });
    }
}
