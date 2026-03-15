import { createServerSupabaseClient } from "@/lib/supabase/server";
import { NextResponse } from "next/server";
import { unstable_noStore as noStore } from "next/cache";

type RouteParams = { params: { id: string } };

type PaymentRow = {
  tx_type: "payment" | "refund" | "deposit";
  amount: number | string;
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

    const { data: reservation, error: reservationError } = await supabase
      .from("reservations")
      .select(`
        id,
        booking_code,
        guest_name,
        phone,
        source,
        checkin_date,
        checkout_date,
        checkin_time,
        note,
        total_price,
        deposit_amount,
        created_at,
        reservation_nights(
          stay_date,
          nightly_price,
          cancelled_at,
          rooms(room_number, room_types(name_en))
        )
      `)
      .eq("id", reservationId)
      .maybeSingle();

    if (reservationError) {
      return NextResponse.json({ error: reservationError.message }, { status: 500 });
    }
    if (!reservation) {
      return NextResponse.json({ error: "Reservation not found." }, { status: 404 });
    }

    const { data: payments } = await supabase
      .from("folio_payments")
      .select("tx_type, amount")
      .eq("reservation_id", reservationId);

    const { data: settings } = await supabase
      .from("hotel_settings")
      .select("*")
      .eq("id", 1)
      .maybeSingle();

    const paymentRows = (payments ?? []) as PaymentRow[];
    const totalPaid = paymentRows.reduce((sum, row) => {
      const amount = toNumber(row.amount);
      if (row.tx_type === "payment") return sum + amount;
      if (row.tx_type === "refund") return sum - amount;
      return sum;
    }, 0);

    const activeNights = (Array.isArray(reservation.reservation_nights)
      ? reservation.reservation_nights
      : []
    ).filter((night) => !night.cancelled_at);

    const firstNight = activeNights[0];
    const roomRef = (firstNight?.rooms as { room_number?: string; room_types?: { name_en?: string } | null } | null) ?? null;
    const nights = diffNights(reservation.checkin_date, reservation.checkout_date);
    const totalPrice = toNumber(reservation.total_price);
    const depositAmount = toNumber(reservation.deposit_amount);

    const nightlyRates = activeNights.map((night) => toNumber(night.nightly_price)).filter((rate) => rate > 0);
    const ratePerNight =
      nightlyRates.length > 0
        ? Number((nightlyRates.reduce((sum, rate) => sum + rate, 0) / nightlyRates.length).toFixed(2))
        : Number((totalPrice / nights).toFixed(2));

    const settingsRef = settings as {
      hotel_name?: string | null;
      hotel_address?: string | null;
      hotel_phone?: string | null;
    } | null;

    const confirmation = {
      hotel_name: settingsRef?.hotel_name ?? "My Hotel",
      hotel_address: settingsRef?.hotel_address ?? "Hotel Address",
      hotel_phone: settingsRef?.hotel_phone ?? "000-000-0000",
      booking_code: reservation.booking_code,
      guest_name: reservation.guest_name,
      guest_phone: reservation.phone ?? "",
      room_type: roomRef?.room_types?.name_en ?? "Unknown",
      room_number: roomRef?.room_number ?? "—",
      checkin_date: reservation.checkin_date,
      checkout_date: reservation.checkout_date,
      nights,
      rate_per_night: ratePerNight,
      total_price: totalPrice,
      deposit_amount: depositAmount,
      balance_due: Number((totalPrice - totalPaid).toFixed(2)),
      source: reservation.source,
      note: reservation.note ?? "",
      created_at: reservation.created_at,
      confirmation_number: reservation.booking_code
    };

    return NextResponse.json({ success: true, confirmation });
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
