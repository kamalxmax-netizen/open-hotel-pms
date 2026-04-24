import { NextRequest, NextResponse } from "next/server";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { requireStaffAuth } from "@/lib/server-auth";

export async function GET(request: NextRequest) {
  const name = request.nextUrl.searchParams.get("name")?.trim() ?? "";
  const limitRaw = request.nextUrl.searchParams.get("limit");
  const limit = Math.min(Math.max(Number(limitRaw ?? 20), 1), 50);

  if (!name) {
    return NextResponse.json({ error: "Missing query param: name" }, { status: 400 });
  }

  const supabase = createServerSupabaseClient();
  const auth = await requireStaffAuth(supabase, request);
  if (auth.error) return auth.error;

  const { data: reservations, error: reservationError } = await supabase
    .from("reservations")
    .select(
      "id, booking_code, guest_name, phone, source, status, checkin_date, checkout_date, checkin_time, note, total_price"
    )
    .ilike("guest_name", `%${name}%`)
    .eq("status", "active")
    .order("checkin_date", { ascending: true })
    .limit(limit);

  if (reservationError) {
    return NextResponse.json({ error: reservationError.message }, { status: 500 });
  }
  if (!reservations || reservations.length === 0) {
    return NextResponse.json({ success: true, reservations: [] }, { status: 200 });
  }

  const reservationIds = reservations.map((item) => item.id);
  const { data: nights, error: nightsError } = await supabase
    .from("reservation_nights")
    .select("reservation_id, room_id, stay_date, nightly_price")
    .in("reservation_id", reservationIds)
    .is("cancelled_at", null)
    .order("stay_date", { ascending: true });

  if (nightsError) {
    return NextResponse.json({ error: nightsError.message }, { status: 500 });
  }

  const roomIds = Array.from(new Set((nights ?? []).map((item) => item.room_id).filter(Boolean)));
  const { data: rooms, error: roomsError } = await supabase
    .from("rooms")
    .select("id, room_number")
    .in("id", roomIds);

  if (roomsError) {
    return NextResponse.json({ error: roomsError.message }, { status: 500 });
  }

  const roomNumberById = new Map<string, string>();
  (rooms ?? []).forEach((room) => roomNumberById.set(room.id, room.room_number));

  const nightsByReservation = new Map<string, Array<{ stay_date: string; nightly_price: number; room_number: string }>>();
  (nights ?? []).forEach((item) => {
    const arr = nightsByReservation.get(item.reservation_id) ?? [];
    arr.push({
      stay_date: item.stay_date,
      nightly_price: Number(item.nightly_price ?? 0),
      room_number: item.room_id ? (roomNumberById.get(item.room_id) ?? "Unknown") : "Unassigned"
    });
    nightsByReservation.set(item.reservation_id, arr);
  });

  const result = reservations.map((reservation) => {
    const reservationNights = nightsByReservation.get(reservation.id) ?? [];
    const uniqueRooms = Array.from(new Set(reservationNights.map((item) => item.room_number)));
    return {
      ...reservation,
      rooms: uniqueRooms,
      nights: reservationNights,
      total_nights: reservationNights.length
    };
  });

  return NextResponse.json({ success: true, reservations: result }, { status: 200 });
}
