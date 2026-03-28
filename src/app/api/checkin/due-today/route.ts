import { checkProfileCompleteness } from "@/lib/guest-profile-completeness";
import {
  MobileCheckinError,
  getBusinessDate,
  requireMobileCheckinAuth,
  toBangkokDate,
} from "@/lib/mobile-checkin";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { NextRequest, NextResponse } from "next/server";

export const dynamic = "force-dynamic";
export const fetchCache = "force-no-store";

function daysBetween(checkinDate: string, checkoutDate: string): number {
  const inTs = Date.parse(`${checkinDate}T00:00:00Z`);
  const outTs = Date.parse(`${checkoutDate}T00:00:00Z`);
  if (!Number.isFinite(inTs) || !Number.isFinite(outTs)) return 0;
  const nights = Math.round((outTs - inTs) / (24 * 60 * 60 * 1000));
  return Math.max(0, nights);
}

function toSortableRoom(roomNumber: string | null): string {
  return String(roomNumber ?? "").trim();
}

export async function GET(request: NextRequest) {
  try {
    const supabase = createServerSupabaseClient();
    await requireMobileCheckinAuth(supabase, request);

    const businessDate = await getBusinessDate(supabase);

    const { data: dueRows, error: dueError } = await supabase
      .from("reservations")
      .select("id, guest_name, source, checkin_date, checkout_date, total_price, status, guest_profile_id, checked_in_at")
      .eq("checkin_date", businessDate)
      .in("status", ["active", "draft_checkin"])
      .is("checked_in_at", null)
      .order("id", { ascending: true });

    if (dueError) {
      throw new MobileCheckinError(dueError.message, 500, "DUE_QUERY_FAILED");
    }

    const reservations = (dueRows ?? []).map((row: any) => ({
      reservation_id: String(row.id),
      guest_name: String(row.guest_name ?? "").trim(),
      source: String(row.source ?? "walkin"),
      checkin_date: String(row.checkin_date ?? ""),
      checkout_date: String(row.checkout_date ?? ""),
      total_price: Number(row.total_price ?? 0),
      reservation_status: String(row.status ?? "active"),
      guest_profile_id: row.guest_profile_id ? String(row.guest_profile_id) : null,
    }));

    const reservationIds = reservations.map((row) => row.reservation_id);

    const roomByReservation = new Map<string, string | null>();
    if (reservationIds.length > 0) {
      const { data: nightRows, error: nightError } = await supabase
        .from("reservation_nights")
        .select("reservation_id, room_id, rooms(room_number)")
        .in("reservation_id", reservationIds)
        .eq("stay_date", businessDate)
        .is("cancelled_at", null);

      if (nightError) {
        throw new MobileCheckinError(nightError.message, 500, "NIGHTS_QUERY_FAILED");
      }

      for (const row of nightRows ?? []) {
        const reservationId = String((row as any).reservation_id ?? "");
        if (!reservationId) continue;
        const roomRef = Array.isArray((row as any).rooms) ? (row as any).rooms[0] : (row as any).rooms;
        const roomNumber = roomRef?.room_number ? String(roomRef.room_number) : null;
        roomByReservation.set(reservationId, roomNumber);
      }
    }

    const scanByReservation = new Set<string>();
    if (reservationIds.length > 0) {
      const { data: scanRows, error: scanError } = await supabase
        .from("passport_scans")
        .select("reservation_id")
        .in("reservation_id", reservationIds);

      if (scanError) {
        throw new MobileCheckinError(scanError.message, 500, "SCAN_QUERY_FAILED");
      }

      for (const row of scanRows ?? []) {
        const id = String((row as any).reservation_id ?? "").trim();
        if (id) scanByReservation.add(id);
      }
    }

    const profileIds = Array.from(
      new Set(
        reservations
          .map((row) => row.guest_profile_id)
          .filter((value): value is string => Boolean(value))
      )
    );

    const completenessByProfileId = new Map<string, { is_complete: boolean; missing_fields: string[] }>();
    if (profileIds.length > 0) {
      const { data: profileRows, error: profileError } = await supabase
        .from("guest_profiles")
        .select("id, first_name, last_name, gender, nationality_code, id_type, id_number, country, province, phone")
        .in("id", profileIds);

      if (profileError) {
        throw new MobileCheckinError(profileError.message, 500, "PROFILE_QUERY_FAILED");
      }

      for (const profile of profileRows ?? []) {
        const profileId = String((profile as any).id ?? "");
        if (!profileId) continue;
        const completeness = checkProfileCompleteness(profile as Record<string, unknown>);
        completenessByProfileId.set(profileId, {
          is_complete: completeness.is_complete,
          missing_fields: completeness.missing_fields,
        });
      }
    }

    const rooms = reservations
      .map((row) => {
        const completeness = row.guest_profile_id
          ? completenessByProfileId.get(row.guest_profile_id) ?? { is_complete: false, missing_fields: [] }
          : { is_complete: false, missing_fields: ["guest_profile_id"] };
        const reservationStatus = row.reservation_status;
        const uiStatus = reservationStatus === "active" ? "confirmed" : reservationStatus;

        return {
          reservation_id: row.reservation_id,
          room_number: roomByReservation.get(row.reservation_id) ?? null,
          guest_name: row.guest_name,
          source: row.source,
          checkin_date: row.checkin_date,
          checkout_date: row.checkout_date,
          nights: daysBetween(row.checkin_date, row.checkout_date),
          total_price: row.total_price,
          status: uiStatus,
          reservation_status: reservationStatus,
          has_passport_scan: scanByReservation.has(row.reservation_id),
          profile_complete: completeness.is_complete,
          missing_fields: completeness.missing_fields,
        };
      })
      .sort((a, b) =>
        toSortableRoom(a.room_number).localeCompare(toSortableRoom(b.room_number), undefined, {
          numeric: true,
          sensitivity: "base",
        })
      );

    const { data: draftRows, error: draftError } = await supabase
      .from("reservations")
      .select("id, guest_name, source, checkin_date, checkout_date, total_price, status")
      .eq("status", "draft_checkin")
      .is("checked_in_at", null)
      .order("checkin_date", { ascending: false })
      .order("updated_at", { ascending: false });

    if (draftError) {
      throw new MobileCheckinError(draftError.message, 500, "DRAFT_QUERY_FAILED");
    }

    const draftReservationIds = (draftRows ?? []).map((row: any) => String(row.id ?? "")).filter(Boolean);
    const draftRoomByReservation = new Map<string, string | null>();
    if (draftReservationIds.length > 0) {
      const { data: draftNightRows, error: draftNightError } = await supabase
        .from("reservation_nights")
        .select("reservation_id, stay_date, rooms(room_number)")
        .in("reservation_id", draftReservationIds)
        .is("cancelled_at", null)
        .order("stay_date", { ascending: true });

      if (draftNightError) {
        throw new MobileCheckinError(draftNightError.message, 500, "DRAFT_NIGHTS_QUERY_FAILED");
      }

      for (const row of draftNightRows ?? []) {
        const reservationId = String((row as any).reservation_id ?? "");
        if (!reservationId || draftRoomByReservation.has(reservationId)) continue;
        const roomRef = Array.isArray((row as any).rooms) ? (row as any).rooms[0] : (row as any).rooms;
        const roomNumber = roomRef?.room_number ? String(roomRef.room_number) : null;
        draftRoomByReservation.set(reservationId, roomNumber);
      }
    }

    const drafts_all = (draftRows ?? []).map((row: any) => ({
      reservation_id: String(row.id),
      room_number: draftRoomByReservation.get(String(row.id)) ?? null,
      guest_name: String(row.guest_name ?? "").trim(),
      source: String(row.source ?? "walkin"),
      checkin_date: String(row.checkin_date ?? ""),
      checkout_date: String(row.checkout_date ?? ""),
      total_price: Number(row.total_price ?? 0),
      status: "draft_checkin",
      reservation_status: "draft_checkin",
    }));

    return NextResponse.json({
      success: true,
      data: {
        business_date: businessDate,
        server_date: toBangkokDate(),
        rooms,
        drafts_all,
      },
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
