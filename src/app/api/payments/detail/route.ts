import { createServerSupabaseClient } from "@/lib/supabase/server";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

export const dynamic = "force-dynamic";
export const fetchCache = "force-no-store";

const dateRegex = /^\d{4}-\d{2}-\d{2}$/;

const querySchema = z.object({
  start: z.string().regex(dateRegex, "start must be YYYY-MM-DD").optional(),
  end: z.string().regex(dateRegex, "end must be YYYY-MM-DD").optional(),
  reservation_id: z.string().uuid().optional(),
});

type ReservationNightRoom = {
  stay_date: string;
  room_number: string | null;
};

const CATEGORIES = [
  "room_revenue",
  "pos_revenue",
  "extra_charge",
  "deposit",
  "no_show_fee",
  "dayuse_revenue",
] as const;
type RevenueCategory = (typeof CATEGORIES)[number];

function resolveRevenueCategory(rawCategory: unknown, txType: string, rawNote: unknown): RevenueCategory {
  const category = CATEGORIES.includes(rawCategory as RevenueCategory)
    ? (rawCategory as RevenueCategory)
    : "room_revenue";
  if (txType === "refund" && category !== "deposit") {
    const note = String(rawNote ?? "").toLowerCase();
    if (note.includes("deposit") && note.includes("refund")) {
      return "deposit";
    }
  }
  return category;
}

function toBangkokDateString(date = new Date()): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Bangkok",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);
  const year = parts.find((part) => part.type === "year")?.value;
  const month = parts.find((part) => part.type === "month")?.value;
  const day = parts.find((part) => part.type === "day")?.value;
  if (!year || !month || !day) return new Date().toISOString().slice(0, 10);
  return `${year}-${month}-${day}`;
}

function resolveRoomNumberForDate(nights: ReservationNightRoom[] | undefined, targetDate: string): string | null {
  if (!nights || nights.length === 0) return null;

  const exact = nights.find((night) => night.stay_date === targetDate && night.room_number);
  if (exact?.room_number) return exact.room_number;

  let latest: ReservationNightRoom | null = null;
  for (const night of nights) {
    if (night.stay_date <= targetDate && (!latest || night.stay_date > latest.stay_date)) {
      latest = night;
    }
  }
  return latest?.room_number ?? null;
}

export async function GET(request: NextRequest) {
  try {
    const parsed = querySchema.safeParse({
      start: request.nextUrl.searchParams.get("start") ?? undefined,
      end: request.nextUrl.searchParams.get("end") ?? undefined,
      reservation_id: request.nextUrl.searchParams.get("reservation_id") ?? undefined,
    });
    if (!parsed.success) {
      return NextResponse.json(
        { success: false, error: "Invalid query.", details: parsed.error.flatten() },
        { status: 400 }
      );
    }

    const supabase = createServerSupabaseClient();
    const today = toBangkokDateString();
    const startDate = parsed.data.start ?? today;
    const endDate = parsed.data.end ?? today;

    let query = supabase
      .from("folio_payments")
      .select("id, reservation_id, paid_date, paid_at, method, tx_type, amount, note, revenue_category, cashier_name")
      .gte("paid_date", startDate)
      .lte("paid_date", endDate)
      .order("paid_date", { ascending: true })
      .order("paid_at", { ascending: true });

    if (parsed.data.reservation_id) {
      query = query.eq("reservation_id", parsed.data.reservation_id);
    }

    const { data: rows, error } = await query;
    if (error) {
      return NextResponse.json({ success: false, error: error.message }, { status: 500 });
    }

    const paymentRows = (rows ?? []) as Array<Record<string, unknown>>;
    if (paymentRows.length === 0) {
      return NextResponse.json({
        success: true,
        start_date: startDate,
        end_date: endDate,
        reservations: [],
      });
    }

    const reservationIds = Array.from(
      new Set(paymentRows.map((row) => String(row.reservation_id ?? "")).filter(Boolean))
    );

    const reservationMap = new Map<
      string,
      { booking_code: string | null; guest_name: string | null; guest_profile_id: string | null }
    >();
    if (reservationIds.length > 0) {
      const { data: reservations, error: reservationError } = await supabase
        .from("reservations")
        .select("id, booking_code, guest_name, guest_profile_id")
        .in("id", reservationIds);
      if (reservationError) {
        return NextResponse.json({ success: false, error: reservationError.message }, { status: 500 });
      }
      for (const row of reservations ?? []) {
        reservationMap.set(String(row.id), {
          booking_code: row.booking_code ? String(row.booking_code) : null,
          guest_name: row.guest_name ? String(row.guest_name) : null,
          guest_profile_id: row.guest_profile_id ? String(row.guest_profile_id) : null,
        });
      }
    }

    const nightsByReservation = new Map<string, ReservationNightRoom[]>();
    if (reservationIds.length > 0) {
      const { data: nights, error: nightsError } = await supabase
        .from("reservation_nights")
        .select("reservation_id, stay_date, rooms:room_id(room_number)")
        .in("reservation_id", reservationIds)
        .lte("stay_date", endDate)
        .is("cancelled_at", null);
      if (nightsError) {
        return NextResponse.json({ success: false, error: nightsError.message }, { status: 500 });
      }

      for (const row of (nights ?? []) as any[]) {
        const reservationId = String(row.reservation_id ?? "");
        if (!reservationId) continue;
        const roomRef = Array.isArray(row.rooms) ? row.rooms[0] : row.rooms;
        const next: ReservationNightRoom = {
          stay_date: String(row.stay_date ?? ""),
          room_number: roomRef?.room_number ? String(roomRef.room_number) : null,
        };
        const current = nightsByReservation.get(reservationId);
        if (current) current.push(next);
        else nightsByReservation.set(reservationId, [next]);
      }
    }

    const grouped = new Map<
      string,
      {
        reservation_id: string;
        booking_code: string | null;
        guest_name: string | null;
        guest_profile_id: string | null;
        room_number: string | null;
        totals: { inflow: number; refunds: number; net: number };
        entries: Array<Record<string, unknown>>;
      }
    >();

    for (const row of paymentRows) {
      const reservationId = String(row.reservation_id ?? "");
      if (!reservationId) continue;
      const reservation = reservationMap.get(reservationId);
      const paidDate = String(row.paid_date ?? startDate);
      const roomNumber = resolveRoomNumberForDate(nightsByReservation.get(reservationId), paidDate);
      const amount = Number(row.amount ?? 0);
      const txType = String(row.tx_type ?? "payment");
      const category = resolveRevenueCategory(row.revenue_category, txType, row.note);
      const signed = txType === "refund" ? -amount : amount;

      if (!grouped.has(reservationId)) {
        grouped.set(reservationId, {
          reservation_id: reservationId,
          booking_code: reservation?.booking_code ?? null,
          guest_name: reservation?.guest_name ?? null,
          guest_profile_id: reservation?.guest_profile_id ?? null,
          room_number: roomNumber,
          totals: { inflow: 0, refunds: 0, net: 0 },
          entries: [],
        });
      }

      const target = grouped.get(reservationId);
      if (!target) continue;
      if (!target.room_number && roomNumber) target.room_number = roomNumber;
      if (txType === "refund") target.totals.refunds += amount;
      else target.totals.inflow += amount;
      target.totals.net += signed;

      target.entries.push({
        id: row.id,
        paid_date: paidDate,
        paid_at: row.paid_at,
        tx_type: txType,
        method: row.method,
        revenue_category: category,
        amount: Number(amount.toFixed(2)),
        signed_amount: Number(signed.toFixed(2)),
        cashier_name: row.cashier_name ?? null,
        note: row.note ?? null,
        room_number: roomNumber,
      });
    }

    const reservations = Array.from(grouped.values())
      .map((group) => ({
        ...group,
        totals: {
          inflow: Number(group.totals.inflow.toFixed(2)),
          refunds: Number(group.totals.refunds.toFixed(2)),
          net: Number(group.totals.net.toFixed(2)),
        },
      }))
      .sort((a, b) => {
        const roomA = a.room_number ?? "";
        const roomB = b.room_number ?? "";
        if (roomA !== roomB) return roomA.localeCompare(roomB, undefined, { numeric: true, sensitivity: "base" });
        return (a.booking_code ?? "").localeCompare(b.booking_code ?? "", undefined, { sensitivity: "base" });
      });

    return NextResponse.json({
      success: true,
      start_date: startDate,
      end_date: endDate,
      reservations,
    });
  } catch (err) {
    console.error("api/payments/detail GET failed", err);
    const message = err instanceof Error ? err.message : "Internal server error";
    return NextResponse.json({ success: false, error: message }, { status: 500 });
  }
}
