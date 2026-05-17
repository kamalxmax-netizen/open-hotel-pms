import { createServerSupabaseClient } from "@/lib/supabase/server";
import { resolveBusinessDate } from "@/lib/folio-fees";
import {
  summarizeDailyRevenue,
  type RevenueExtraRow,
  type RevenueNightRow,
  type RevenuePosOrderRow,
  type RevenueRoomRow,
} from "@/lib/revenue-reporting";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

export const dynamic = "force-dynamic";
export const fetchCache = "force-no-store";

const dateRegex = /^\d{4}-\d{2}-\d{2}$/;
const querySchema = z.object({
  date: z.string().regex(dateRegex, "date must be YYYY-MM-DD").optional(),
});

type ReservationMetaRow = {
  id?: string | null;
  guest_name?: string | null;
  booking_code?: string | null;
};

type ReservationNightRoomRow = {
  reservation_id?: string | null;
  room_id?: string | null;
  stay_date?: string | null;
  rooms?: { room_number?: string | null } | Array<{ room_number?: string | null }> | null;
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

function roomNumberFromNight(row: ReservationNightRoomRow | null | undefined): string | null {
  const roomRef = Array.isArray(row?.rooms) ? row?.rooms[0] : row?.rooms;
  return roomRef?.room_number ? String(roomRef.room_number) : null;
}

function buildRoomNumberByReservation(
  rows: ReservationNightRoomRow[],
  businessDate: string
): Map<string, string | null> {
  const grouped = new Map<string, ReservationNightRoomRow[]>();
  for (const row of rows) {
    const reservationId = String(row.reservation_id ?? "").trim();
    if (!reservationId) continue;
    const current = grouped.get(reservationId) ?? [];
    current.push(row);
    grouped.set(reservationId, current);
  }

  const byReservation = new Map<string, string | null>();
  for (const [reservationId, reservationRows] of grouped.entries()) {
    const sorted = [...reservationRows].sort((a, b) =>
      String(a.stay_date ?? "").localeCompare(String(b.stay_date ?? ""))
    );
    const preferred =
      [...sorted].reverse().find((row) => String(row.stay_date ?? "") <= businessDate && row.room_id) ??
      sorted.find((row) => Boolean(row.room_id)) ??
      null;
    byReservation.set(reservationId, roomNumberFromNight(preferred));
  }
  return byReservation;
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

    const supabase = createServerSupabaseClient();
    const fallbackDate = toBangkokDateString();
    const resolvedBusinessDate = await resolveBusinessDate(supabase, fallbackDate);
    const businessDate = parsed.data.date ?? resolvedBusinessDate;

    const [roomsRes, nightsRes, posRes, extraRes] = await Promise.all([
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
        .select("total, status")
        .eq("order_date", businessDate)
        .eq("status", "completed"),
      supabase
        .from("folio_payments")
        .select("id, reservation_id, paid_date, paid_at, tx_type, amount, note, revenue_category, is_record_only, is_correction, is_void_reversal, void_of")
        .eq("paid_date", businessDate)
        .eq("revenue_category", "extra_charge")
        .in("tx_type", ["payment", "refund"]),
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
    if (extraRes.error) {
      return NextResponse.json({ success: false, error: extraRes.error.message }, { status: 500 });
    }

    const rawExtraRows = (extraRes.data ?? []) as RevenueExtraRow[];
    const extraReservationIds = Array.from(
      new Set(rawExtraRows.map((row) => String(row.reservation_id ?? "").trim()).filter(Boolean))
    );
    const reservationMetaById = new Map<string, ReservationMetaRow>();
    let roomNumberByReservation = new Map<string, string | null>();

    if (extraReservationIds.length > 0) {
      const [reservationMetaRes, reservationRoomsRes] = await Promise.all([
        supabase
          .from("reservations")
          .select("id, guest_name, booking_code")
          .in("id", extraReservationIds),
        supabase
          .from("reservation_nights")
          .select("reservation_id, room_id, stay_date, rooms(room_number)")
          .in("reservation_id", extraReservationIds)
          .is("cancelled_at", null)
          .order("stay_date", { ascending: true }),
      ]);

      if (reservationMetaRes.error) {
        return NextResponse.json({ success: false, error: reservationMetaRes.error.message }, { status: 500 });
      }
      if (reservationRoomsRes.error) {
        return NextResponse.json({ success: false, error: reservationRoomsRes.error.message }, { status: 500 });
      }

      for (const row of (reservationMetaRes.data ?? []) as ReservationMetaRow[]) {
        const reservationId = String(row.id ?? "").trim();
        if (reservationId) reservationMetaById.set(reservationId, row);
      }
      roomNumberByReservation = buildRoomNumberByReservation(
        (reservationRoomsRes.data ?? []) as ReservationNightRoomRow[],
        businessDate
      );
    }

    const extraRows = rawExtraRows.map((row) => {
      const reservationId = String(row.reservation_id ?? "").trim();
      const reservation = reservationMetaById.get(reservationId);
      return {
        ...row,
        room_number: roomNumberByReservation.get(reservationId) ?? null,
        booking_code: reservation?.booking_code ?? null,
        guest_name: reservation?.guest_name ?? null,
      };
    });
    const extraIds = extraRows.map((row) => String(row.id ?? "").trim()).filter(Boolean);
    const laterVoidedExtraOriginalIds = new Set<string>();
    if (extraIds.length > 0) {
      const { data: laterVoidRows, error: laterVoidError } = await supabase
        .from("folio_payments")
        .select("void_of")
        .eq("is_void_reversal", true)
        .in("void_of", extraIds);
      if (laterVoidError) {
        return NextResponse.json({ success: false, error: laterVoidError.message }, { status: 500 });
      }
      for (const row of laterVoidRows ?? []) {
        const originalId = String((row as { void_of?: string | null }).void_of ?? "").trim();
        if (originalId) laterVoidedExtraOriginalIds.add(originalId);
      }
    }

    const summary = summarizeDailyRevenue({
      rooms: (roomsRes.data ?? []) as RevenueRoomRow[],
      nights: (nightsRes.data ?? []) as RevenueNightRow[],
      extraRows,
      laterVoidedExtraOriginalIds,
      posOrders: (posRes.data ?? []) as RevenuePosOrderRow[],
      businessDate,
    });

    return NextResponse.json({
      success: true,
      business_date: businessDate,
      sellable_rooms: summary.sellableRooms,
      rooms: summary.rooms,
      dayuse: summary.dayuse,
      extra_charges: summary.extraCharges,
      pos_total: summary.posRevenue,
      summary: {
        total_revenue: summary.totalRevenueExcludingPos,
        room_revenue: summary.roomRevenue,
        dayuse_revenue: summary.dayuseRevenue,
        extra_revenue: summary.extraRevenue,
        pos_revenue: summary.posRevenue,
        occupied_rooms: summary.occupiedRooms,
        occupancy_pct: summary.occupancyPct,
        adr: summary.adr,
        revpar: summary.revpar,
      },
    });
  } catch (err) {
    console.error("api/reports/revenue-daily GET failed", err);
    const message = err instanceof Error ? err.message : "Internal server error";
    return NextResponse.json({ success: false, error: message }, { status: 500 });
  }
}
