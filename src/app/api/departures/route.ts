import { createServerSupabaseClient } from "@/lib/supabase/server";
import { getBusinessDate } from "@/lib/fo-prepare";
import { NextRequest, NextResponse } from "next/server";
import { unstable_noStore as noStore } from "next/cache";
import { isValidDateString } from "@/lib/dates";
import { buildReservationLoyaltyMap } from "@/lib/server-guest-loyalty";
import { applyVisibleTotal, fetchReservationOutstandingBalances, fetchReservationVisibleTotals } from "@/lib/reservation-visible-total";
import { resolveHotelCheckOutTime, resolveLinkedStay } from "@/lib/linked-stay";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
    noStore();
    try {
        const supabase = createServerSupabaseClient();
        const requestedDate = request.nextUrl.searchParams.get("date");
        if (requestedDate && !isValidDateString(requestedDate)) {
            return NextResponse.json({ error: "Invalid date format. Use YYYY-MM-DD." }, { status: 400 });
        }
        const businessDate = await getBusinessDate(supabase, requestedDate);

        const { data, error } = await supabase
            .from("reservations")
            .select(`
                id,
                booking_code,
                booking_group_id,
                parent_reservation_id,
                guest_name,
                phone,
                guest_profile_id,
                source,
                status,
                checkin_date,
                checkout_date,
                discount_type,
                discount_value,
                discount_percent,
                deposit_amount,
                total_price,
                note,
                reservation_nights(
                  stay_date,
                  nightly_price,
                  room_id,
                  cancelled_at,
                  rooms(room_number, room_types(name_en))
                )
            `)
            .eq("checkout_date", businessDate)
            .eq("is_dayuse", false)
            .in("status", ["active", "checked_out"])   // show both pending + already checked out (Opera style)
            .order("guest_name", { ascending: true });

        if (error) {
            return NextResponse.json({ error: error.message }, { status: 500 });
        }

        const groupIds = Array.from(
            new Set(
                (data ?? [])
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

        const reservationIds = (data ?? []).map((row: any) => String(row.id));
        const profileSeed = new Map<string, string | null>();
        for (const row of data ?? []) {
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
        const outstandingByReservationId = await fetchReservationOutstandingBalances(
            supabase,
            (data ?? []).map((r: any) => ({
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

        const departures = await Promise.all(
            (data ?? []).map(async (r) => {
                const groupId = r.booking_group_id ? String(r.booking_group_id) : null;
                const groupMeta = groupId ? groupMetaById.get(groupId) : null;
                // Filter out cancelled nights only if nights exist
                const allNights = Array.isArray(r.reservation_nights) ? r.reservation_nights : [];
                const nights = allNights.filter((n) => n && !n.cancelled_at);
                const firstNight = nights[0] ?? allNights[0] ?? null;
                const room = (firstNight?.rooms as unknown) as { room_number: string; room_types: { name_en: string } | null } | null;
                const nightlyBreakdown = nights
                    .sort((a, b) => (a.stay_date > b.stay_date ? 1 : -1))
                    .map((n) => ({ date: n.stay_date, price: n.nightly_price }));

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
                source: r.source,
                status: r.status,
                checkin_date: r.checkin_date,
                checkout_date: r.checkout_date,
                total_price: applyVisibleTotal(r.total_price, visibleExtraByReservationId.get(String(r.id)), {
                    discountType: r.discount_type,
                    discountValue: r.discount_value,
                    discountPercent: r.discount_percent,
                    checkinDate: r.checkin_date,
                    checkoutDate: r.checkout_date,
                }),
                outstanding_balance: outstandingByReservationId.get(String(r.id)) ?? 0,
                note: r.note,
                room_number: room?.room_number ?? "—",
                room_type: room?.room_types?.name_en ?? "—",
                nights_count: nightlyBreakdown.length,
                nightly_breakdown: nightlyBreakdown,
                vip_tier: loyalty?.vip_tier ?? null,
                stay_count: loyalty?.stay_count ?? 0,
                night_count: loyalty?.night_count ?? 0,
                main_stay_count: loyalty?.main_stay_count ?? 0,
                main_night_count: loyalty?.main_night_count ?? 0,
                accompanying_stay_count: loyalty?.accompanying_stay_count ?? 0,
                accompanying_night_count: loyalty?.accompanying_night_count ?? 0,
                linked_segments: linkedStay?.segments ?? null,
                linked_full_checkin: linkedStay?.full_checkin ?? null,
                linked_full_checkout: linkedStay?.full_checkout ?? null,
                linked_active_segment_id: linkedStay?.active_segment_id ?? null,
            };
            })
        );

        const { data: dayUseRows, error: dayUseError } = await supabase
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
            .eq("checkin_date", businessDate)
            .eq("checkout_date", businessDate)
            .in("status", ["active", "checked_out"])
            .order("updated_at", { ascending: false });

        if (dayUseError) {
            return NextResponse.json({ error: dayUseError.message }, { status: 500 });
        }

        const dayUseReservationIds = (dayUseRows ?? []).map((r: any) => String(r.id));
        if (dayUseReservationIds.length > 0) {
            const dayUseVisibleExtraMap = await fetchReservationVisibleTotals(supabase, dayUseReservationIds);
            for (const [reservationId, extraTotal] of dayUseVisibleExtraMap.entries()) {
                visibleExtraByReservationId.set(reservationId, extraTotal);
            }
        }

        const dayuse_departures = (dayUseRows ?? [])
            .map((r: any) => {
                const nights = Array.isArray(r.reservation_nights)
                    ? r.reservation_nights.filter((n: any) => !n?.cancelled_at && String(n?.stay_date ?? "") === businessDate)
                    : [];
                const night = nights[0] ?? null;
                const room = (night?.rooms as unknown) as { room_number?: string; room_types?: { name_en?: string } | null } | null;
                return {
                    id: String(r.id),
                    booking_code: String(r.booking_code ?? ""),
                    guest_name: String(r.guest_name ?? ""),
                    phone: r.phone ? String(r.phone) : null,
                    status: String(r.status ?? ""),
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
            count: departures.length,
            departures,
            dayuse_count: dayuse_departures.length,
            dayuse_departures
        });
    } catch (err) {
        return NextResponse.json({ error: String(err) }, { status: 500 });
    }
}
