import { createClient } from "@supabase/supabase-js";
import { NextResponse } from "next/server";
import { isLegacyDayUseRoom } from "@/lib/dayuse-rooms";

const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
);

type Params = { params: { id: string } };

// GET /api/setup/rooms/[id] — full detail for one room
export async function GET(_req: Request, { params }: Params) {
    const { id } = params;
    try {
        const { data: room, error: rErr } = await supabase
            .from("rooms")
            .select(`
                id, room_number, is_sellable, is_dayuse,
                room_types(id, name_en, max_guests, extra_guest_charge, child_free_under_cm, child_extra_charge)
            `)
            .eq("id", id)
            .single();
        if (rErr) throw rErr;

        const [
            { data: features },
            { data: beds },
            { data: detail },
            { data: deductions },
            { data: stayCount },
        ] = await Promise.all([
            supabase.from("room_feature_mapping").select("feature_code").eq("room_id", id),
            supabase.from("room_beds").select("bed_type_code, quantity").eq("room_id", id),
            supabase.from("room_detail").select("*").eq("room_id", id).maybeSingle(),
            supabase.from("room_condition_deductions")
                .select("id, category, label, deduct_points, noted_at, template_id")
                .eq("room_id", id)
                .order("category"),
            supabase.from("room_stay_history").select("id", { count: "exact", head: true }).eq("room_id", id),
        ]);

        return NextResponse.json({
            success: true,
            room: {
                ...room,
                is_dayuse: Boolean((room as any)?.is_dayuse) || isLegacyDayUseRoom(String((room as any)?.room_number ?? "")),
                room_type: (room as any).room_types?.name_en,
                max_guests: (room as any).room_types?.max_guests ?? 2,
                features: (features ?? []).map((f: any) => f.feature_code),
                beds: beds ?? [],
                detail: detail ?? null,
                deductions: deductions ?? [],
                total_nights: (stayCount as any)?.count ?? 0,
            },
        });
    } catch (err: any) {
        return NextResponse.json({ success: false, error: err.message }, { status: 500 });
    }
}

// PUT /api/setup/rooms/[id] — save beds + detail info
export async function PUT(req: Request, { params }: Params) {
    const { id } = params;
    try {
        const body = await req.json();
        const {
            beds,        // [{ bed_type_code, quantity }]
            detail,      // { ac_base, furniture_base, bathroom_base, wifi_base, ac_model, ... }
        } = body;

        // Upsert beds — delete all then re-insert
        if (Array.isArray(beds)) {
            const { error: delErr } = await supabase.from("room_beds").delete().eq("room_id", id);
            if (delErr) throw delErr;
            if (beds.length > 0) {
                const { error: insErr } = await supabase
                    .from("room_beds")
                    .insert(beds.map((b: any) => ({ room_id: id, bed_type_code: b.bed_type_code, quantity: b.quantity })));
                if (insErr) throw insErr;
            }
        }

        // Upsert room detail — exclude computed/generated columns
        if (detail) {
            // eslint-disable-next-line @typescript-eslint/no-unused-vars
            const { quality_score, room_id: _rid, ...detailToSave } = detail as any;
            const { error: detErr } = await supabase
                .from("room_detail")
                .upsert(
                    { room_id: id, ...detailToSave, updated_at: new Date().toISOString() },
                    { onConflict: "room_id" }
                );
            if (detErr) throw detErr;
        }

        return NextResponse.json({ success: true });
    } catch (err: any) {
        return NextResponse.json({ success: false, error: err.message }, { status: 500 });
    }
}
