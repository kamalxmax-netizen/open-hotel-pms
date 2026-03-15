import { createServerSupabaseClient } from "@/lib/supabase/server";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

export const dynamic = "force-dynamic";
export const fetchCache = "force-no-store";

const querySchema = z.object({
  q: z.string().trim().max(120).optional(),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  limit: z
    .string()
    .optional()
    .transform((v) => (v ? Number(v) : 50))
    .refine((v) => Number.isInteger(v) && v > 0 && v <= 200, "limit must be 1-200"),
});

function thailandDateString(): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Bangkok",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date());
  const y = parts.find((p) => p.type === "year")?.value;
  const m = parts.find((p) => p.type === "month")?.value;
  const d = parts.find((p) => p.type === "day")?.value;
  return `${y}-${m}-${d}`;
}

export async function GET(request: NextRequest) {
  try {
    const parsed = querySchema.safeParse({
      q: request.nextUrl.searchParams.get("q") ?? undefined,
      date: request.nextUrl.searchParams.get("date") ?? undefined,
      limit: request.nextUrl.searchParams.get("limit") ?? undefined,
    });

    if (!parsed.success) {
      return NextResponse.json(
        { success: false, error: "Invalid query.", details: parsed.error.flatten() },
        { status: 400 }
      );
    }

    const targetDate = parsed.data.date ?? thailandDateString();
    const query = parsed.data.q?.trim() ?? "";
    const limit = parsed.data.limit;

    const supabase = createServerSupabaseClient();

    let reservationsQuery = supabase
      .from("reservations")
      .select("id, booking_code, guest_name, phone, checkin_date, checkout_date, status, deposit_amount")
      .eq("status", "active")
      .lte("checkin_date", targetDate)
      .gt("checkout_date", targetDate)
      .order("guest_name", { ascending: true })
      .limit(limit * 2);

    if (query.length > 0) {
      reservationsQuery = reservationsQuery.or(
        `guest_name.ilike.%${query}%,booking_code.ilike.%${query}%,phone.ilike.%${query}%`
      );
    }

    const { data: reservations, error: reservationError } = await reservationsQuery;
    if (reservationError) {
      return NextResponse.json({ success: false, error: reservationError.message }, { status: 500 });
    }

    const reservationIds = Array.from(
      new Set((reservations ?? []).map((row) => row.id).filter((id): id is string => Boolean(id)))
    );

    if (reservationIds.length === 0) {
      return NextResponse.json({ success: true, reservations: [] });
    }

    const { data: nights, error: nightsError } = await supabase
      .from("reservation_nights")
      .select("reservation_id, room_id, rooms(room_number)")
      .eq("stay_date", targetDate)
      .is("cancelled_at", null)
      .in("reservation_id", reservationIds);

    if (nightsError) {
      return NextResponse.json({ success: false, error: nightsError.message }, { status: 500 });
    }

    const roomNumbersByReservation = new Map<string, string[]>();
    for (const night of nights ?? []) {
      const reservationId = String(night.reservation_id);
      const roomNumber = (night.rooms as any)?.room_number as string | undefined;
      if (!roomNumber) continue;
      if (!roomNumbersByReservation.has(reservationId)) roomNumbersByReservation.set(reservationId, []);
      roomNumbersByReservation.get(reservationId)?.push(roomNumber);
    }

    const rows = (reservations ?? [])
      .filter((row) => (roomNumbersByReservation.get(row.id)?.length ?? 0) > 0)
      .map((row) => {
        const roomNumbers = Array.from(new Set(roomNumbersByReservation.get(row.id) ?? [])).sort();
        return {
          id: row.id,
          booking_code: row.booking_code,
          guest_name: row.guest_name,
          phone: row.phone,
          checkin_date: row.checkin_date,
          checkout_date: row.checkout_date,
          check_in: row.checkin_date,
          check_out: row.checkout_date,
          status: row.status,
          checked_in_at: null,
          deposit_amount: Number(row.deposit_amount ?? 0),
          room_number: roomNumbers[0] ?? "",
          room_numbers: roomNumbers,
          room_label: roomNumbers.join(", "),
        };
      })
      .filter((row) => {
        if (!query.length) return true;
        const q = query.toLowerCase();
        return (
          row.guest_name?.toLowerCase().includes(q) ||
          row.booking_code?.toLowerCase().includes(q) ||
          row.phone?.toLowerCase().includes(q) ||
          row.room_label.toLowerCase().includes(q)
        );
      })
      .slice(0, limit);

    return NextResponse.json({ success: true, reservations: rows });
  } catch (err) {
    console.error("pos/reservations GET failed", err);
    const message = err instanceof Error ? err.message : "Internal server error";
    return NextResponse.json({ success: false, error: message }, { status: 500 });
  }
}
