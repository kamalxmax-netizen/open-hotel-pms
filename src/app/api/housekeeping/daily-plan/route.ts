import { createServerSupabaseClient } from "@/lib/supabase/server";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

const dailyPlanSchema = z.object({
    date: z.string(),
    assignments: z.array(
        z.object({
            room_id: z.string().uuid(),
            assigned_maid: z.string().min(1),
            priority: z.number().min(1).max(15),
        })
    ),
});

export async function GET(request: NextRequest) {
    try {
        const supabase = createServerSupabaseClient();
        const date =
            request.nextUrl.searchParams.get("date") ??
            new Date().toISOString().slice(0, 10);

        const { data, error } = await supabase
            .from("daily_plans")
            .select(
                "id, plan_date, room_id, assigned_maid, priority, rooms(room_number, room_type_id, room_types(code, cleaning_duration_min))"
            )
            .eq("plan_date", date)
            .order("priority");

        if (error) {
            return NextResponse.json({ error: error.message }, { status: 500 });
        }

        const plan: Record<string, any[]> = {};

        for (const row of data ?? []) {
            const maid = row.assigned_maid ?? "Others";
            const room = row.rooms as unknown as {
                room_number: string;
                room_type_id: string;
                room_types: { code: string; cleaning_duration_min: number } | null;
            } | null;

            const entry = {
                id: row.id,
                room_id: row.room_id,
                room_number: room?.room_number ?? null,
                room_type_code: room?.room_types?.code ?? null,
                cleaning_duration_min: room?.room_types?.cleaning_duration_min ?? null,
                priority: row.priority,
            };

            if (!plan[maid]) {
                plan[maid] = [];
            }
            plan[maid].push(entry);
        }

        return NextResponse.json({ success: true, date, plan });
    } catch (err) {
        return NextResponse.json({ error: String(err) }, { status: 500 });
    }
}

export async function POST(request: NextRequest) {
    try {
        const supabase = createServerSupabaseClient();
        const body = await request.json();

        const parsed = dailyPlanSchema.safeParse(body);
        if (!parsed.success) {
            return NextResponse.json(
                { error: "Invalid request body.", details: parsed.error.flatten() },
                { status: 400 }
            );
        }

        const { date, assignments } = parsed.data;
        const rpcAssignments = assignments.map((a) => ({
            room_id: a.room_id,
            assigned_maid: a.assigned_maid,
            priority: a.priority,
        }));

        const { data: savedCount, error: saveError } = await supabase.rpc("hk_save_daily_plan", {
            p_date: date,
            p_assignments: rpcAssignments,
        });

        if (saveError) {
            return NextResponse.json({ error: saveError.message }, { status: 500 });
        }

        return NextResponse.json({
            success: true,
            count: typeof savedCount === "number" ? savedCount : assignments.length,
        });
    } catch (err) {
        return NextResponse.json({ error: String(err) }, { status: 500 });
    }
}
