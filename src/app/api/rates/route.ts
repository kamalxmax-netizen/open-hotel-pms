import { createServerSupabaseClient } from "@/lib/supabase/server";
import { NextRequest, NextResponse } from "next/server";
import { isLegacyDayUseRoom } from "@/lib/dayuse-rooms";

function addDays(date: string, n: number): string {
    const d = new Date(date + "T00:00:00");
    d.setDate(d.getDate() + n);
    const yyyy = d.getFullYear();
    const mm = String(d.getMonth() + 1).padStart(2, "0");
    const dd = String(d.getDate()).padStart(2, "0");
    return `${yyyy}-${mm}-${dd}`;
}

function dateRange(start: string, end: string): string[] {
    const days: string[] = [];
    let cur = start;
    while (cur <= end) {
        days.push(cur);
        cur = addDays(cur, 1);
    }
    return days;
}

function isMissingColumnError(error: { message?: string } | null | undefined, column: string): boolean {
    const message = String(error?.message ?? "");
    const pattern = new RegExp(`column\\s+.*${column}.*does not exist`, "i");
    return pattern.test(message);
}

async function fetchRateGridRooms(supabase: ReturnType<typeof createServerSupabaseClient>) {
    let roomsRes = await supabase
        .from("rooms")
        .select("id, room_number, room_type_id, is_sellable, room_types(id, name_en, code)")
        .eq("is_visible_on_board", true)
        .eq("is_sellable", true)
        .eq("is_dayuse", false)
        .order("room_number", { ascending: true });

    if (roomsRes.error && isMissingColumnError(roomsRes.error, "is_dayuse")) {
        roomsRes = await supabase
            .from("rooms")
            .select("id, room_number, room_type_id, is_sellable, room_types(id, name_en, code)")
            .eq("is_visible_on_board", true)
            .eq("is_sellable", true)
            .order("room_number", { ascending: true });
    }

    if (roomsRes.error) throw new Error(roomsRes.error.message);

    return (roomsRes.data ?? []).filter((room: any) => !isLegacyDayUseRoom(String(room?.room_number ?? "")));
}

async function fetchOvernightRoomsByType(
    supabase: ReturnType<typeof createServerSupabaseClient>,
    roomTypeId: string
) {
    let roomsRes = await supabase
        .from("rooms")
        .select("id, room_number")
        .eq("room_type_id", roomTypeId)
        .eq("is_sellable", true)
        .eq("is_dayuse", false)
        .order("room_number", { ascending: true });

    if (roomsRes.error && isMissingColumnError(roomsRes.error, "is_dayuse")) {
        roomsRes = await supabase
            .from("rooms")
            .select("id, room_number")
            .eq("room_type_id", roomTypeId)
            .eq("is_sellable", true)
            .order("room_number", { ascending: true });
    }

    if (roomsRes.error) throw new Error(roomsRes.error.message);

    return (roomsRes.data ?? []).filter((room: any) => !isLegacyDayUseRoom(String(room?.room_number ?? "")));
}

/* ─── GET — fetch rate matrix ──────────────────── */
export async function GET(request: NextRequest) {
    try {
        const supabase = createServerSupabaseClient();
        const sp = request.nextUrl.searchParams;

        const today = new Date().toISOString().slice(0, 10);
        const startDate = sp.get("start") ?? today;
        const endDate = sp.get("end") ?? addDays(startDate, 29);

        // All sellable overnight rooms with their type (exclude day-use inventory).
        let rooms: any[] = [];
        try {
            rooms = await fetchRateGridRooms(supabase);
        } catch (error) {
            return NextResponse.json({ error: (error as Error).message }, { status: 500 });
        }

        // All rate_template rows in range
        const { data: rates, error: ratesErr } = await supabase
            .from("rate_templates")
            .select("room_id, stay_date, price")
            .gte("stay_date", startDate)
            .lte("stay_date", endDate);

        if (ratesErr) return NextResponse.json({ error: ratesErr.message }, { status: 500 });

        // Build lookup: room_id → { date → price }
        const rateMap = new Map<string, Map<string, number>>();
        for (const r of rates ?? []) {
            if (!rateMap.has(r.room_id)) rateMap.set(r.room_id, new Map());
            rateMap.get(r.room_id)!.set(r.stay_date, Number(r.price));
        }

        const days = dateRange(startDate, endDate);

        // Group rooms by room type
        const typeMap = new Map<
            string,
            { type_id: string; type_name: string; type_code: string; rooms: { room_id: string; room_number: string; rates: Record<string, number | null> }[] }
        >();

        for (const room of rooms ?? []) {
            if (!room.is_sellable) continue;
            const rt = (room.room_types as unknown) as { id: string; name_en: string; code: string } | null;
            const typeId = rt?.id ?? "unknown";
            const typeName = rt?.name_en ?? "Unknown";
            const typeCode = rt?.code ?? "";

            if (!typeMap.has(typeId)) {
                typeMap.set(typeId, { type_id: typeId, type_name: typeName, type_code: typeCode, rooms: [] });
            }

            const roomRates: Record<string, number | null> = {};
            const dayMap = rateMap.get(room.id);
            for (const day of days) {
                roomRates[day] = dayMap?.get(day) ?? null;
            }

            typeMap.get(typeId)!.rooms.push({
                room_id: room.id,
                room_number: room.room_number,
                rates: roomRates
            });
        }

        return NextResponse.json({
            success: true,
            start_date: startDate,
            end_date: endDate,
            days,
            room_types: [...typeMap.values()]
        });
    } catch (err) {
        return NextResponse.json({ error: String(err) }, { status: 500 });
    }
}

/* ─── POST — bulk upsert ────────────────────────── */
export async function POST(request: NextRequest) {
    try {
        const supabase = createServerSupabaseClient();
        const body = await request.json();

        const {
            room_type_id,   // uuid of the room_type to update
            start_date,
            end_date,
            weekdays,       // array of 0-6 (0=Sun) — empty = all days
            price           // numeric price to set
        } = body as {
            room_type_id: string;
            start_date: string;
            end_date: string;
            weekdays: number[];
            price: number;
        };

        if (!room_type_id || !start_date || !end_date || price === undefined) {
            return NextResponse.json({ error: "Missing required fields." }, { status: 400 });
        }
        if (price < 0) {
            return NextResponse.json({ error: "Price cannot be negative." }, { status: 400 });
        }

        // Get all rooms of that type
        let rooms: Array<{ id: string; room_number?: string | null }> = [];
        try {
            rooms = await fetchOvernightRoomsByType(supabase, room_type_id);
        } catch (error) {
            return NextResponse.json({ error: (error as Error).message }, { status: 500 });
        }
        if (!rooms || rooms.length === 0) {
            return NextResponse.json({ error: "No sellable rooms found for this room type." }, { status: 404 });
        }

        // Build date list filtered by weekday
        const days = dateRange(start_date, end_date).filter((d) => {
            if (!weekdays || weekdays.length === 0) return true;
            const dow = new Date(d + "T00:00:00").getDay();
            return weekdays.includes(dow);
        });

        if (days.length === 0) {
            return NextResponse.json({ error: "No dates match the weekday filter." }, { status: 400 });
        }

        // Build upsert rows
        const rows = rooms.flatMap((room) =>
            days.map((day) => ({
                room_id: room.id,
                stay_date: day,
                price: price
            }))
        );

        const { error: upsertErr } = await supabase
            .from("rate_templates")
            .upsert(rows, { onConflict: "stay_date,room_id" });

        if (upsertErr) return NextResponse.json({ error: upsertErr.message }, { status: 500 });

        return NextResponse.json({
            success: true,
            updated_rooms: rooms.length,
            updated_dates: days.length,
            total_rows: rows.length
        });
    } catch (err) {
        return NextResponse.json({ error: String(err) }, { status: 500 });
    }
}
