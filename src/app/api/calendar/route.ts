import { createServerSupabaseClient } from "@/lib/supabase/server";
import { NextRequest, NextResponse } from "next/server";
import { unstable_noStore as noStore } from "next/cache";
import { addDays } from "@/lib/dates";
import { attachTemplateFallback, filterAlertsForSurface, mapEffectiveReservationAlert, normalizeAlertCodeKey, summarizeAlerts } from "@/lib/reservation-alerts";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
    noStore();
    try {
        const supabase = createServerSupabaseClient();
        const sp = request.nextUrl.searchParams;

        // Default: today → today+14 (Bangkok time)
        const today = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Bangkok" }).format(new Date());
        const defaultEnd = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Bangkok" }).format(new Date(Date.now() + 14 * 86400000));
        const startDate = sp.get("start") ?? today;
        const endDate = sp.get("end") ?? defaultEnd;

        // All rooms (visible on board), ordered
        const { data: rooms, error: roomsErr } = await supabase
            .from("rooms")
            .select("id, room_number, is_sellable, closure_reason, is_dayuse, floor_number, wing, sort_order, room_types(name_en, code)")
            .eq("is_visible_on_board", true)
            .order("floor_number", { ascending: true, nullsFirst: false })
            .order("wing", { ascending: true, nullsFirst: false })
            .order("sort_order", { ascending: true, nullsFirst: false });

        if (roomsErr) return NextResponse.json({ error: roomsErr.message }, { status: 500 });

        // All reservation_nights in the date range (not cancelled)
        // Include both 'active' AND 'checked_out' so Opera-style CO bars appear
        const { data: nights, error: nightsErr } = await supabase
            .from("reservation_nights")
            .select(`
                room_id,
                stay_date,
                nightly_price,
                is_ota,
                reservation_id,
                reservations!inner(
                  id,
                  booking_code,
                  booking_group_id,
                  guest_name,
                  phone,
                  source,
                  status,
                  checkin_date,
                  checkout_date,
                  total_price,
                  note
                )
            `)
            .gte("stay_date", startDate)
            .lte("stay_date", endDate)
            .is("cancelled_at", null)
            .in("reservations.status", ["active", "checked_out"]);

        if (nightsErr) return NextResponse.json({ error: nightsErr.message }, { status: 500 });

        // Fetch Room Blocks
        const { data: blocks, error: blocksErr } = await supabase
            .from("room_blocks")
            .select("*")
            .or(`start_date.lte.${endDate},end_date.gte.${startDate}`);

        if (blocksErr) return NextResponse.json({ error: blocksErr.message }, { status: 500 });

        const { data: plannedMoves, error: plannedMovesError } = await supabase
            .from("reservation_room_plans")
            .select("id, reservation_id, start_date, end_date, from_room_id_snapshot, to_room_id, to_room_type_id, move_reason, pricing_policy, do_not_move, status")
            .eq("status", "planned")
            .lt("start_date", addDays(endDate, 1))
            .gt("end_date", startDate)
            .order("start_date", { ascending: true });

        if (plannedMovesError) return NextResponse.json({ error: plannedMovesError.message }, { status: 500 });

        const groupIds = new Set<string>();
        (nights ?? []).forEach((n: any) => {
            const res = n?.reservations as { booking_group_id?: string | null } | null;
            if (res?.booking_group_id) {
                groupIds.add(String(res.booking_group_id));
            }
        });

        const groupMetaById = new Map<string, { group_code: string | null; group_name: string | null }>();
        if (groupIds.size > 0) {
            const { data: groups, error: groupError } = await supabase
                .from("booking_groups")
                .select("id, group_code, group_name")
                .in("id", Array.from(groupIds));
            if (groupError) return NextResponse.json({ error: groupError.message }, { status: 500 });

            (groups ?? []).forEach((g: any) => {
                groupMetaById.set(String(g.id), {
                    group_code: g.group_code ?? null,
                    group_name: g.group_name ?? null
                });
            });
        }

        const plannedReservationIds = Array.from(new Set((plannedMoves ?? []).map((row: any) => String(row.reservation_id)).filter(Boolean)));
        const plannedRoomIds = Array.from(
            new Set(
                (plannedMoves ?? [])
                    .flatMap((row: any) => [row?.to_room_id ? String(row.to_room_id) : "", row?.from_room_id_snapshot ? String(row.from_room_id_snapshot) : ""])
                    .filter(Boolean)
            )
        );

        const reservationMetaById = new Map<string, {
            booking_code: string | null;
            guest_name: string | null;
            checkin_date: string | null;
            checkout_date: string | null;
            booking_group_id: string | null;
        }>();
        if (plannedReservationIds.length > 0) {
            const { data: reservations, error: plannedReservationError } = await supabase
                .from("reservations")
                .select("id, booking_code, guest_name, checkin_date, checkout_date, booking_group_id")
                .in("id", plannedReservationIds);
            if (plannedReservationError) return NextResponse.json({ error: plannedReservationError.message }, { status: 500 });
            (reservations ?? []).forEach((row: any) => {
                reservationMetaById.set(String(row.id), {
                    booking_code: row.booking_code ?? null,
                    guest_name: row.guest_name ?? null,
                    checkin_date: row.checkin_date ?? null,
                    checkout_date: row.checkout_date ?? null,
                    booking_group_id: row.booking_group_id ?? null,
                });
            });
        }

        const plannedRoomNumberById = new Map<string, string>();
        if (plannedRoomIds.length > 0) {
            const { data: plannedRooms, error: plannedRoomError } = await supabase
                .from("rooms")
                .select("id, room_number")
                .in("id", plannedRoomIds);
            if (plannedRoomError) return NextResponse.json({ error: plannedRoomError.message }, { status: 500 });
            (plannedRooms ?? []).forEach((row: any) => {
                plannedRoomNumberById.set(String(row.id), String(row.room_number));
            });
        }

        const reservationIds = Array.from(
            new Set((nights ?? []).map((row: any) => String(row?.reservation_id ?? "")).filter(Boolean))
        );
        const alertSummaryByReservationId = new Map<string, {
            count: number;
            firstMessage: string | null;
            highestSeverity: "info" | "warning" | "critical" | null;
        }>();
        if (reservationIds.length > 0) {
            const { data: reservationAlerts, error: reservationAlertsError } = await supabase
                .from("reservation_alerts")
                .select("id, reservation_id, alert_code, alert_template_id, note, custom_message, display_surfaces, severity, is_dismissed, created_at, created_by, alert_codes(code, description, dept, auto_on_co, icon), alert_templates(id, code, name, description, category, display_surfaces, severity, icon)")
                .in("reservation_id", reservationIds);

            if (reservationAlertsError) return NextResponse.json({ error: reservationAlertsError.message }, { status: 500 });

            const legacyCodes = Array.from(
                new Set((reservationAlerts ?? []).filter((row: any) => !row?.alert_template_id && row?.alert_code).map((row: any) => normalizeAlertCodeKey(row.alert_code)).filter(Boolean))
            );
            let templateMap = new Map<string, any>();
            if (legacyCodes.length > 0) {
                const { data: templates, error: templateError } = await supabase
                    .from("alert_templates")
                    .select("id, code, name, description, category, display_surfaces, severity, icon");
                if (templateError) return NextResponse.json({ error: templateError.message }, { status: 500 });
                templateMap = new Map((templates ?? []).map((template: any) => [normalizeAlertCodeKey(template.code), template]));
            }
            const resolvedRows = attachTemplateFallback(reservationAlerts ?? [], templateMap);

            const grouped = new Map<string, any[]>();
            for (const row of resolvedRows) {
                const reservationId = String((row as any)?.reservation_id ?? "");
                if (!reservationId) continue;
                if (!grouped.has(reservationId)) grouped.set(reservationId, []);
                grouped.get(reservationId)?.push(row);
            }

            grouped.forEach((rows, reservationId) => {
                const alerts = rows
                    .map((row) => mapEffectiveReservationAlert(row))
                    .filter((alert) => !alert.is_dismissed);
                const visibleAlerts = filterAlertsForSurface(alerts, "calendar");
                const summary = summarizeAlerts(visibleAlerts);
                if (summary.count > 0) {
                    alertSummaryByReservationId.set(reservationId, summary);
                }
            });
        }


        // Build reservation map: room_id → list of reservations (with date spans)
        // Also collect unassigned reservations
        const resMap: Record<
            string,
            {
                reservation_id: string;
                booking_code: string;
                booking_group_id: string | null;
                group_code: string | null;
                group_name: string | null;
                guest_name: string;
                phone: string | null;
                source: string;
                status: string;             // 'active' | 'checked_out'
                checkin_date: string;
                checkout_date: string;
                total_price: number;
                note: string | null;
                nights: string[];
            }[]
        > = {};
        const unassignedMap = new Map<string, any>();

        const seen = new Map<string, { roomId: string | null, dates: Set<string> }>();

        for (const n of nights ?? []) {
            const res = (n.reservations as unknown) as {
                id: string; booking_code: string; booking_group_id: string | null; guest_name: string; phone: string | null;
                source: string; status: string; checkin_date: string; checkout_date: string;
                total_price: number; note: string | null;
            };
            if (!res) continue;
            const roomId = n.room_id;
            const resId = res.id;
            const key = roomId ? `${roomId}::${resId}` : `unassigned::${resId}`;

            if (!seen.has(key)) {
                seen.set(key, { roomId, dates: new Set() });
                const groupId = res.booking_group_id ? String(res.booking_group_id) : null;
                const groupMeta = groupId ? groupMetaById.get(groupId) : null;
                const entry = {
                    reservation_id: res.id,
                    booking_code: res.booking_code,
                    booking_group_id: groupId,
                    group_code: groupMeta?.group_code ?? null,
                    group_name: groupMeta?.group_name ?? null,
                    guest_name: res.guest_name,
                    phone: res.phone,
                    source: res.source,
                    status: res.status,
                    checkin_date: res.checkin_date,
                    checkout_date: res.checkout_date,
                    total_price: res.total_price,
                    note: res.note,
                    nights: [],
                    alert_count: alertSummaryByReservationId.get(String(res.id))?.count ?? 0,
                    first_alert_message: alertSummaryByReservationId.get(String(res.id))?.firstMessage ?? null,
                    alert_severity: alertSummaryByReservationId.get(String(res.id))?.highestSeverity ?? null,
                };

                if (roomId) {
                    if (!resMap[roomId]) resMap[roomId] = [];
                    resMap[roomId].push(entry);
                } else {
                    unassignedMap.set(resId, entry);
                }
            }
            seen.get(key)!.dates.add(n.stay_date);
        }

        // Attach nights arrays
        for (const [key, val] of seen.entries()) {
            const resId = key.split("::")[1];
            if (val.roomId) {
                const entry = resMap[val.roomId]?.find((r) => r.reservation_id === resId);
                if (entry) entry.nights = [...val.dates].sort();
            } else {
                const entry = unassignedMap.get(resId);
                if (entry) entry.nights = [...val.dates].sort();
            }
        }

        // Build final rooms list with their reservations
        const data = (rooms ?? []).map((room) => {
            const rt = (room.room_types as unknown) as { name_en: string; code: string } | null;
            return {
                room_id: room.id,
                room_number: room.room_number,
                room_type: rt?.name_en ?? "Unknown",
                room_type_code: rt?.code ?? "",
                is_sellable: room.is_sellable,
                is_dayuse: room.is_dayuse ?? false,
                closure_reason: room.closure_reason,
                reservations: resMap[room.id] ?? []
            };
        });

        return NextResponse.json({
            success: true,
            start_date: startDate,
            end_date: endDate,
            rooms: data,
            unassigned: Array.from(unassignedMap.values()),
            blocks: blocks ?? [],
            planned_moves: (plannedMoves ?? []).map((row: any) => {
                const reservationMeta = reservationMetaById.get(String(row.reservation_id));
                const groupId = reservationMeta?.booking_group_id ? String(reservationMeta.booking_group_id) : null;
                const groupMeta = groupId ? groupMetaById.get(groupId) : null;
                return {
                    id: String(row.id),
                    reservation_id: String(row.reservation_id),
                    booking_code: reservationMeta?.booking_code ?? null,
                    guest_name: reservationMeta?.guest_name ?? null,
                    checkin_date: reservationMeta?.checkin_date ?? null,
                    checkout_date: reservationMeta?.checkout_date ?? null,
                    booking_group_id: groupId,
                    group_code: groupMeta?.group_code ?? null,
                    group_name: groupMeta?.group_name ?? null,
                    start_date: String(row.start_date),
                    end_date: String(row.end_date),
                    from_room_id_snapshot: row.from_room_id_snapshot ? String(row.from_room_id_snapshot) : null,
                    from_room_number: row.from_room_id_snapshot ? plannedRoomNumberById.get(String(row.from_room_id_snapshot)) ?? null : null,
                    to_room_id: String(row.to_room_id),
                    to_room_number: plannedRoomNumberById.get(String(row.to_room_id)) ?? null,
                    to_room_type_id: Number(row.to_room_type_id ?? 0),
                    move_reason: row.move_reason ?? null,
                    pricing_policy: row.pricing_policy ?? "keep_rtc",
                    do_not_move: Boolean(row.do_not_move),
                    status: String(row.status ?? "planned"),
                };
            }),
        });
    } catch (err) {
        return NextResponse.json({ error: String(err) }, { status: 500 });
    }
}
