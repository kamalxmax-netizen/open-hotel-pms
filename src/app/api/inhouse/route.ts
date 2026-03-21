import { createServerSupabaseClient } from "@/lib/supabase/server";
import { getBusinessDate } from "@/lib/fo-prepare";
import { NextRequest, NextResponse } from "next/server";
import { unstable_noStore as noStore } from "next/cache";
import { isValidDateString } from "@/lib/dates";
import { buildReservationLoyaltyMap } from "@/lib/server-guest-loyalty";
import { applyVisibleTotal, fetchReservationOutstandingBalances, fetchReservationVisibleTotals } from "@/lib/reservation-visible-total";
import { mapEffectiveReservationAlert } from "@/lib/reservation-alerts";
import { resolveHotelCheckOutTime, resolveLinkedStay } from "@/lib/linked-stay";

export const dynamic = "force-dynamic";

function daysBetween(start: string, end: string): number {
    const startMs = new Date(`${start}T00:00:00`).getTime();
    const endMs = new Date(`${end}T00:00:00`).getTime();
    return Math.max(0, Math.round((endMs - startMs) / 86400000));
}

export async function GET(request: NextRequest) {
    noStore();
    try {
        const supabase = createServerSupabaseClient();
        const requestedDate = request.nextUrl.searchParams.get("date");
        if (requestedDate && !isValidDateString(requestedDate)) {
            return NextResponse.json({ error: "Invalid date format. Use YYYY-MM-DD." }, { status: 400 });
        }
        const businessDate = await getBusinessDate(supabase, requestedDate);

        const baseSelect = `
            id,
            booking_code,
            booking_group_id,
            parent_reservation_id,
            guest_name,
            phone,
            guest_profile_id,
            status,
            checkin_date,
            checkout_date,
            discount_type,
            discount_value,
            discount_percent,
            deposit_amount,
            total_price,
            reservation_nights(
                stay_date,
                room_id,
                cancelled_at,
                rooms(id, room_number, room_type_id, room_types(name_en))
            ),
            reservation_traces(id, status, dept, loan_item_code),
            reservation_alerts(*, alert_codes(code, description, dept, auto_on_co, icon), alert_templates(id, code, name, description, category, display_surfaces, severity, is_active, sort_order, icon))
        `;

        // Try with checked_in_at first (if column exists), fallback to audit_logs-only mode.
        const withCheckedInAtSelect = `
            id,
            booking_code,
            booking_group_id,
            parent_reservation_id,
            guest_name,
            phone,
            guest_profile_id,
            status,
            checkin_date,
            checkout_date,
            discount_type,
            discount_value,
            discount_percent,
            deposit_amount,
            total_price,
            checked_in_at,
            reservation_nights(
                stay_date,
                room_id,
                cancelled_at,
                rooms(id, room_number, room_type_id, room_types(name_en))
            ),
            reservation_traces(id, status, dept, loan_item_code),
            reservation_alerts(*, alert_codes(code, description, dept, auto_on_co, icon), alert_templates(id, code, name, description, category, display_surfaces, severity, is_active, sort_order, icon))
        `;

        let includesCheckedInAt = true;
        let reservationData: any[] = [];

        const withCheckedIn = await supabase
            .from("reservations")
            .select(withCheckedInAtSelect)
            .eq("status", "active")
            .eq("is_dayuse", false)
            .lte("checkin_date", businessDate)
            .gte("checkout_date", businessDate);

        if (withCheckedIn.error && /checked_in_at/i.test(withCheckedIn.error.message)) {
            includesCheckedInAt = false;
            const fallback = await supabase
                .from("reservations")
                .select(baseSelect)
                .eq("status", "active")
                .eq("is_dayuse", false)
                .lte("checkin_date", businessDate)
                .gte("checkout_date", businessDate);

            if (fallback.error) {
                return NextResponse.json({ error: fallback.error.message }, { status: 500 });
            }
            reservationData = fallback.data ?? [];
        } else {
            if (withCheckedIn.error) {
                return NextResponse.json({ error: withCheckedIn.error.message }, { status: 500 });
            }
            reservationData = withCheckedIn.data ?? [];
        }

        const groupIds = Array.from(
            new Set(
                reservationData
                    .map((r: any) => (r.booking_group_id ? String(r.booking_group_id) : ""))
                    .filter(Boolean)
            )
        );
        const groupMetaById = new Map<string, { group_code: string | null; group_name: string | null }>();
        if (groupIds.length > 0) {
            const { data: groups, error: groupError } = await supabase
                .from("booking_groups")
                .select("id, group_code, group_name")
                .in("id", groupIds);

            if (groupError) {
                return NextResponse.json({ error: groupError.message }, { status: 500 });
            }

            (groups ?? []).forEach((g: any) => {
                groupMetaById.set(String(g.id), {
                    group_code: g.group_code ?? null,
                    group_name: g.group_name ?? null
                });
            });
        }

        const reservationIds = reservationData.map((r) => String(r.id));
        const checkedInLogByReservation = new Map<string, string>();

        if (reservationIds.length > 0) {
            const { data: logs, error: logsError } = await supabase
                .from("audit_logs")
                .select("entity_id, created_at")
                .eq("entity_type", "reservation")
                .eq("action", "checked_in")
                .in("entity_id", reservationIds);

            if (logsError) {
                return NextResponse.json({ error: logsError.message }, { status: 500 });
            }

            for (const log of logs ?? []) {
                const reservationId = String(log.entity_id);
                const createdAt = String(log.created_at);
                const existing = checkedInLogByReservation.get(reservationId);
                if (!existing || createdAt > existing) {
                    checkedInLogByReservation.set(reservationId, createdAt);
                }
            }
        }

        const profileSeed = new Map<string, string | null>();
        for (const reservation of reservationData) {
            const reservationId = reservation?.id ? String(reservation.id) : "";
            if (!reservationId) continue;
            profileSeed.set(
                reservationId,
                reservation?.guest_profile_id ? String(reservation.guest_profile_id) : null
            );
        }
        const loyaltyByReservationId = await buildReservationLoyaltyMap(
            supabase,
            reservationIds,
            profileSeed
        );
        const visibleExtraByReservationId = await fetchReservationVisibleTotals(supabase, reservationIds);
        const outstandingByReservationId = await fetchReservationOutstandingBalances(
            supabase,
            reservationData.map((r: any) => ({
                id: String(r.id),
                total_price: r.total_price,
                deposit_amount: r.deposit_amount,
                discount_type: r.discount_type,
                discount_value: r.discount_value,
                discount_percent: r.discount_percent,
                checkin_date: r.checkin_date,
                checkout_date: r.checkout_date,
            }))
        );
        const checkOutTimeHHmm = await resolveHotelCheckOutTime(supabase);

        const rows = (await Promise.all(
            reservationData
                .filter((r) => {
                    const checkedInAt = includesCheckedInAt ? (r.checked_in_at as string | null | undefined) : null;
                    return Boolean(checkedInAt) || checkedInLogByReservation.has(String(r.id));
                })
                .map(async (r) => {
                const groupId = r.booking_group_id ? String(r.booking_group_id) : null;
                const groupMeta = groupId ? groupMetaById.get(groupId) : null;
                const nights = Array.isArray(r.reservation_nights)
                    ? r.reservation_nights.filter((n: any) => !n?.cancelled_at)
                    : [];
                const sortedNights = [...nights].sort((a: any, b: any) =>
                    String(b?.stay_date ?? "").localeCompare(String(a?.stay_date ?? ""))
                );
                const nightsUpToToday = sortedNights.filter((n: any) => String(n?.stay_date ?? "") <= businessDate);
                const stayNight = nightsUpToToday[0] ?? sortedNights[0] ?? null;
                const room = stayNight?.rooms as { id?: string; room_number?: string; room_type_id?: number | string; room_types?: { name_en?: string } | null } | null;
                const traces = Array.isArray(r.reservation_traces) ? r.reservation_traces : [];
                const openTracesCount = traces.filter((t: any) => t?.status === "open" && !t?.loan_item_code).length;
                const alertRows = Array.isArray(r.reservation_alerts)
                    ? r.reservation_alerts.map((a: any) => mapEffectiveReservationAlert(a)).filter((a: any) => !a.is_dismissed && a.display_surfaces.includes("inhouse"))
                    : [];

                const checkedInAt = includesCheckedInAt ? (r.checked_in_at as string | null | undefined) : null;
                const checkedInEvidence = checkedInAt ?? checkedInLogByReservation.get(String(r.id)) ?? null;
                const loyalty = loyaltyByReservationId.get(String(r.id));
                const linkedStay = await resolveLinkedStay(supabase, String(r.id), checkOutTimeHHmm);

                return {
                    id: r.id,
                    booking_code: r.booking_code,
                    booking_group_id: groupId,
                    parent_reservation_id: r.parent_reservation_id ?? null,
                    group_code: groupMeta?.group_code ?? null,
                    group_name: groupMeta?.group_name ?? null,
                    guest_name: r.guest_name,
                    phone: r.phone,
                    room_number: room?.room_number ?? "—",
                    room_type: room?.room_types?.name_en ?? "—",
                    room_type_id: room?.room_type_id != null ? String(room.room_type_id) : "",
                    checkin_date: r.checkin_date,
                    checkout_date: r.checkout_date,
                    checked_in_at: checkedInEvidence,
                    nights_remaining: daysBetween(businessDate, r.checkout_date),
                    total_price: applyVisibleTotal(r.total_price, visibleExtraByReservationId.get(String(r.id)), {
                        discountType: r.discount_type,
                        discountValue: r.discount_value,
                        discountPercent: r.discount_percent,
                        checkinDate: r.checkin_date,
                        checkoutDate: r.checkout_date,
                    }),
                    outstanding_balance: outstandingByReservationId.get(String(r.id)) ?? 0,
                    vip_tier: loyalty?.vip_tier ?? null,
                    stay_count: loyalty?.stay_count ?? 0,
                    night_count: loyalty?.night_count ?? 0,
                    main_stay_count: loyalty?.main_stay_count ?? 0,
                    main_night_count: loyalty?.main_night_count ?? 0,
                    accompanying_stay_count: loyalty?.accompanying_stay_count ?? 0,
                    accompanying_night_count: loyalty?.accompanying_night_count ?? 0,
                    open_traces_count: openTracesCount,
                    alert_count: alertRows.length,
                    first_alert_message: alertRows[0]?.message ?? null,
                    linked_segments: linkedStay?.segments ?? null,
                    linked_full_checkin: linkedStay?.full_checkin ?? null,
                    linked_full_checkout: linkedStay?.full_checkout ?? null,
                    linked_active_segment_id: linkedStay?.active_segment_id ?? null,
                };
            })
        )).sort((a: any, b: any) => a.room_number.localeCompare(b.room_number, undefined, { numeric: true }));

        const { data: dayUseData, error: dayUseError } = await supabase
            .from("reservations")
            .select(`
                id,
                booking_code,
                guest_name,
                phone,
                status,
                checkin_date,
                checkout_date,
                checked_in_at,
                dayuse_expires_at,
                discount_type,
                discount_value,
                discount_percent,
                total_price,
                reservation_nights(
                    stay_date,
                    room_id,
                    cancelled_at,
                    rooms(room_number, room_types(name_en))
                )
            `)
            .eq("is_dayuse", true)
            .eq("status", "active")
            .eq("checkin_date", businessDate)
            .eq("checkout_date", businessDate)
            .order("created_at", { ascending: true });

        if (dayUseError) {
            return NextResponse.json({ error: dayUseError.message }, { status: 500 });
        }

        const dayUseReservationIds = (dayUseData ?? []).map((r: any) => String(r.id));
        if (dayUseReservationIds.length > 0) {
            const dayUseVisibleExtraMap = await fetchReservationVisibleTotals(supabase, dayUseReservationIds);
            for (const [reservationId, extraTotal] of dayUseVisibleExtraMap.entries()) {
                visibleExtraByReservationId.set(reservationId, extraTotal);
            }
        }

        const dayuse_reservations = (dayUseData ?? [])
            .map((r: any) => {
                const nights = Array.isArray(r.reservation_nights)
                    ? r.reservation_nights.filter((n: any) => !n?.cancelled_at && String(n?.stay_date ?? "") === businessDate)
                    : [];
                const night = nights[0] ?? null;
                const room = night?.rooms as { room_number?: string; room_types?: { name_en?: string } | null } | null;
                return {
                    id: String(r.id),
                    booking_code: String(r.booking_code ?? ""),
                    guest_name: String(r.guest_name ?? ""),
                    phone: r.phone ? String(r.phone) : null,
                    status: String(r.status ?? "active"),
                    checkin_date: String(r.checkin_date ?? ""),
                    checkout_date: String(r.checkout_date ?? ""),
                    checked_in_at: r.checked_in_at ? String(r.checked_in_at) : null,
                    dayuse_expires_at: r.dayuse_expires_at ? String(r.dayuse_expires_at) : null,
                    total_price: applyVisibleTotal(r.total_price, visibleExtraByReservationId.get(String(r.id)), {
                        discountType: r.discount_type,
                        discountValue: r.discount_value,
                        discountPercent: r.discount_percent,
                        checkinDate: r.checkin_date,
                        checkoutDate: r.checkout_date,
                    }),
                    room_number: room?.room_number ?? "—",
                    room_type: room?.room_types?.name_en ?? "—",
                };
            })
            .sort((a, b) => a.room_number.localeCompare(b.room_number, undefined, { numeric: true }));

        return NextResponse.json({
            success: true,
            date: businessDate,
            count: rows.length,
            reservations: rows,
            dayuse_count: dayuse_reservations.length,
            dayuse_reservations
        });
    } catch (err) {
        return NextResponse.json({ error: String(err) }, { status: 500 });
    }
}
