import {
  getBusinessDate,
  MobileCheckinError,
  requireMobileCheckinAuth,
} from "@/lib/mobile-checkin";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { NextRequest, NextResponse } from "next/server";

export const dynamic = "force-dynamic";
export const fetchCache = "force-no-store";

function toSortableRoom(value: string | null): string {
  return String(value ?? "").trim();
}

export async function GET(request: NextRequest) {
  try {
    const supabase = createServerSupabaseClient();
    await requireMobileCheckinAuth(supabase, request);

    const businessDate = await getBusinessDate(supabase);

    const { data: dueRows, error: dueError } = await supabase
      .from("reservations")
      .select("id, booking_group_id, guest_name")
      .eq("checkin_date", businessDate)
      .in("status", ["active", "draft_checkin"])
      .is("checked_in_at", null)
      .not("booking_group_id", "is", null)
      .order("booking_group_id", { ascending: true })
      .order("id", { ascending: true });

    if (dueError) {
      throw new MobileCheckinError(dueError.message, 500, "DUE_GROUPS_READ_FAILED");
    }

    const dueReservations = (dueRows ?? []).map((row: any) => ({
      reservation_id: String(row.id ?? ""),
      booking_group_id: String(row.booking_group_id ?? ""),
      guest_name: String(row.guest_name ?? "").trim(),
    })).filter((row) => row.reservation_id && row.booking_group_id);

    if (dueReservations.length === 0) {
      return NextResponse.json({
        success: true,
        business_date: businessDate,
        groups: [],
      });
    }

    const groupIds = Array.from(new Set(dueReservations.map((row) => row.booking_group_id)));
    const reservationIds = dueReservations.map((row) => row.reservation_id);

    const [{ data: groupRows, error: groupError }, { data: nightRows, error: nightError }, { data: scanRows, error: scanError }] = await Promise.all([
      supabase
        .from("booking_groups")
        .select("id, group_code, group_name, status")
        .in("id", groupIds),
      supabase
        .from("reservation_nights")
        .select("reservation_id, room_id, rooms(room_number)")
        .in("reservation_id", reservationIds)
        .eq("stay_date", businessDate)
        .is("cancelled_at", null),
      supabase
        .from("passport_scans")
        .select("booking_group_id")
        .in("booking_group_id", groupIds)
        .not("pool_status", "is", null),
    ]);

    if (groupError) {
      throw new MobileCheckinError(groupError.message, 500, "GROUP_READ_FAILED");
    }
    if (nightError) {
      throw new MobileCheckinError(nightError.message, 500, "NIGHTS_READ_FAILED");
    }
    if (scanError) {
      throw new MobileCheckinError(scanError.message, 500, "SCANS_READ_FAILED");
    }

    const groupById = new Map<string, { group_code: string; group_name: string; status: string }>();
    for (const row of groupRows ?? []) {
      const id = String((row as any).id ?? "");
      if (!id) continue;
      groupById.set(id, {
        group_code: String((row as any).group_code ?? ""),
        group_name: String((row as any).group_name ?? ""),
        status: String((row as any).status ?? "active"),
      });
    }

    const roomByReservation = new Map<string, string | null>();
    for (const row of nightRows ?? []) {
      const reservationId = String((row as any).reservation_id ?? "");
      if (!reservationId || roomByReservation.has(reservationId)) continue;
      const roomRef = Array.isArray((row as any).rooms)
        ? (row as any).rooms[0]
        : (row as any).rooms;
      roomByReservation.set(
        reservationId,
        roomRef?.room_number ? String(roomRef.room_number) : null
      );
    }

    const scanCountByGroup = new Map<string, number>();
    for (const row of scanRows ?? []) {
      const groupId = String((row as any).booking_group_id ?? "").trim();
      if (!groupId) continue;
      scanCountByGroup.set(groupId, (scanCountByGroup.get(groupId) ?? 0) + 1);
    }

    const groupedReservations = new Map<string, typeof dueReservations>();
    for (const row of dueReservations) {
      const list = groupedReservations.get(row.booking_group_id) ?? [];
      list.push(row);
      groupedReservations.set(row.booking_group_id, list);
    }

    const groups = Array.from(groupedReservations.entries())
      .map(([groupId, rows]) => {
        const group = groupById.get(groupId);
        const rooms = rows
          .map((row) => ({
            reservation_id: row.reservation_id,
            room_number: roomByReservation.get(row.reservation_id) ?? "—",
            guest_name: row.guest_name,
          }))
          .sort((a, b) =>
            toSortableRoom(a.room_number).localeCompare(toSortableRoom(b.room_number), undefined, {
              numeric: true,
              sensitivity: "base",
            })
          );

        return {
          booking_group_id: groupId,
          group_code: group?.group_code || "",
          group_name: group?.group_name || `Group ${groupId.slice(0, 8)}`,
          total_rooms: rows.length,
          scanned_count: scanCountByGroup.get(groupId) ?? 0,
          rooms,
        };
      })
      .sort((a, b) => a.group_name.localeCompare(b.group_name, undefined, { sensitivity: "base" }));

    return NextResponse.json({
      success: true,
      business_date: businessDate,
      groups,
    });
  } catch (error) {
    if (error instanceof MobileCheckinError) {
      return NextResponse.json(
        {
          success: false,
          error: error.message,
          code: error.code,
        },
        { status: error.status }
      );
    }

    const message = error instanceof Error ? error.message : "Internal server error";
    return NextResponse.json({ success: false, error: message }, { status: 500 });
  }
}
