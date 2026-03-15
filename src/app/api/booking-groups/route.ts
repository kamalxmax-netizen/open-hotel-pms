import { NextResponse } from "next/server";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { deriveBookingGroupStatus } from "@/lib/booking-group-status";

function toNumber(value: unknown): number {
    const num = typeof value === "number" ? value : Number(value);
    return Number.isFinite(num) ? num : 0;
}

export async function GET(request: Request) {
    try {
        const supabase = createServerSupabaseClient();
        const { searchParams } = new URL(request.url);
        const status = searchParams.get("status");
        const q = searchParams.get("q");

        let query = supabase
            .from("booking_groups")
            .select("*")
            .order("created_at", { ascending: false });

        if (status) {
            query = query.eq("status", status);
        }
        if (q) {
            query = query.or(`group_name.ilike.%${q}%,group_code.ilike.%${q}%,contact_name.ilike.%${q}%`);
        }

        const { data: groups, error } = await query;

        if (error) {
            return NextResponse.json({ success: false, error: error.message }, { status: 500 });
        }

        const groupRows = groups ?? [];
        if (groupRows.length === 0) {
            return NextResponse.json({ success: true, groups: [] });
        }

        const groupIds = groupRows.map((g: any) => String(g.id));
        const { data: reservations, error: reservationError } = await supabase
            .from("reservations")
            .select(`
                id,
                booking_group_id,
                status,
                total_price,
                reservation_nights (
                    nightly_price,
                    cancelled_at
                )
            `)
            .in("booking_group_id", groupIds);

        if (reservationError) {
            return NextResponse.json({ success: false, error: reservationError.message }, { status: 500 });
        }

        const summaryByGroup = new Map<string, { count: number; total: number; statuses: string[] }>();
        for (const id of groupIds) summaryByGroup.set(id, { count: 0, total: 0, statuses: [] });

        (reservations ?? []).forEach((reservation: any) => {
            const groupId = String(reservation.booking_group_id || "");
            if (!groupId || !summaryByGroup.has(groupId)) return;

            const summary = summaryByGroup.get(groupId)!;
            summary.count += 1;
            summary.statuses.push(String(reservation.status ?? ""));

            const persistedTotal = toNumber(reservation.total_price);
            let effectiveTotal = persistedTotal;
            if (effectiveTotal <= 0) {
                const nights = Array.isArray(reservation.reservation_nights)
                    ? reservation.reservation_nights
                    : reservation.reservation_nights
                        ? [reservation.reservation_nights]
                        : [];
                const activeNights = nights.filter((n: any) => !n?.cancelled_at);
                const nightsForCalc = activeNights.length > 0 ? activeNights : nights;
                const fallbackTotal = nightsForCalc.reduce((sum: number, n: any) => sum + toNumber(n?.nightly_price), 0);
                if (fallbackTotal > 0) effectiveTotal = fallbackTotal;
            }

            summary.total += effectiveTotal;
        });

        const nowIso = new Date().toISOString();
        const statusSyncJobs: Array<{ id: string; status: string }> = [];
        const formattedGroups = groupRows.map((g: any) => {
            const summary = summaryByGroup.get(String(g.id)) ?? { count: 0, total: 0, statuses: [] };
            const derivedStatus = deriveBookingGroupStatus(g.status, summary.statuses);
            if (String(g.status ?? "").toLowerCase() !== derivedStatus) {
                statusSyncJobs.push({ id: String(g.id), status: derivedStatus });
            }
            return {
                ...g,
                status: derivedStatus,
                reservations_count: summary.count,
                total_price: Number(summary.total.toFixed(2))
            };
        });

        if (statusSyncJobs.length > 0) {
            await Promise.all(
                statusSyncJobs.map(async (job) => {
                    const { error: updateError } = await supabase
                        .from("booking_groups")
                        .update({ status: job.status, updated_at: nowIso })
                        .eq("id", job.id);
                    if (updateError) {
                        console.error("booking-groups status sync failed:", job.id, updateError.message);
                    }
                })
            );
        }

        const groupsForResponse = status
            ? formattedGroups.filter((row: any) => String(row.status ?? "") === status)
            : formattedGroups;

        return NextResponse.json({ success: true, groups: groupsForResponse });
    } catch (err: any) {
        return NextResponse.json({ success: false, error: err.message }, { status: 500 });
    }
}

export async function POST(request: Request) {
    try {
        const supabase = createServerSupabaseClient();
        const body = await request.json();

        // basic validation
        if (!body.group_name) {
            return NextResponse.json({ success: false, error: "Group name is required" }, { status: 400 });
        }

        const payload = {
            group_name: body.group_name,
            contact_name: body.contact_name || null,
            contact_phone: body.contact_phone || null,
            contact_email: body.contact_email || null,
            source: body.source || "direct",
            note: body.note || null,
        };

        const { data: group, error } = await supabase
            .from("booking_groups")
            .insert(payload)
            .select()
            .single();

        if (error) {
            return NextResponse.json({ success: false, error: error.message }, { status: 500 });
        }

        return NextResponse.json({ success: true, group });
    } catch (err: any) {
        return NextResponse.json({ success: false, error: err.message }, { status: 500 });
    }
}
