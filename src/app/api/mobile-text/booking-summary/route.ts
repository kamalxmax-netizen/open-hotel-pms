import { formatBookingSummaryText, resolveRoomTypeThaiLabel } from "@/lib/mobile-text";
import { MobileCheckinError, requireMobileCheckinAuth } from "@/lib/mobile-checkin";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { NextRequest, NextResponse } from "next/server";

export const dynamic = "force-dynamic";
export const fetchCache = "force-no-store";

function toNumber(value: unknown): number {
  const num = typeof value === "number" ? value : Number(value);
  return Number.isFinite(num) ? num : 0;
}

function buildDailyPrices(prices: number[], totalPrice: number, nights: number): number[] {
  const normalized = prices.map((price) => toNumber(price)).filter((price) => price > 0);
  if (normalized.length > 0) return normalized;
  if (nights <= 0) return [];
  const fallback = toNumber(totalPrice) / nights;
  return Array.from({ length: nights }, () => Number(fallback.toFixed(2)));
}

export async function POST(request: NextRequest) {
  try {
    const supabase = createServerSupabaseClient();
    await requireMobileCheckinAuth(supabase, request);

    const body = await request.json().catch(() => null);
    const reservationId = String(body?.reservation_id ?? "").trim();
    if (!reservationId) {
      throw new MobileCheckinError("reservation_id is required.", 400, "MISSING_RESERVATION_ID");
    }

    const { data: baseReservation, error: baseError } = await supabase
      .from("reservations")
      .select("id, booking_group_id, guest_name, status, checked_in_at")
      .eq("id", reservationId)
      .maybeSingle();

    if (baseError) {
      throw new MobileCheckinError(baseError.message, 500, "BASE_RESERVATION_QUERY_FAILED");
    }
    if (!baseReservation) {
      throw new MobileCheckinError("Reservation not found.", 404, "RESERVATION_NOT_FOUND");
    }

    let reservationQuery = supabase
      .from("reservations")
      .select(`
        id,
        booking_code,
        booking_group_id,
        guest_name,
        checkin_date,
        checkout_date,
        total_price,
        status,
        checked_in_at,
        reservation_nights(
          stay_date,
          nightly_price,
          cancelled_at,
          room_id,
          room_type_id,
          rooms(
            room_number,
            room_types(name_en)
          )
        )
      `)
      .eq("status", "active")
      .is("checked_in_at", null);

    if (baseReservation.booking_group_id) {
      reservationQuery = reservationQuery.eq("booking_group_id", String(baseReservation.booking_group_id));
    } else {
      reservationQuery = reservationQuery.eq("id", reservationId);
    }

    const { data: reservationRows, error: reservationError } = await reservationQuery;
    if (reservationError) {
      throw new MobileCheckinError(reservationError.message, 500, "RESERVATION_QUERY_FAILED");
    }

    const summaries = (reservationRows ?? [])
      .map((row: any) => {
        const activeNights = (Array.isArray(row.reservation_nights) ? row.reservation_nights : [])
          .filter((night: any) => !night?.cancelled_at)
          .sort((left: any, right: any) => String(left?.stay_date ?? "").localeCompare(String(right?.stay_date ?? "")));

        const firstNight = activeNights[0] ?? null;
        const roomRef = firstNight?.rooms
          ? (Array.isArray(firstNight.rooms) ? firstNight.rooms[0] : firstNight.rooms)
          : null;
        const roomTypeRef = roomRef?.room_types
          ? (Array.isArray(roomRef.room_types) ? roomRef.room_types[0] : roomRef.room_types)
          : null;

        const checkinDate = String(row.checkin_date ?? "");
        const checkoutDate = String(row.checkout_date ?? "");
        const nights = activeNights.length > 0
          ? activeNights.length
          : Math.max(
              1,
              Math.round(
                (new Date(`${checkoutDate}T00:00:00`).getTime() - new Date(`${checkinDate}T00:00:00`).getTime()) / 86400000
              )
            );

        const dailyPrices = buildDailyPrices(
          activeNights.map((night: any) => toNumber(night?.nightly_price)),
          toNumber(row.total_price),
          nights
        );

        return {
          reservation_id: String(row.id),
          booking_code: String(row.booking_code ?? ""),
          room_number: roomRef?.room_number ? String(roomRef.room_number) : "",
          name: String(row.guest_name ?? "").trim() || String(baseReservation.guest_name ?? "").trim(),
          roomTypeThai: resolveRoomTypeThaiLabel(roomTypeRef?.name_en ?? null, null),
          checkinDate,
          checkoutDate,
          nights,
          price: toNumber(row.total_price) || dailyPrices.reduce((sum, price) => sum + price, 0),
          dailyPrices,
        };
      })
      .sort((left, right) => {
        const roomA = Number.parseInt(left.room_number, 10);
        const roomB = Number.parseInt(right.room_number, 10);
        if (Number.isFinite(roomA) && Number.isFinite(roomB) && roomA !== roomB) return roomA - roomB;
        return left.booking_code.localeCompare(right.booking_code, undefined, { sensitivity: "base" });
      });

    if (summaries.length === 0) {
      throw new MobileCheckinError("No active reservation data found for summary.", 404, "SUMMARY_NOT_FOUND");
    }

    return NextResponse.json({
      success: true,
      data: {
        reservation_ids: summaries.map((item) => item.reservation_id),
        text: formatBookingSummaryText(
          summaries.map((item) => ({
            name: item.name,
            roomTypeThai: item.roomTypeThai,
            checkinDate: item.checkinDate,
            checkoutDate: item.checkoutDate,
            nights: item.nights,
            price: item.price,
            dailyPrices: item.dailyPrices,
          }))
        ),
      },
    });
  } catch (error) {
    if (error instanceof MobileCheckinError) {
      return NextResponse.json({ success: false, error: error.message, code: error.code }, { status: error.status });
    }
    return NextResponse.json({ success: false, error: String(error) }, { status: 500 });
  }
}
