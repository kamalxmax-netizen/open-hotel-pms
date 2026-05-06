import { NextRequest, NextResponse } from "next/server";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { requireStaffAuth } from "@/lib/server-auth";
import { deriveBookingGroupStatus } from "@/lib/booking-group-status";

function toNumber(value: unknown): number {
    const num = typeof value === "number" ? value : Number(value);
    return Number.isFinite(num) ? num : 0;
}

export async function GET(request: NextRequest, context: { params: Promise<{ id: string }> }) {
    try {
        const supabase = createServerSupabaseClient();
        const auth = await requireStaffAuth(supabase, request, { denyRoles: [] });
        if (auth.error) return auth.error;
        const isOwnerReadOnly = auth.role === "owner";

        const { id } = await context.params;

        if (!id) {
            return NextResponse.json({ success: false, error: "Missing group ID" }, { status: 400 });
        }

        // 1. Fetch Group Info
        const { data: groupRow, error: groupError } = await supabase
            .from("booking_groups")
            .select("*")
            .eq("id", id)
            .single();

        if (groupError) {
            return NextResponse.json({ success: false, error: groupError.message }, { status: 500 });
        }
        if (!groupRow) {
            return NextResponse.json({ success: false, error: "Group not found" }, { status: 404 });
        }
        let group: any = groupRow;

        const { data: settingsRow, error: settingsError } = await supabase
            .from("hotel_settings")
            .select("business_date")
            .eq("id", 1)
            .maybeSingle();

        if (settingsError) {
            return NextResponse.json({ success: false, error: settingsError.message }, { status: 500 });
        }
        const businessDate = String(settingsRow?.business_date ?? "").trim();

        // 2. Fetch Reservations in this group
        const { data: rawReservations, error: resError } = await supabase
            .from("reservations")
            .select(`
        id,
        booking_code,
        guest_name,
        checkin_time,
        checkin_date,
        checkout_date,
        status,
        total_price,
        deposit_amount,
        deposit_note,
        created_at,
        reservation_nights (
          stay_date,
          cancelled_at,
          nightly_price,
          room_types (
            name_en
          ),
          rooms (
            room_number,
            room_types (
              name_en
            )
          )
        )
      `)
            .eq("booking_group_id", id)
            .order("created_at", { ascending: false });

        if (resError) {
            return NextResponse.json({ success: false, error: resError.message }, { status: 500 });
        }

        const reservationIds = (rawReservations ?? []).map((r: any) => String(r.id));
        const derivedGroupStatus = deriveBookingGroupStatus(
            group.status,
            (rawReservations ?? []).map((r: any) => r?.status)
        );
        if (!isOwnerReadOnly && String(group.status ?? "").toLowerCase() !== derivedGroupStatus) {
            const { data: updatedGroup, error: statusUpdateError } = await supabase
                .from("booking_groups")
                .update({ status: derivedGroupStatus, updated_at: new Date().toISOString() })
                .eq("id", id)
                .select("*")
                .maybeSingle();

            if (!statusUpdateError && updatedGroup) {
                group = updatedGroup;
            } else {
                group = { ...group, status: derivedGroupStatus };
                if (statusUpdateError) {
                    console.error("booking-group detail status sync failed:", id, statusUpdateError.message);
                }
            }
        } else if (isOwnerReadOnly && String(group.status ?? "").toLowerCase() !== derivedGroupStatus) {
            group = { ...group, status: derivedGroupStatus };
        }
        const checkedInByReservation = new Map<string, string>();
        if (reservationIds.length > 0) {
            const { data: logs, error: logsError } = await supabase
                .from("audit_logs")
                .select("entity_id, created_at")
                .eq("entity_type", "reservation")
                .eq("action", "checked_in")
                .in("entity_id", reservationIds);

            if (logsError) {
                return NextResponse.json({ success: false, error: logsError.message }, { status: 500 });
            }

            (logs ?? []).forEach((log: any) => {
                const reservationId = String(log.entity_id);
                const createdAt = String(log.created_at);
                const previous = checkedInByReservation.get(reservationId);
                if (!previous || createdAt > previous) {
                    checkedInByReservation.set(reservationId, createdAt);
                }
            });
        }

        // Format reservations
        const reservations = rawReservations?.map((r: any) => {
            const nights = (Array.isArray(r.reservation_nights)
                ? r.reservation_nights
                : r.reservation_nights
                    ? [r.reservation_nights]
                    : []
            ).sort((a: any, b: any) => String(a?.stay_date ?? "").localeCompare(String(b?.stay_date ?? "")));

            const activeNight = nights.find((n: any) => !n?.cancelled_at);
            const displayNight = activeNight ?? nights[0] ?? null;

            const roomRef = Array.isArray(displayNight?.rooms)
                ? displayNight.rooms[0]
                : displayNight?.rooms;
            const roomTypeFromRoom = Array.isArray(roomRef?.room_types)
                ? roomRef.room_types[0]
                : roomRef?.room_types;
            const roomTypeFromNight = Array.isArray(displayNight?.room_types)
                ? displayNight.room_types[0]
                : displayNight?.room_types;

            const activeNights = nights.filter((n: any) => !n?.cancelled_at);
            const nightsForTotal = activeNights.length > 0 ? activeNights : nights;
            const fallbackTotal = nightsForTotal.reduce((sum: number, n: any) => sum + toNumber(n?.nightly_price), 0);
            const persistedTotal = toNumber(r.total_price);
            const effectiveTotal = persistedTotal > 0 ? persistedTotal : fallbackTotal;
            const checkedInAt = checkedInByReservation.get(String(r.id)) ?? null;

            return {
                ...r,
                total_price: Number(effectiveTotal.toFixed(2)),
                deposit_amount: Number(r.deposit_amount ?? 0),
                deposit_note: r.deposit_note ?? null,
                checked_in_at: checkedInAt,
                is_checked_in: Boolean(checkedInAt),
                room_number: roomRef?.room_number || "Unassigned",
                room_type: roomTypeFromRoom?.name_en || roomTypeFromNight?.name_en || "Unknown"
            };
        }) || [];

        return NextResponse.json({
            success: true,
            group: { ...group, business_date: businessDate || null },
            reservations
        });
    } catch (err: any) {
        return NextResponse.json({ success: false, error: err.message }, { status: 500 });
    }
}

export async function PATCH(request: NextRequest, context: { params: Promise<{ id: string }> }) {
    try {
        const supabase = createServerSupabaseClient();
        const auth = await requireStaffAuth(supabase, request);
        if (auth.error) return auth.error;

        const { id } = await context.params;
        const body = await request.json();

        if (!id) {
            return NextResponse.json({ success: false, error: "Missing group ID" }, { status: 400 });
        }

        const { data: existingGroup, error: existingGroupError } = await supabase
            .from("booking_groups")
            .select("id, status")
            .eq("id", id)
            .maybeSingle();

        if (existingGroupError) {
            return NextResponse.json({ success: false, error: existingGroupError.message }, { status: 500 });
        }
        if (!existingGroup) {
            return NextResponse.json({ success: false, error: "Group not found" }, { status: 404 });
        }
        if (String(existingGroup.status ?? "").toLowerCase() === "completed") {
            return NextResponse.json(
                { success: false, error: "Completed group is locked and cannot be edited." },
                { status: 409 }
            );
        }

        const payload: any = {};
        if (body.group_name !== undefined) payload.group_name = body.group_name;
        if (body.contact_name !== undefined) payload.contact_name = body.contact_name;
        if (body.contact_phone !== undefined) payload.contact_phone = body.contact_phone;
        if (body.contact_email !== undefined) payload.contact_email = body.contact_email;
        if (body.source !== undefined) payload.source = body.source;
        if (body.note !== undefined) payload.note = body.note;
        if (body.status !== undefined) payload.status = body.status;

        payload.updated_at = new Date().toISOString();

        const { data, error } = await supabase
            .from("booking_groups")
            .update(payload)
            .eq("id", id)
            .select()
            .single();

        if (error) {
            return NextResponse.json({ success: false, error: error.message }, { status: 500 });
        }

        return NextResponse.json({ success: true, group: data });
    } catch (err: any) {
        return NextResponse.json({ success: false, error: err.message }, { status: 500 });
    }
}

export async function DELETE(
    request: NextRequest,
    context: { params: Promise<{ id: string }> }
) {
    try {
        const supabase = createServerSupabaseClient();
        const auth = await requireStaffAuth(supabase, request);
        if (auth.error) return auth.error;

        const { id } = await context.params;

        if (!id) {
            return NextResponse.json({ success: false, error: "Missing group ID" }, { status: 400 });
        }

        const { data: group, error: groupError } = await supabase
            .from("booking_groups")
            .select("id, group_code, status")
            .eq("id", id)
            .maybeSingle();

        if (groupError) {
            return NextResponse.json({ success: false, error: groupError.message }, { status: 500 });
        }
        if (!group) {
            return NextResponse.json({ success: false, error: "Group not found" }, { status: 404 });
        }

        if (String(group.status ?? "").toLowerCase() === "cancelled") {
            return NextResponse.json({
                success: true,
                unchanged: true,
                unlinked_count: 0,
                group,
            });
        }

        const { data: linkedReservations, error: linkedReservationsError } = await supabase
            .from("reservations")
            .select("id")
            .eq("booking_group_id", id);

        if (linkedReservationsError) {
            return NextResponse.json({ success: false, error: linkedReservationsError.message }, { status: 500 });
        }

        const linkedReservationIds = (linkedReservations ?? [])
            .map((row: any) => String(row.id ?? ""))
            .filter(Boolean);

        if (linkedReservationIds.length > 0) {
            const { error: unlinkError } = await supabase
                .from("reservations")
                .update({ booking_group_id: null })
                .in("id", linkedReservationIds);

            if (unlinkError) {
                return NextResponse.json({ success: false, error: unlinkError.message }, { status: 500 });
            }
        }

        const { data: updatedGroup, error: updateError } = await supabase
            .from("booking_groups")
            .update({
                status: "cancelled",
                total_rooms: 0,
                updated_at: new Date().toISOString(),
            })
            .eq("id", id)
            .select("*")
            .single();

        if (updateError) {
            return NextResponse.json({ success: false, error: updateError.message }, { status: 500 });
        }

        return NextResponse.json({
            success: true,
            group: updatedGroup,
            unlinked_count: linkedReservationIds.length,
        });
    } catch (err: any) {
        return NextResponse.json({ success: false, error: err.message }, { status: 500 });
    }
}
