import { createServerSupabaseClient } from "@/lib/supabase/server";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

export const dynamic = "force-dynamic";
export const fetchCache = "force-no-store";

const dateRegex = /^\d{4}-\d{2}-\d{2}$/;
const querySchema = z.object({
  date: z.string().regex(dateRegex, "date must be YYYY-MM-DD").optional(),
});

type RoomBaseRow = {
  id: string;
  room_number: string;
  floor_number: number | null;
  is_dayuse: boolean | null;
  closure_reason: string | null;
  is_sellable: boolean | null;
};

type ReservationNightRow = {
  room_id: string | null;
  stay_date: string;
  nightly_price: number | null;
  reservations:
    | {
        id: string;
        guest_name: string | null;
        booking_code: string | null;
        source: string | null;
        checkin_date: string | null;
        checkout_date: string | null;
        is_dayuse: boolean | null;
        status: string | null;
      }
    | {
        id: string;
        guest_name: string | null;
        booking_code: string | null;
        source: string | null;
        checkin_date: string | null;
        checkout_date: string | null;
        is_dayuse: boolean | null;
        status: string | null;
      }[]
    | null;
};

type PosOrderRow = {
  total: number | null;
};

function toBangkokDateString(date = new Date()): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Bangkok",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);
  const y = parts.find((p) => p.type === "year")?.value;
  const m = parts.find((p) => p.type === "month")?.value;
  const d = parts.find((p) => p.type === "day")?.value;
  if (!y || !m || !d) return new Date().toISOString().slice(0, 10);
  return `${y}-${m}-${d}`;
}

function round2(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

function asReservation(
  value: ReservationNightRow["reservations"]
): {
  id: string;
  guest_name: string | null;
  booking_code: string | null;
  source: string | null;
  checkin_date: string | null;
  checkout_date: string | null;
  is_dayuse: boolean | null;
  status: string | null;
} | null {
  if (!value) return null;
  return (Array.isArray(value) ? value[0] : value) ?? null;
}

function computeNightLabel(targetDate: string, checkin: string | null, checkout: string | null): string | null {
  if (!checkin || !checkout) return null;
  const checkinDate = new Date(`${checkin}T00:00:00+07:00`);
  const checkoutDate = new Date(`${checkout}T00:00:00+07:00`);
  const target = new Date(`${targetDate}T00:00:00+07:00`);
  if (Number.isNaN(checkinDate.getTime()) || Number.isNaN(checkoutDate.getTime()) || Number.isNaN(target.getTime())) {
    return null;
  }
  const totalNights = Math.max(1, Math.round((checkoutDate.getTime() - checkinDate.getTime()) / 86400000));
  const index = Math.max(1, Math.min(totalNights, Math.round((target.getTime() - checkinDate.getTime()) / 86400000) + 1));
  return `${index}/${totalNights}`;
}

function isHiddenByReason(reason: string | null): boolean {
  const text = String(reason ?? "").toLowerCase();
  if (!text) return false;
  return /block|reno|renovat|ปรับปรุง|ซ่อม/.test(text);
}

export async function GET(request: NextRequest) {
  try {
    const parsed = querySchema.safeParse({
      date: request.nextUrl.searchParams.get("date") ?? undefined,
    });
    if (!parsed.success) {
      return NextResponse.json(
        { success: false, error: "Invalid query.", details: parsed.error.flatten() },
        { status: 400 }
      );
    }

    const businessDate = parsed.data.date ?? toBangkokDateString();
    const supabase = createServerSupabaseClient();

    const [roomsRes, nightsRes, posRes] = await Promise.all([
      supabase
        .from("rooms")
        .select("id, room_number, floor_number, is_dayuse, closure_reason, is_sellable")
        .eq("is_sellable", true)
        .order("floor_number", { ascending: true, nullsFirst: false })
        .order("room_number", { ascending: true }),
      supabase
        .from("reservation_nights")
        .select(
          "room_id, stay_date, nightly_price, reservations!inner(id, guest_name, booking_code, source, checkin_date, checkout_date, is_dayuse, status)"
        )
        .eq("stay_date", businessDate)
        .is("cancelled_at", null)
        .neq("reservations.status", "cancelled"),
      supabase
        .from("pos_orders")
        .select("total")
        .eq("order_date", businessDate)
        .eq("status", "completed"),
    ]);

    if (roomsRes.error) {
      return NextResponse.json({ success: false, error: roomsRes.error.message }, { status: 500 });
    }
    if (nightsRes.error) {
      return NextResponse.json({ success: false, error: nightsRes.error.message }, { status: 500 });
    }
    if (posRes.error) {
      return NextResponse.json({ success: false, error: posRes.error.message }, { status: 500 });
    }

    const baseRooms = ((roomsRes.data ?? []) as RoomBaseRow[]).filter(
      (room) => room.is_sellable !== false && !isHiddenByReason(room.closure_reason)
    );
    const roomById = new Map(baseRooms.map((room) => [room.id, room]));
    const regularRooms = baseRooms.filter((room) => !room.is_dayuse);

    const regularByRoomId = new Map<
      string,
      {
        nightly_price: number;
        guest_name: string | null;
        booking_code: string | null;
        source: string | null;
        night_label: string | null;
      }
    >();
    const dayuseByRoomId = new Map<string, { sessions: number; revenue: number }>();

    for (const row of (nightsRes.data ?? []) as ReservationNightRow[]) {
      const reservation = asReservation(row.reservations);
      if (!reservation || !row.room_id) continue;
      const room = roomById.get(row.room_id);
      if (!room) continue;
      const amount = Number(row.nightly_price ?? 0);
      if (reservation.is_dayuse || room.is_dayuse) {
        const current = dayuseByRoomId.get(row.room_id) ?? { sessions: 0, revenue: 0 };
        current.sessions += 1;
        current.revenue += amount;
        dayuseByRoomId.set(row.room_id, current);
      } else {
        const current = regularByRoomId.get(row.room_id) ?? {
          nightly_price: 0,
          guest_name: reservation.guest_name ?? null,
          booking_code: reservation.booking_code ?? null,
          source: reservation.source ?? null,
          night_label: computeNightLabel(businessDate, reservation.checkin_date, reservation.checkout_date),
        };
        current.nightly_price += amount;
        current.guest_name = current.guest_name ?? reservation.guest_name ?? null;
        current.booking_code = current.booking_code ?? reservation.booking_code ?? null;
        current.source = current.source ?? reservation.source ?? null;
        if (!current.night_label) {
          current.night_label = computeNightLabel(businessDate, reservation.checkin_date, reservation.checkout_date);
        }
        regularByRoomId.set(row.room_id, current);
      }
    }

    const rooms = regularRooms.map((room) => {
      const revenue = regularByRoomId.get(room.id);
      return {
        room_number: room.room_number,
        floor_number: room.floor_number ?? 0,
        is_occupied: Boolean(revenue),
        nightly_price: round2(revenue?.nightly_price ?? 0),
        guest_name: revenue?.guest_name ?? null,
        booking_code: revenue?.booking_code ?? null,
        source: revenue?.source ?? null,
        night_label: revenue?.night_label ?? null,
      };
    });

    const dayuse = Array.from(dayuseByRoomId.entries())
      .map(([roomId, data]) => {
        const room = roomById.get(roomId);
        return {
          room_number: room?.room_number ?? "DAYUSE",
          sessions: data.sessions,
          revenue: round2(data.revenue),
        };
      })
      .sort((a, b) => a.room_number.localeCompare(b.room_number, undefined, { numeric: true, sensitivity: "base" }));

    const roomRevenue = round2(rooms.reduce((sum, row) => sum + row.nightly_price, 0));
    const dayuseRevenue = round2(dayuse.reduce((sum, row) => sum + row.revenue, 0));
    const posTotal = round2(((posRes.data ?? []) as PosOrderRow[]).reduce((sum, row) => sum + Number(row.total ?? 0), 0));
    const occupiedRooms = rooms.filter((row) => row.is_occupied).length;
    const sellableRooms = rooms.length;
    const totalRevenue = round2(roomRevenue + dayuseRevenue);
    const occupancyPct = sellableRooms > 0 ? round2((occupiedRooms / sellableRooms) * 100) : 0;
    const adr = occupiedRooms > 0 ? round2(roomRevenue / occupiedRooms) : 0;

    return NextResponse.json({
      success: true,
      business_date: businessDate,
      sellable_rooms: sellableRooms,
      rooms,
      dayuse,
      pos_total: posTotal,
      summary: {
        total_revenue: totalRevenue,
        room_revenue: roomRevenue,
        dayuse_revenue: dayuseRevenue,
        pos_revenue: posTotal,
        occupied_rooms: occupiedRooms,
        occupancy_pct: occupancyPct,
        adr,
      },
    });
  } catch (err) {
    console.error("api/reports/revenue-daily GET failed", err);
    const message = err instanceof Error ? err.message : "Internal server error";
    return NextResponse.json({ success: false, error: message }, { status: 500 });
  }
}

