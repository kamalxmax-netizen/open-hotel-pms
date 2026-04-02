import { isValidDateString } from "@/lib/dates";
import { MobileCheckinError, requireMobileCheckinAuth } from "@/lib/mobile-checkin";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { NextRequest, NextResponse } from "next/server";

export const dynamic = "force-dynamic";
export const fetchCache = "force-no-store";

function normalizeQuery(value: string): string {
  return String(value ?? "").trim().toLowerCase();
}

export async function GET(request: NextRequest) {
  try {
    const supabase = createServerSupabaseClient();
    await requireMobileCheckinAuth(supabase, request);

    const checkin = String(request.nextUrl.searchParams.get("checkin") ?? "").trim();
    const q = normalizeQuery(String(request.nextUrl.searchParams.get("q") ?? ""));

    if (!checkin || !isValidDateString(checkin)) {
      throw new MobileCheckinError("checkin is required in YYYY-MM-DD format.", 400, "INVALID_CHECKIN");
    }

    const { data: reservationRows, error: reservationError } = await supabase
      .from("reservations")
      .select("id, booking_code, booking_group_id, guest_name, checkin_date, checkout_date, total_price, status, checked_in_at")
      .eq("checkin_date", checkin)
      .eq("status", "active")
      .is("checked_in_at", null)
      .order("guest_name", { ascending: true });

    if (reservationError) {
      throw new MobileCheckinError(reservationError.message, 500, "RESERVATION_QUERY_FAILED");
    }

    const reservations = (reservationRows ?? []).map((row: any) => ({
      id: String(row.id),
      booking_code: String(row.booking_code ?? ""),
      booking_group_id: row.booking_group_id ? String(row.booking_group_id) : null,
      guest_name: String(row.guest_name ?? "").trim(),
      checkin_date: String(row.checkin_date ?? ""),
      checkout_date: String(row.checkout_date ?? ""),
      total_price: Number(row.total_price ?? 0),
    }));

    const reservationIds = reservations.map((row) => row.id);
    const groupIds = Array.from(
      new Set(reservations.map((row) => row.booking_group_id).filter((value): value is string => Boolean(value)))
    );

    const roomByReservation = new Map<string, string | null>();
    if (reservationIds.length > 0) {
      const { data: nightRows, error: nightError } = await supabase
        .from("reservation_nights")
        .select("reservation_id, rooms(room_number)")
        .in("reservation_id", reservationIds)
        .eq("stay_date", checkin)
        .is("cancelled_at", null);

      if (nightError) {
        throw new MobileCheckinError(nightError.message, 500, "NIGHT_QUERY_FAILED");
      }

      for (const row of nightRows ?? []) {
        const reservationId = String((row as any).reservation_id ?? "");
        if (!reservationId || roomByReservation.has(reservationId)) continue;
        const roomRef = Array.isArray((row as any).rooms) ? (row as any).rooms[0] : (row as any).rooms;
        roomByReservation.set(reservationId, roomRef?.room_number ? String(roomRef.room_number) : null);
      }
    }

    const groupMetaById = new Map<string, { group_code: string | null; group_name: string | null; member_count: number }>();
    if (groupIds.length > 0) {
      const [{ data: groupRows, error: groupError }, { data: memberRows, error: memberError }] = await Promise.all([
        supabase.from("booking_groups").select("id, group_code, group_name").in("id", groupIds),
        supabase.from("reservations").select("booking_group_id").in("booking_group_id", groupIds).eq("status", "active"),
      ]);

      if (groupError) {
        throw new MobileCheckinError(groupError.message, 500, "GROUP_QUERY_FAILED");
      }
      if (memberError) {
        throw new MobileCheckinError(memberError.message, 500, "GROUP_MEMBER_QUERY_FAILED");
      }

      const memberCountByGroup = new Map<string, number>();
      for (const row of memberRows ?? []) {
        const groupId = String((row as any).booking_group_id ?? "");
        if (!groupId) continue;
        memberCountByGroup.set(groupId, (memberCountByGroup.get(groupId) ?? 0) + 1);
      }

      for (const row of groupRows ?? []) {
        const groupId = String((row as any).id ?? "");
        if (!groupId) continue;
        groupMetaById.set(groupId, {
          group_code: (row as any).group_code ? String((row as any).group_code) : null,
          group_name: (row as any).group_name ? String((row as any).group_name) : null,
          member_count: memberCountByGroup.get(groupId) ?? 0,
        });
      }
    }

    const items = reservations
      .map((row) => {
        const groupMeta = row.booking_group_id ? groupMetaById.get(row.booking_group_id) : null;
        return {
          reservation_id: row.id,
          booking_code: row.booking_code,
          guest_name: row.guest_name,
          room_number: roomByReservation.get(row.id) ?? null,
          checkin_date: row.checkin_date,
          checkout_date: row.checkout_date,
          total_price: row.total_price,
          booking_group_id: row.booking_group_id,
          group_code: groupMeta?.group_code ?? null,
          group_name: groupMeta?.group_name ?? null,
          group_member_count: groupMeta?.member_count ?? 0,
        };
      })
      .filter((row) => {
        if (!q) return true;
        return [
          row.booking_code,
          row.guest_name,
          row.room_number ?? "",
          row.group_code ?? "",
          row.group_name ?? "",
        ].some((value) => normalizeQuery(value).includes(q));
      })
      .sort((left, right) => {
        const roomA = Number.parseInt(String(left.room_number ?? ""), 10);
        const roomB = Number.parseInt(String(right.room_number ?? ""), 10);
        if (Number.isFinite(roomA) && Number.isFinite(roomB) && roomA !== roomB) {
          return roomA - roomB;
        }
        return left.guest_name.localeCompare(right.guest_name, undefined, { sensitivity: "base" });
      });

    return NextResponse.json({
      success: true,
      data: {
        checkin,
        items,
      },
    });
  } catch (error) {
    if (error instanceof MobileCheckinError) {
      return NextResponse.json({ success: false, error: error.message, code: error.code }, { status: error.status });
    }
    return NextResponse.json({ success: false, error: String(error) }, { status: 500 });
  }
}
