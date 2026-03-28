import { addDays } from "@/lib/dates";
import { isOtaSource } from "@/lib/google-sheet-sync";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

export const dynamic = "force-dynamic";
export const fetchCache = "force-no-store";

const querySchema = z.object({
  room_number: z.string().trim().min(1),
  month: z
    .string()
    .trim()
    .regex(/^\d{4}-(0[1-9]|1[0-2])$/, "month must be in YYYY-MM format."),
});

type RoomMonthNightRow = {
  stay_date: string | null;
  nightly_price: number | string | null;
  reservations?:
    | {
        guest_name?: string | null;
        source?: string | null;
        total_price?: number | string | null;
        checkin_date?: string | null;
        checkout_date?: string | null;
        status?: string | null;
      }
    | Array<{
        guest_name?: string | null;
        source?: string | null;
        total_price?: number | string | null;
        checkin_date?: string | null;
        checkout_date?: string | null;
        status?: string | null;
      }>
    | null;
};

function toNumber(value: unknown): number {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) ? parsed : 0;
}

function round2(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

function getOne<T>(value: T | T[] | null | undefined): T | null {
  if (Array.isArray(value)) return value[0] ?? null;
  return (value ?? null) as T | null;
}

function buildMonthRange(month: string): { startDate: string; endExclusive: string } {
  const [yearText, monthText] = month.split("-");
  const year = Number(yearText);
  const monthNumber = Number(monthText);
  const startDate = `${yearText}-${monthText}-01`;
  const nextMonthDate = new Date(Date.UTC(year, monthNumber, 1));
  const endExclusive = nextMonthDate.toISOString().slice(0, 10);
  return { startDate, endExclusive };
}

function buildMonthDays(startDate: string, endExclusive: string): string[] {
  const days: string[] = [];
  let cursor = startDate;
  while (cursor < endExclusive) {
    days.push(cursor);
    cursor = addDays(cursor, 1);
  }
  return days;
}

function deriveFallbackNightlyPrice(reservation: {
  total_price?: number | string | null;
  checkin_date?: string | null;
  checkout_date?: string | null;
}): number {
  const totalPrice = round2(toNumber(reservation.total_price));
  const checkinDate = String(reservation.checkin_date ?? "");
  const checkoutDate = String(reservation.checkout_date ?? "");
  if (!totalPrice || !checkinDate || !checkoutDate) return 0;
  if (checkoutDate <= checkinDate) return 0;
  try {
    const nights = buildMonthDays(checkinDate, checkoutDate);
    if (nights.length <= 0) return 0;
    return round2(totalPrice / nights.length);
  } catch {
    return 0;
  }
}

export async function GET(request: NextRequest) {
  const expectedSyncKey = String(process.env.GOOGLE_SYNC_API_KEY ?? "").trim();
  if (!expectedSyncKey) {
    return NextResponse.json(
      { success: false, error: "Sync key is not configured on PMS." },
      { status: 503 }
    );
  }

  const incomingSyncKey = String(request.headers.get("x-sync-key") ?? "").trim();
  if (!incomingSyncKey || incomingSyncKey !== expectedSyncKey) {
    return NextResponse.json({ success: false, error: "Unauthorized." }, { status: 401 });
  }

  const parsed = querySchema.safeParse({
    room_number: request.nextUrl.searchParams.get("room_number") ?? "",
    month: request.nextUrl.searchParams.get("month") ?? "",
  });
  if (!parsed.success) {
    return NextResponse.json(
      { success: false, error: "Invalid query.", details: parsed.error.flatten() },
      { status: 400 }
    );
  }

  const roomNumber = parsed.data.room_number;
  const { startDate, endExclusive } = buildMonthRange(parsed.data.month);
  const monthDates = buildMonthDays(startDate, endExclusive);

  const supabase = createServerSupabaseClient();
  const { data: room, error: roomError } = await supabase
    .from("rooms")
    .select("id, room_number")
    .eq("room_number", roomNumber)
    .maybeSingle();
  if (roomError) {
    return NextResponse.json({ success: false, error: roomError.message }, { status: 500 });
  }
  if (!room?.id) {
    return NextResponse.json({ success: false, error: "Room not found." }, { status: 404 });
  }

  const { data: nightlyRows, error: nightlyRowsError } = await supabase
    .from("reservation_nights")
    .select(
      "stay_date, nightly_price, reservations!reservation_nights_reservation_id_fkey(guest_name, source, total_price, checkin_date, checkout_date, status)"
    )
    .eq("room_id", room.id)
    .eq("dayuse_session", 0)
    .is("cancelled_at", null)
    .gte("stay_date", startDate)
    .lt("stay_date", endExclusive)
    .order("stay_date", { ascending: true });

  if (nightlyRowsError) {
    return NextResponse.json({ success: false, error: nightlyRowsError.message }, { status: 500 });
  }

  const byDate = new Map<
    string,
    {
      guest_name: string | null;
      price: number;
      is_ota: boolean;
    }
  >();

  for (const rawRow of (nightlyRows ?? []) as RoomMonthNightRow[]) {
    const stayDate = String(rawRow?.stay_date ?? "").trim();
    const reservation = getOne(rawRow.reservations);
    if (!stayDate || !reservation) continue;

    const status = String(reservation.status ?? "").trim().toLowerCase();
    if (status === "cancelled" || status === "no_show") continue;

    const guestName = String(reservation.guest_name ?? "").trim() || null;
    const nightlyPrice = round2(toNumber(rawRow.nightly_price));
    const fallbackNightlyPrice = deriveFallbackNightlyPrice(reservation);

    byDate.set(stayDate, {
      guest_name: guestName,
      price: nightlyPrice > 0 ? nightlyPrice : fallbackNightlyPrice,
      is_ota: isOtaSource(reservation.source),
    });
  }

  return NextResponse.json({
    success: true,
    data: {
      room_number: String(room.room_number),
      nights: monthDates.map((date) => {
        const entry = byDate.get(date);
        return {
          date,
          guest_name: entry?.guest_name ?? null,
          price: entry?.price ?? 0,
          is_ota: entry?.is_ota ?? false,
        };
      }),
    },
  });
}
