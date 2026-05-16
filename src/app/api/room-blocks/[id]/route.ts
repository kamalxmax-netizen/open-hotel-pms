import { NextResponse } from "next/server";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { isUnsellableRoomBlockType } from "@/lib/room-block-availability";

export async function PUT(
    request: Request,
    { params }: { params: { id: string } }
) {
    try {
        const id = params.id;
        if (!id) {
            return NextResponse.json({ error: "Missing block id." }, { status: 400 });
        }

        const json = await request.json();
        let { room_id, room_number, block_type, start_date, end_date, reason } = json;

        if (!block_type || !start_date || !end_date || !reason) {
            return NextResponse.json({ error: "Missing required fields." }, { status: 400 });
        }

        const supabase = createServerSupabaseClient();

        if (!room_id && room_number) {
            const { data: roomObj, error: roomLookupError } = await supabase
                .from("rooms")
                .select("id")
                .eq("room_number", room_number)
                .single();

            if (roomLookupError) throw roomLookupError;
            room_id = roomObj?.id ?? null;
        }

        if (!room_id) {
            return NextResponse.json({ error: "room_id or valid room_number required." }, { status: 400 });
        }

        const { data: existingBlock, error: existingBlockError } = await supabase
            .from("room_blocks")
            .select("id")
            .eq("id", id)
            .maybeSingle();

        if (existingBlockError) throw existingBlockError;
        if (!existingBlock) {
            return NextResponse.json({ error: "Room block not found." }, { status: 404 });
        }

        const { data, error } = await supabase
            .from("room_blocks")
            .update({
                room_id,
                block_type,
                start_date,
                end_date,
                reason,
            })
            .eq("id", id)
            .select()
            .single();

        if (error) throw error;

        if (isUnsellableRoomBlockType(block_type)) {
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

export async function DELETE(
    request: Request,
    { params }: { params: { id: string } }
) {
    try {
        const id = params.id;
        if (!id) {
            return NextResponse.json({ error: "Missing block id." }, { status: 400 });
        }

        const supabase = createServerSupabaseClient();

        const { error } = await supabase
            .from("room_blocks")
            .delete()
            .eq("id", id);

        if (error) throw error;

        return NextResponse.json({ success: true });
    } catch (err: any) {
        return NextResponse.json({ error: err.message }, { status: 500 });
    }
}
