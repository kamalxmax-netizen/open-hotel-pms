import { createServerSupabaseClient } from "@/lib/supabase/server";
import { NextResponse } from "next/server";
import type { DayUseRoomStatus, DayUseTimerState } from "@/lib/types";
import { isValidDateString } from "@/lib/dates";

export const dynamic = "force-dynamic";
export const fetchCache = "force-no-store";

const blockedHousekeepingStatuses = new Set(["dirty", "in_progress", "paused"]);
const DAYUSE_FALLBACK_ROOM_NUMBERS = ["118", "120", "122"];

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

function computeTimerState(expiresAt: string | null): DayUseTimerState | null {
  if (!expiresAt) return null;
  const expiresMs = new Date(expiresAt).getTime();
  if (Number.isNaN(expiresMs)) return null;
  const remainingMin = (expiresMs - Date.now()) / 60000;
  if (remainingMin > 30) return "green";
  if (remainingMin > 10) return "yellow";
  if (remainingMin > 0) return "red";
  return "overdue";
}

export async function GET(request: Request) {
  try {
    const supabase = createServerSupabaseClient();
    const url = new URL(request.url);
    const requestedDate = url.searchParams.get("date");
    if (requestedDate && !isValidDateString(requestedDate)) {
      return NextResponse.json({ success: false, error: "Invalid date format. Use YYYY-MM-DD." }, { status: 400 });
    }

    const { data: settings, error: settingsError } = await supabase
      .from("hotel_settings")
      .select("business_date, dayuse_rate, dayuse_duration_min, dayuse_extend_rate, dayuse_extend_min")
      .eq("id", 1)
      .maybeSingle();

    if (settingsError || !settings?.business_date) {
      return NextResponse.json({ success: false, error: "Hotel settings not found." }, { status: 500 });
    }

    const businessDate = String(settings.business_date);
    const targetDate = requestedDate || businessDate;
    const isHistoricalDate = targetDate !== businessDate;
    const settingsResponse = {
      dayuse_rate: round2(Number(settings.dayuse_rate ?? 200)),
      dayuse_duration_min: Number(settings.dayuse_duration_min ?? 120),
      dayuse_extend_rate: round2(Number(settings.dayuse_extend_rate ?? 100)),
      dayuse_extend_min: Number(settings.dayuse_extend_min ?? 60),
    };

    const { data: dayUseRooms, error: roomsError } = await supabase
      .from("rooms")
      .select("id, room_number")
      .eq("is_dayuse", true)
      .order("sort_order", { ascending: true, nullsFirst: false })
      .order("room_number", { ascending: true });

    if (roomsError) {
      return NextResponse.json({ success: false, error: roomsError.message }, { status: 500 });
    }

    let rooms = dayUseRooms ?? [];

    // Hotfix resilience: if day-use flags were not seeded in this environment,
    // auto-detect canonical room numbers and heal the flag in-place.
    if (rooms.length === 0) {
      const { data: allRooms, error: fallbackError } = await supabase
        .from("rooms")
        .select("id, room_number")
        .order("sort_order", { ascending: true, nullsFirst: false })
        .order("room_number", { ascending: true });

      if (fallbackError) {
        return NextResponse.json({ success: false, error: fallbackError.message }, { status: 500 });
      }

      const wanted = new Set(DAYUSE_FALLBACK_ROOM_NUMBERS);
      const fallbackRooms = (allRooms ?? []).filter((room: any) => {
        const raw = String(room?.room_number ?? "").trim();
        if (!raw) return false;
        const normalized = raw.replace(/^0+/, "");
        return wanted.has(raw) || wanted.has(normalized);
      });

      if ((fallbackRooms ?? []).length > 0) {
        const fallbackIds = (fallbackRooms ?? []).map((room: any) => String(room.id));
        const { error: healError } = await supabase
          .from("rooms")
          .update({ is_dayuse: true, is_visible_on_board: true })
          .in("id", fallbackIds);

        if (healError) {
          console.warn("dayuse/status auto-heal skipped", healError.message);
        }

        rooms = fallbackRooms ?? [];
      }
    }

    if (rooms.length === 0) {
      return NextResponse.json({
        success: true,
        business_date: businessDate,
        settings: settingsResponse,
        rooms: [],
      });
    }

    const roomIds = rooms.map((r) => String(r.id));

    const { data: hkRows, error: hkError } = await supabase
      .from("housekeeping_tasks")
      .select("room_id, status")
      .eq("stay_date", targetDate)
      .in("room_id", roomIds);

    if (hkError) {
      return NextResponse.json({ success: false, error: hkError.message }, { status: 500 });
    }

    const hkStatusByRoomId = new Map<string, string | null>();
    (hkRows ?? []).forEach((row: any) => {
      hkStatusByRoomId.set(String(row.room_id), row.status ? String(row.status) : null);
    });

    const { data: dayUseReservations, error: reservationsError } = await supabase
      .from("reservations")
      .select(`
        id,
        booking_code,
        guest_name,
        phone,
        status,
        checkin_date,
        checked_in_at,
        dayuse_expires_at,
        total_price,
        reservation_nights(
          room_id,
          stay_date,
          cancelled_at,
          nightly_price
        )
      `)
      .eq("is_dayuse", true)
      .eq("checkin_date", targetDate)
      .in("status", ["active", "checked_out"]);

    if (reservationsError) {
      return NextResponse.json({ success: false, error: reservationsError.message }, { status: 500 });
    }

    const activeReservationByRoomId = new Map<string, any>();
    const sessionsByRoomId = new Map<string, number>();

    (dayUseReservations ?? []).forEach((reservation: any) => {
      const nights = Array.isArray(reservation?.reservation_nights)
        ? reservation.reservation_nights.filter((n: any) => !n?.cancelled_at && String(n?.stay_date ?? "") === targetDate)
        : [];
      const roomId = nights[0]?.room_id ? String(nights[0].room_id) : null;
      if (!roomId) return;

      sessionsByRoomId.set(roomId, (sessionsByRoomId.get(roomId) ?? 0) + 1);

      const summary = {
        id: String(reservation.id),
        booking_code: String(reservation.booking_code ?? ""),
        guest_name: String(reservation.guest_name ?? ""),
        phone: reservation.phone ? String(reservation.phone) : null,
        checked_in_at: String(reservation.checked_in_at ?? ""),
        dayuse_expires_at: String(reservation.dayuse_expires_at ?? ""),
        total_price: round2(Number(reservation.total_price ?? 0)),
        rate: round2(Number(nights[0]?.nightly_price ?? reservation.total_price ?? 0)),
      };

      if (reservation.status === "active") {
        activeReservationByRoomId.set(roomId, summary);
        return;
      }

      // Historical view: if no active session, still show the latest used session of that date.
      if (isHistoricalDate && reservation.status === "checked_out" && !activeReservationByRoomId.has(roomId)) {
        const existing = activeReservationByRoomId.get(roomId);
        if (!existing || String(existing.checked_in_at ?? "") < String(summary.checked_in_at ?? "")) {
          activeReservationByRoomId.set(roomId, summary);
        }
      }
    });

    const statusRows: DayUseRoomStatus[] = rooms.map((room) => {
      const roomId = String(room.id);
      const current = activeReservationByRoomId.get(roomId) ?? null;
      const hkStatus = hkStatusByRoomId.get(roomId) ?? null;
      const isBlockedByHousekeeping = hkStatus ? blockedHousekeepingStatuses.has(hkStatus) : false;
      const timerState = current ? computeTimerState(current.dayuse_expires_at) : null;
      const isAvailable = !current && !isBlockedByHousekeeping;

      return {
        room_id: roomId,
        room_number: String(room.room_number ?? ""),
        is_available: isAvailable,
        current_reservation: current,
        hk_status: (hkStatus as any) ?? null,
        sessions_today: sessionsByRoomId.get(roomId) ?? 0,
        timer_state: timerState,
      };
    });

    return NextResponse.json({
      success: true,
      business_date: businessDate,
      target_date: targetDate,
      settings: settingsResponse,
      rooms: statusRows,
    });
  } catch (err) {
    console.error("dayuse/status GET failed", err);
    return NextResponse.json(
      { success: false, error: err instanceof Error ? err.message : "Internal server error" },
      { status: 500 }
    );
  }
}
