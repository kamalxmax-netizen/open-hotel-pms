import { createServerSupabaseClient } from "@/lib/supabase/server";
import { NextRequest, NextResponse } from "next/server";
import { applyVisibleTotal, fetchReservationVisibleTotals } from "@/lib/reservation-visible-total";
import { resolveHotelCheckOutTime, resolveLinkedStayBatch } from "@/lib/linked-stay";

export async function GET(request: NextRequest) {
    try {
        const supabase = createServerSupabaseClient();
        const sp = request.nextUrl.searchParams;

        const q = sp.get("q")?.trim() ?? "";                    // guest name search
        const phone = sp.get("phone")?.trim() ?? "";            // phone search
        const status = sp.get("status") ?? "";                  // active|cancelled|checked_out|no_show|all
        const source = sp.get("source") ?? "";                  // walkin|ota|direct|agent
        const dateFrom = sp.get("date_from") ?? "";
        const dateTo = sp.get("date_to") ?? "";
        const checkoutFrom = sp.get("checkout_from") ?? "";
        const checkoutTo = sp.get("checkout_to") ?? "";
        const page = Math.max(1, parseInt(sp.get("page") ?? "1", 10));
        const pageSize = 30;
        const offset = (page - 1) * pageSize;

        const useCheckoutDateRange = status === "checked_out";

        const selectWithTimes = `
        id,
        booking_code,
        booking_group_id,
        parent_reservation_id,
        guest_name,
        phone,
        source,
        status,
        checkin_date,
        checkout_date,
        discount_type,
        discount_value,
        discount_percent,
        checkin_time,
        checked_in_at,
        checked_out_at,
        note,
        total_price,
        created_at,
        reservation_nights!inner(
          stay_date,
          cancelled_at,
          room_id,
          room_types(name_en),
          rooms(room_number)
        )
      `;
        const selectFallback = `
        id,
        booking_code,
        booking_group_id,
        parent_reservation_id,
        guest_name,
        phone,
        source,
        status,
        checkin_date,
        checkout_date,
        discount_type,
        discount_value,
        discount_percent,
        checkin_time,
        note,
        total_price,
        created_at,
        reservation_nights!inner(
          stay_date,
          cancelled_at,
          room_id,
          room_types(name_en),
          rooms(room_number)
        )
      `;

        const buildQuery = (selectFields: string) => {
            let query = supabase
                .from("reservations")
                .select(selectFields, { count: "exact" })
                .order("status", { ascending: true })
                .order("checkin_date", { ascending: false })
                .range(offset, offset + pageSize - 1);

            if (q) query = query.or(`guest_name.ilike.%${q}%,booking_code.ilike.%${q}%`);
            if (phone) query = query.ilike("phone", `%${phone}%`);
            if (status && status !== "all") query = query.eq("status", status);
            if (source) query = query.eq("source", source);
            if (dateFrom) query = query.gte(useCheckoutDateRange ? "checkout_date" : "checkin_date", dateFrom);
            if (dateTo) query = query.lte(useCheckoutDateRange ? "checkout_date" : "checkin_date", dateTo);
            if (checkoutFrom) query = query.gte("checkout_date", checkoutFrom);
            if (checkoutTo) query = query.lte("checkout_date", checkoutTo);
            return query;
        };

        let { data, error, count } = await buildQuery(selectWithTimes);
        if (error && /checked_in_at|checked_out_at/i.test(error.message)) {
            const fallbackRes = await buildQuery(selectFallback);
            data = fallbackRes.data;
            error = fallbackRes.error;
            count = fallbackRes.count;
        }
        if (error) return NextResponse.json({ error: error.message }, { status: 500 });

        const rows = (data ?? []) as any[];
        const reservationIds = rows.map((r: any) => String(r.id));
        const visibleExtraByReservationId = await fetchReservationVisibleTotals(supabase, reservationIds);

        // Fallback checkout timestamp map:
        // Some environments may not have reservations.checked_out_at yet.
        // In that case, derive checkout time from audit_logs(action="checked_out").
        const checkoutAuditMap = new Map<string, string>();
        const checkoutIdsNeedingFallback = rows
            .filter((r: any) => r?.status === "checked_out" && !r?.checked_out_at)
            .map((r: any) => String(r.id));

        if (checkoutIdsNeedingFallback.length > 0) {
            const { data: checkoutLogs, error: checkoutLogsError } = await supabase
                .from("audit_logs")
                .select("entity_id, created_at, after_json")
                .eq("entity_type", "reservation")
                .eq("action", "checked_out")
                .in("entity_id", checkoutIdsNeedingFallback)
                .order("created_at", { ascending: false });

            if (checkoutLogsError) {
                return NextResponse.json({ error: checkoutLogsError.message }, { status: 500 });
            }

            for (const log of checkoutLogs ?? []) {
                const entityId = String((log as any).entity_id ?? "");
                if (!entityId || checkoutAuditMap.has(entityId)) continue;
                const afterJson = (log as any).after_json as Record<string, unknown> | null;
                const afterCheckedOutAt =
                    afterJson && typeof afterJson.checked_out_at === "string"
                        ? afterJson.checked_out_at
                        : null;
                const createdAt = typeof (log as any).created_at === "string"
                    ? (log as any).created_at
                    : null;
                const fallbackIso = afterCheckedOutAt || createdAt;
                if (fallbackIso) checkoutAuditMap.set(entityId, fallbackIso);
            }
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

        const checkOutTimeHHmm = await resolveHotelCheckOutTime(supabase);

        // Batch resolve linked stays (2 queries instead of 3 per row)
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
            checkOutTimeHHmm
        );

        // Pick display room from active night first; fallback to first historical night (e.g. cancelled bookings).
        const reservations = rows.map((r: any) => {
            const groupId = r.booking_group_id ? String(r.booking_group_id) : null;
            const groupMeta = groupId ? groupMetaById.get(groupId) : null;
            const linkedStay = linkedStayMap.get(String(r.id)) ?? null;
            const nights = (Array.isArray(r.reservation_nights)
                ? r.reservation_nights
                : r.reservation_nights
                    ? [r.reservation_nights]
                    : []
            ).sort((a: any, b: any) => String(a?.stay_date ?? "").localeCompare(String(b?.stay_date ?? "")));
            const activeNights = nights.filter((n: any) => !n?.cancelled_at);
            const displayNight =
                r.status === "checked_out"
                    ? activeNights[activeNights.length - 1] ?? nights[nights.length - 1] ?? null
                    : activeNights[0] ?? nights[0] ?? null;
            const roomRef = Array.isArray((displayNight as any)?.rooms)
                ? (displayNight as any).rooms[0]
                : (displayNight as any)?.rooms;
            const roomTypeRef = Array.isArray((displayNight as any)?.room_types)
                ? (displayNight as any).room_types[0]
                : (displayNight as any)?.room_types;
            const roomNumber = roomRef?.room_number ?? "—";
            const roomType = roomTypeRef?.name_en ?? "—";
            return {
                id: r.id,
                booking_code: r.booking_code,
                booking_group_id: groupId,
                group_code: groupMeta?.group_code ?? null,
                group_name: groupMeta?.group_name ?? null,
                guest_name: r.guest_name,
                phone: r.phone,
                source: r.source,
                status: r.status,
                checkin_date: r.checkin_date,
                checkout_date: r.checkout_date,
                checkin_time: r.checkin_time,
                checked_in_at: r.checked_in_at ?? null,
                checked_out_at: r.checked_out_at ?? checkoutAuditMap.get(String(r.id)) ?? null,
                note: r.note,
                total_price: applyVisibleTotal(r.total_price, visibleExtraByReservationId.get(String(r.id)), {
                    discountType: r.discount_type,
                    discountValue: r.discount_value,
                    discountPercent: r.discount_percent,
                    checkinDate: r.checkin_date,
                    checkoutDate: r.checkout_date,
                }),
                created_at: r.created_at,
                room_number: roomNumber,
                room_type: roomType,
                parent_reservation_id: r.parent_reservation_id ?? null,
                linked_segments: linkedStay?.segments ?? null,
                linked_full_checkin: linkedStay?.full_checkin ?? null,
                linked_full_checkout: linkedStay?.full_checkout ?? null,
                linked_active_segment_id: linkedStay?.active_segment_id ?? null,
                nights: Math.round(
                    (new Date(r.checkout_date).getTime() - new Date(r.checkin_date).getTime()) / 86400000
                )
            };
        });

        return NextResponse.json({
            success: true,
            total: count ?? 0,
            page,
            page_size: pageSize,
            reservations
        });
    } catch (err) {
        return NextResponse.json({ error: String(err) }, { status: 500 });
    }
}
