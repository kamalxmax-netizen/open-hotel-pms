import { createServerSupabaseClient } from "@/lib/supabase/server";
import { NextResponse } from "next/server";
import { unstable_noStore as noStore } from "next/cache";

type RouteParams = { params: { id: string } };

type RoomTypeRow = {
  name_en?: string | null;
};

type RoomRow = {
  room_number?: string | null;
  floor_number?: number | null;
  room_types?: RoomTypeRow | null;
};

type ReservationNightRow = {
  stay_date?: string | null;
  nightly_price?: number | string | null;
  cancelled_at?: string | null;
  rooms?: RoomRow | RoomRow[] | null;
};

type ReservationRow = {
  id: string;
  booking_code: string;
  guest_name: string;
  phone?: string | null;
  source: string;
  checkin_date: string;
  checkout_date: string;
  checkin_time?: string | null;
  checked_in_at?: string | null;
  note?: string | null;
  specials?: string | null;
  total_price: number | string;
  deposit_amount: number | string;
  guest_profile_id?: string | null;
  reservation_nights?: ReservationNightRow[] | null;
};

function toNumber(value: unknown): number {
  const num = typeof value === "number" ? value : Number(value);
  return Number.isFinite(num) ? num : 0;
}

function diffNights(checkinDate: string, checkoutDate: string): number {
  const checkinMs = new Date(`${checkinDate}T00:00:00`).getTime();
  const checkoutMs = new Date(`${checkoutDate}T00:00:00`).getTime();
  return Math.max(1, Math.round((checkoutMs - checkinMs) / 86400000));
}

export async function GET(_request: Request, { params }: RouteParams) {
  noStore();
  try {
    const reservationId = params.id;
    if (!reservationId) {
      return NextResponse.json({ error: "Missing reservation id." }, { status: 400 });
    }

    const supabase = createServerSupabaseClient();

    const reservationSelectBase = `
      id,
      booking_code,
      guest_name,
      phone,
      source,
      checkin_date,
      checkout_date,
      checkin_time,
      note,
      specials,
      total_price,
      deposit_amount,
      guest_profile_id,
      reservation_nights(
        stay_date,
        nightly_price,
        cancelled_at,
        rooms(room_number, floor_number, room_types(name_en))
      )
    `;

    let reservation: ReservationRow | null = null;

    const withCheckedIn = await supabase
      .from("reservations")
      .select(`${reservationSelectBase}, checked_in_at`)
      .eq("id", reservationId)
      .maybeSingle();

    if (withCheckedIn.error && /checked_in_at/i.test(withCheckedIn.error.message)) {
      const fallback = await supabase
        .from("reservations")
        .select(reservationSelectBase)
        .eq("id", reservationId)
        .maybeSingle();

      if (fallback.error) {
        return NextResponse.json({ error: fallback.error.message }, { status: 500 });
      }
      reservation = (fallback.data as ReservationRow | null) ?? null;
    } else {
      if (withCheckedIn.error) {
        return NextResponse.json({ error: withCheckedIn.error.message }, { status: 500 });
      }
      reservation = (withCheckedIn.data as ReservationRow | null) ?? null;
    }

    if (!reservation) {
      return NextResponse.json({ error: "Reservation not found." }, { status: 404 });
    }

    const { data: settings } = await supabase
      .from("hotel_settings")
      .select("*")
      .eq("id", 1)
      .maybeSingle();

    type GuestProfileRow = {
      id_card_number?: string | null;
      passport_no?: string | null;
      nationality?: string | null;
    };
    let guestProfile: GuestProfileRow | null = null;

    if (reservation.guest_profile_id) {
      const withIdCard = await supabase
        .from("guest_profiles")
        .select("id_card_number, passport_no, nationality")
        .eq("id", reservation.guest_profile_id)
        .maybeSingle();

      if (withIdCard.error && /id_card_number/i.test(withIdCard.error.message)) {
        const fallback = await supabase
          .from("guest_profiles")
          .select("passport_no, nationality")
          .eq("id", reservation.guest_profile_id)
          .maybeSingle();
        guestProfile = (fallback.data as GuestProfileRow | null) ?? null;
      } else {
        guestProfile = (withIdCard.data as GuestProfileRow | null) ?? null;
      }
    }

    const reservationNights = Array.isArray(reservation.reservation_nights) ? reservation.reservation_nights : [];
    const activeNights = reservationNights.filter((night: ReservationNightRow) => !night.cancelled_at);

    const firstNight = activeNights[0];
    const roomNode = firstNight?.rooms;
    const roomRef = (Array.isArray(roomNode) ? roomNode[0] : roomNode) ?? null;

    const nights = diffNights(reservation.checkin_date, reservation.checkout_date);
    const totalPrice = toNumber(reservation.total_price);
    const nightlyRates = activeNights
      .map((night: ReservationNightRow) => toNumber(night.nightly_price))
      .filter((rate: number) => rate > 0);
    const ratePerNight =
      nightlyRates.length > 0
        ? Number((nightlyRates.reduce((sum: number, rate: number) => sum + rate, 0) / nightlyRates.length).toFixed(2))
        : Number((totalPrice / nights).toFixed(2));

    const identityNumber = guestProfile?.passport_no || guestProfile?.id_card_number || "";
    const identityType = guestProfile?.passport_no
      ? "Passport"
      : guestProfile?.id_card_number
        ? "ID Card"
        : "";

    const settingsRef = settings as {
      hotel_name?: string | null;
      hotel_address?: string | null;
      hotel_phone?: string | null;
      check_in_time?: string | null;
    } | null;

    const regCard = {
      hotel_name: settingsRef?.hotel_name ?? "My Hotel",
      hotel_address: settingsRef?.hotel_address ?? "Hotel Address",
      hotel_phone: settingsRef?.hotel_phone ?? "000-000-0000",
      booking_code: reservation.booking_code,
      guest_name: reservation.guest_name,
      guest_phone: reservation.phone ?? "",
      room_type: roomRef?.room_types?.name_en ?? "Unknown",
      room_number: roomRef?.room_number ?? "—",
      room_floor: roomRef?.floor_number ?? null,
      checkin_date: reservation.checkin_date,
      checkout_date: reservation.checkout_date,
      nights,
      rate_per_night: ratePerNight,
      total_price: totalPrice,
      deposit_amount: toNumber(reservation.deposit_amount),
      source: reservation.source,
      note: reservation.note ?? "",
      special_requests: reservation.specials ?? reservation.note ?? "",
      guest_identity_type: identityType,
      guest_identity_number: identityNumber,
      guest_nationality: guestProfile?.nationality ?? "",
      arrival_time: reservation.checkin_time ?? (settingsRef?.check_in_time ?? "14:00"),
      checked_in_at: reservation.checked_in_at ?? null
    };

    return NextResponse.json({ success: true, regCard });
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
