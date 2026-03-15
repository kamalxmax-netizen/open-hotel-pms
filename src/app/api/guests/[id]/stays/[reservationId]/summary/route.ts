import { createServerSupabaseClient } from "@/lib/supabase/server";
import type { GuestStaySummaryResponse } from "@/lib/types";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

const paramsSchema = z.object({
  id: z.string().uuid("Invalid guest profile id"),
  reservationId: z.string().uuid("Invalid reservation id"),
});

function round2(value: number) {
  return Math.round(value * 100) / 100;
}

type ReservationNightRoom = {
  stay_date: string;
  room_number: string | null;
};

function resolveRoomNumberForDate(nights: ReservationNightRoom[] | undefined, targetDate: string | null) {
  if (!nights || nights.length === 0) return null;

  if (targetDate) {
    const exact = nights.find((night) => night.stay_date === targetDate && night.room_number);
    if (exact?.room_number) return exact.room_number;
  }

  let latest: ReservationNightRoom | null = null;
  for (const night of nights) {
    if (!latest || night.stay_date > latest.stay_date) {
      latest = night;
    }
  }
  return latest?.room_number ?? null;
}

export async function GET(
  _request: NextRequest,
  { params }: { params: { id: string; reservationId: string } }
) {
  try {
    const parsed = paramsSchema.safeParse(params);
    if (!parsed.success) {
      return NextResponse.json(
        { success: false, error: parsed.error.issues[0]?.message ?? "Invalid params." },
        { status: 400 }
      );
    }

    const { id: guestProfileId, reservationId } = parsed.data;
    const supabase = createServerSupabaseClient();

    const { data: reservation, error: reservationError } = await supabase
      .from("reservations")
      .select(
        "id, booking_code, guest_profile_id, status, source, checkin_date, checkout_date, checked_in_at, total_price, is_dayuse, deposit_amount"
      )
      .eq("id", reservationId)
      .maybeSingle();

    if (reservationError) {
      return NextResponse.json({ success: false, error: reservationError.message }, { status: 500 });
    }
    if (!reservation) {
      return NextResponse.json({ success: false, error: "Reservation not found." }, { status: 404 });
    }

    let role: "primary" | "accompanying" | null = null;
    if (reservation.guest_profile_id === guestProfileId) {
      role = "primary";
    } else {
      const { data: partyLink, error: partyError } = await supabase
        .from("reservation_guests")
        .select("role")
        .eq("reservation_id", reservationId)
        .eq("guest_profile_id", guestProfileId)
        .maybeSingle();

      if (partyError) {
        return NextResponse.json({ success: false, error: partyError.message }, { status: 500 });
      }
      if (partyLink?.role === "accompanying") {
        role = "accompanying";
      }
    }

    if (!role) {
      return NextResponse.json(
        { success: false, error: "Guest is not linked to this stay." },
        { status: 404 }
      );
    }

    const [nightsRes, transferRes, tipRes, posRes] = await Promise.all([
      supabase
        .from("reservation_nights")
        .select("stay_date, rooms:room_id(room_number)")
        .eq("reservation_id", reservationId)
        .is("cancelled_at", null),
      supabase
        .from("transfer_transactions")
        .select("tx_type, amount")
        .eq("reservation_id", reservationId),
      supabase
        .from("tip_ledger")
        .select("amount, status")
        .eq("reservation_id", reservationId),
      supabase
        .from("pos_orders")
        .select("total, status")
        .eq("reservation_id", reservationId),
    ]);

    if (nightsRes.error) {
      return NextResponse.json({ success: false, error: nightsRes.error.message }, { status: 500 });
    }
    if (transferRes.error) {
      return NextResponse.json({ success: false, error: transferRes.error.message }, { status: 500 });
    }
    if (tipRes.error) {
      return NextResponse.json({ success: false, error: tipRes.error.message }, { status: 500 });
    }
    if (posRes.error) {
      return NextResponse.json({ success: false, error: posRes.error.message }, { status: 500 });
    }

    const nights = (nightsRes.data ?? []).map((row: any) => {
      const room = Array.isArray(row.rooms) ? row.rooms[0] : row.rooms;
      return {
        stay_date: String(row.stay_date ?? ""),
        room_number: room?.room_number ? String(room.room_number) : null,
      };
    });

    const roomNumber = resolveRoomNumberForDate(nights, reservation.checkin_date ?? null);
    const transferTotal = round2(
      (transferRes.data ?? []).reduce((sum, row: any) => {
        const amount = Number(row.amount ?? 0);
        return sum + (row.tx_type === "refund" ? -amount : amount);
      }, 0)
    );
    const tipTotal = round2(
      (tipRes.data ?? []).reduce((sum, row: any) => {
        if (row.status === "reversed") return sum;
        return sum + Number(row.amount ?? 0);
      }, 0)
    );
    const posTotal = round2(
      (posRes.data ?? []).reduce((sum, row: any) => {
        if (row.status === "voided") return sum;
        return sum + Number(row.total ?? 0);
      }, 0)
    );

    const reservationTotal = Number(reservation.total_price ?? 0);
    const dayuseRevenue = reservation.is_dayuse ? reservationTotal : 0;
    const roomRevenue = reservation.is_dayuse ? 0 : reservationTotal;
    const depositReceived = Number(reservation.deposit_amount ?? 0);
    const depositRefunded = 0;
    const visibleTotal = round2(roomRevenue + dayuseRevenue + posTotal + transferTotal + tipTotal - depositRefunded);

    return NextResponse.json({
      success: true,
      summary: {
        reservation_id: reservationId,
        booking_code: reservation.booking_code ?? null,
        room_number: roomNumber,
        role,
        status: reservation.status ?? null,
        source: reservation.source ?? null,
        checkin_date: reservation.checkin_date ?? null,
        checkout_date: reservation.checkout_date ?? null,
        checked_in_at: reservation.checked_in_at ?? null,
        checked_out_at: null,
        room_revenue: round2(roomRevenue),
        dayuse_revenue: round2(dayuseRevenue),
        pos_total: posTotal,
        transfer_total: transferTotal,
        tip_total: tipTotal,
        deposit_received: round2(depositReceived),
        deposit_refunded: round2(depositRefunded),
        visible_total: visibleTotal,
      },
    } satisfies GuestStaySummaryResponse);
  } catch (err) {
    console.error("guests/:id/stays/:reservationId/summary GET failed", err);
    const message = err instanceof Error ? err.message : "Internal server error";
    return NextResponse.json({ success: false, error: message }, { status: 500 });
  }
}
