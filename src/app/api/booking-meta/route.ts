import { createServerSupabaseClient } from "@/lib/supabase/server";
import { NextResponse } from "next/server";
import { isLegacyDayUseRoom } from "@/lib/dayuse-rooms";

function isMissingColumnError(error: { message?: string } | null | undefined, column: string): boolean {
    const message = String(error?.message ?? "");
    const pattern = new RegExp(`column\\s+.*${column}.*does not exist`, "i");
    return pattern.test(message);
}

function normalizeRoomTypeText(value: unknown): string {
    return String(value ?? "")
        .trim()
        .toLowerCase()
        .replace(/[_-]+/g, " ")
        .replace(/\s+/g, " ");
}

function shouldHideOperationalRoomType(row: { code?: unknown; name_en?: unknown }): boolean {
    const haystack = `${normalizeRoomTypeText(row.code)} ${normalizeRoomTypeText(row.name_en)}`.trim();
    if (!haystack) return false;

    return (
        haystack.includes("day use") ||
        haystack.includes("dayuse") ||
        haystack.includes("close room") ||
        haystack.includes("closed room") ||
        haystack.includes("plan move") ||
        /^move$/.test(haystack)
    );
}

export async function GET() {
    try {
        const supabase = createServerSupabaseClient();

        // 1. Fetch Room Types
        let roomTypeRes = await supabase
            .from("room_types")
            .select("id, code, name_en, sort_order")
            .order("sort_order", { ascending: true });

        if (roomTypeRes.error && isMissingColumnError(roomTypeRes.error, "sort_order")) {
            roomTypeRes = await supabase
                .from("room_types")
                .select("id, code, name_en");
        }
        if (roomTypeRes.error) throw roomTypeRes.error;

        const allRoomTypes = (roomTypeRes.data ?? []).map((row: any) => ({
            id: row.id,
            code: row.code ?? null,
            name_en: row.name_en ?? row.code ?? `Type ${row.id}`,
            sort_order: row.sort_order ?? 0,
        }));

        // 2. Fetch Features
        const { data: features, error: fErr } = await supabase
            .from("room_features")
            .select("*")
            .order("category", { ascending: true })
            .order("name", { ascending: true });

        // room_features is optional for Booking create/edit; keep room type dropdown working even if this table is missing.
        const safeFeatures = fErr ? [] : (features ?? []);

        // 3. Fetch Rooms (basic view to let frontend know which rooms map to which type)
        let roomsRes = await supabase
            .from("rooms")
            .select("id, room_number, room_type_id")
            .eq("is_sellable", true)
            .eq("is_dayuse", false)
            .order("room_number", { ascending: true });

        if (roomsRes.error && isMissingColumnError(roomsRes.error, "is_dayuse")) {
            roomsRes = await supabase
                .from("rooms")
                .select("id, room_number, room_type_id")
                .eq("is_sellable", true)
                .order("room_number", { ascending: true });
        }

        if (roomsRes.error) throw roomsRes.error;
        const rooms = (roomsRes.data ?? []).filter((room: any) => !isLegacyDayUseRoom(String(room?.room_number ?? "")));
        const roomTypeIdsWithOvernightInventory = new Set(
            rooms
                .map((room: any) => String(room?.room_type_id ?? "").trim())
                .filter((id) => id.length > 0)
        );

        // Keep only real overnight inventory room types for booking/check-in flows.
        // This hides utility types such as Day Use / Close Room / Plan Move / Move.
        const roomTypes = allRoomTypes
            .filter((row) => roomTypeIdsWithOvernightInventory.has(String(row.id)))
            .filter((row) => !shouldHideOperationalRoomType(row))
            .map((row) => ({
                id: row.id,
                name_en: row.name_en,
                sort_order: row.sort_order,
            }));

        return NextResponse.json({
            success: true,
            roomTypes,
            features: safeFeatures,
            rooms
        });
    } catch (err: any) {
        return NextResponse.json({ success: false, error: err.message }, { status: 500 });
    }
}
