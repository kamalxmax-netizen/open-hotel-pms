import { createServerSupabaseClient } from "@/lib/supabase/server";
import { requireStaffAuth } from "@/lib/server-auth";
import { getBusinessDate } from "@/lib/fo-prepare";
import { NextRequest, NextResponse } from "next/server";
import { unstable_noStore as noStore } from "next/cache";
import { isValidDateString } from "@/lib/dates";
import { buildReservationLoyaltyMap } from "@/lib/server-guest-loyalty";
import { applyVisibleTotal, fetchReservationVisibleTotals } from "@/lib/reservation-visible-total";
import { mapEffectiveReservationAlert } from "@/lib/reservation-alerts";
import { resolveHotelCheckOutTime, resolveLinkedStayBatch } from "@/lib/linked-stay";

export async function GET(request: NextRequest) {
    noStore();
    try {
        const supabase = createServerSupabaseClient();
        const auth = await requireStaffAuth(supabase, request);
        if (auth.error) return auth.error;
        const requestedDate = request.nextUrl.searchParams.get("date");
        if (requestedDate && !isValidDateString(requestedDate)) {
            return NextResponse.json({ error: "Invalid date format. Use YYYY-MM-DD." }, { status: 400 });
        }
        const businessDate = await getBusinessDate(supabase, requestedDate);

        const baseSelect = `
                id,
                booking_code,
                booking_group_id,
                guest_name,
                phone,
                source,
                status,
                guest_profile_id,
                checkin_date,
                checkout_date,
                checkin_time,
                discount_type,
                discount_value,
                discount_percent,
                do_not_move_assigned_room,
                do_not_move_reason,
                no_show_fee,
                note,
                total_price,
                reservation_nights!inner(
                    stay_date,
                    room_id,
                    room_type_id,
                    rooms(room_number),
                    room_types(name_en)
                ),
                reservation_traces(id, status, dept, loan_item_code),
                reservation_alerts(*, alert_codes(code, description, dept, auto_on_co, icon), alert_templates(id, code, name, description, category, display_surfaces, severity, is_active, sort_order, icon))
            `;
        const withCheckedInAtSelect = `
                id,
                booking_code,
                booking_group_id,
                guest_name,
                phone,
                source,
                status,
                guest_profile_id,
                checkin_date,
                checkout_date,
                checkin_time,
                checked_in_at,
                discount_type,
                discount_value,
                discount_percent,
                do_not_move_assigned_room,
                do_not_move_reason,
                no_show_fee,
                note,
                total_price,
                reservation_nights!inner(
                    stay_date,
                    room_id,
                    room_type_id,
                    rooms(room_number),
                    room_types(name_en)
                ),
                reservation_traces(id, status, dept, loan_item_code),
                reservation_alerts(*, alert_codes(code, description, dept, auto_on_co, icon), alert_templates(id, code, name, description, category, display_surfaces, severity, is_active, sort_order, icon))
            `;

        // Get all arrivals today with room info, traces, and alerts
        const withCheckedIn = await supabase
            .from("reservations")
            .select(withCheckedInAtSelect)
            .eq("checkin_date", businessDate)
            .eq("status", "active")
            .eq("reservation_nights.stay_date", businessDate)
            .is("reservation_nights.cancelled_at", null)
            .order("checkin_time", { ascending: true, nullsFirst: false });

        let rows: any[] = [];
        if (withCheckedIn.error && /checked_in_at/i.test(withCheckedIn.error.message)) {
            const fallback = await supabase
                .from("reservations")
                .select(baseSelect)
                .eq("checkin_date", businessDate)
                .eq("status", "active")
                .eq("reservation_nights.stay_date", businessDate)
                .is("reservation_nights.cancelled_at", null)
                .order("checkin_time", { ascending: true, nullsFirst: false });
            if (fallback.error) {
                return NextResponse.json({ error: fallback.error.message }, { status: 500 });
            }
            rows = fallback.data ?? [];
        } else {
            if (withCheckedIn.error) {
                return NextResponse.json({ error: withCheckedIn.error.message }, { status: 500 });
            }
            rows = withCheckedIn.data ?? [];
        }

        const groupIds = Array.from(
            new Set(
                rows
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

        // Exclude already checked-in reservations using checked_in_at and audit log evidence.
        const reservationIds = rows.map((r) => String(r.id));
        const checkedInSet = new Set<string>();
        if (reservationIds.length > 0) {
            const { data: logs } = await supabase
                .from("audit_logs")
                .select("entity_id")
                .eq("entity_type", "reservation")
                .eq("action", "checked_in")
                .in("entity_id", reservationIds);
            (logs ?? []).forEach((log: any) => checkedInSet.add(String(log.entity_id)));
        }

        const hotelCheckOutTime = await resolveHotelCheckOutTime(supabase);
        const linkedStayMap = await resolveLinkedStayBatch(
            supabase,
            rows.map((r: any) => ({
                id: String(r.id),
                parent_reservation_id: r.parent_reservation_id ?? null,
                booking_code: r.booking_code ?? null,
                source: r.source ?? null,
                checkin_date: r.checkin_date ?? null,
                checkout_date: r.checkout_date ?? null,
                status: r.status ?? null,
                total_price: r.total_price ?? null,
            })),
            hotelCheckOutTime,
            { activeDate: businessDate }
        );
        const profileSeed = new Map<string, string | null>();
        for (const row of rows) {
            const reservationId = row?.id ? String(row.id) : "";
            if (!reservationId) continue;
            profileSeed.set(
                reservationId,
                row?.guest_profile_id ? String(row.guest_profile_id) : null
            );
        }
        const loyaltyByReservationId = await buildReservationLoyaltyMap(
            supabase,
            reservationIds,
            profileSeed
        );
        const visibleExtraByReservationId = await fetchReservationVisibleTotals(supabase, reservationIds);
        const pendingRows = rows.filter((r: any) => {
            const reservationId = String(r.id);
            if (r.checked_in_at || checkedInSet.has(reservationId)) return false;
            const linkedStay = linkedStayMap.get(reservationId) ?? null;
            if (linkedStay && linkedStay.segments.length > 1 && linkedStay.active_segment_id === reservationId) {
                return false;
            }
            return true;
        });

        const arrivals = pendingRows
            .map((r: any) => {
            const groupId = r.booking_group_id ? String(r.booking_group_id) : null;
            const groupMeta = groupId ? groupMetaById.get(groupId) : null;
            const night = Array.isArray(r.reservation_nights) ? r.reservation_nights[0] : r.reservation_nights;
            const roomNumber = night?.rooms?.room_number ?? null;
            const roomType = night?.room_types?.name_en ?? "Unknown Type";
            const roomTypeId = night?.room_type_id != null ? String(night.room_type_id) : "";

            const open_traces_count = Array.isArray(r.reservation_traces)
                ? r.reservation_traces.filter((t: any) => t.status === "open" && !t.loan_item_code && t.dept === "FD").length
                : 0;

            const alertRows = Array.isArray(r.reservation_alerts)
                ? r.reservation_alerts.map((a: any) => mapEffectiveReservationAlert(a)).filter((a: any) => !a.is_dismissed && a.display_surfaces.includes("arrivals"))
                : [];

            const loyalty = loyaltyByReservationId.get(String(r.id));
            const linkedStay = linkedStayMap.get(String(r.id)) ?? null;
            return {
                id: r.id,
                booking_code: r.booking_code,
                booking_group_id: groupId,
                group_code: groupMeta?.group_code ?? null,
                group_name: groupMeta?.group_name ?? null,
                guest_name: r.guest_name,
                phone: r.phone,
                source: r.source,
                checkin_date: r.checkin_date,
                checkout_date: r.checkout_date,
                checkin_time: r.checkin_time,
                do_not_move_assigned_room: Boolean(r.do_not_move_assigned_room),
                do_not_move_reason: r.do_not_move_reason ?? null,
                no_show_fee: r.no_show_fee ?? null,
                note: r.note,
                total_price: applyVisibleTotal(r.total_price, visibleExtraByReservationId.get(String(r.id)), {
                    discountType: r.discount_type,
                    discountValue: r.discount_value,
                    discountPercent: r.discount_percent,
                    checkinDate: r.checkin_date,
                    checkoutDate: r.checkout_date,
                }),
                room_number: roomNumber ?? "—",
                room_type_id: roomTypeId,
                room_type: roomType,
                nights: Math.round(
                    (new Date(r.checkout_date).getTime() - new Date(r.checkin_date).getTime()) / 86400000
                ),
                vip_tier: loyalty?.vip_tier ?? null,
                stay_count: loyalty?.stay_count ?? 0,
                night_count: loyalty?.night_count ?? 0,
                main_stay_count: loyalty?.main_stay_count ?? 0,
                main_night_count: loyalty?.main_night_count ?? 0,
                accompanying_stay_count: loyalty?.accompanying_stay_count ?? 0,
                accompanying_night_count: loyalty?.accompanying_night_count ?? 0,
                open_traces_count,
                alerts: alertRows.map((a: any) => a.alert_code ?? a.template_code ?? "ALERT"),
                alert_count: alertRows.length,
                first_alert_message: alertRows[0]?.message ?? null,
                linked_stay: linkedStay && linkedStay.segments.length > 1 ? linkedStay : null,
            };
        });

        return NextResponse.json({ success: true, date: businessDate, count: arrivals.length, arrivals });
    } catch (err) {
        return NextResponse.json({ error: String(err) }, { status: 500 });
    }
}
