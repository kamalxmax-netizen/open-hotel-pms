import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { assertRoomAvailableForDateRange, PlannedRoomMoveError } from "@/lib/planned-room-moves";
import { assertRoomTypeCapacityForDateRange } from "@/lib/room-type-capacity";
import { linkPrimaryGuestToReservation, ReservationPartyError } from "@/lib/reservation-party";
import { isValidDateString, listNights } from "@/lib/dates";

const paramsSchema = z.object({
  id: z.string().uuid("Invalid reservation id."),
});

const bodySchema = z.object({
  checkin_date: z.string(),
  checkout_date: z.string(),
  source: z.enum(["walkin", "ota", "direct", "agent"]).default("walkin"),
  room_type_id: z.coerce.number().int().positive().optional().nullable(),
  room_id: z.string().uuid().optional().nullable(),
  rate_plan_id: z.string().uuid().optional().nullable(),
  note: z.string().optional(),
  copy_accompanying: z.coerce.boolean().optional().default(true),
  copy_preferences: z.coerce.boolean().optional().default(true),
});

export async function POST(request: NextRequest, { params }: { params: { id: string } }) {
  try {
    const parsedParams = paramsSchema.safeParse(params);
    if (!parsedParams.success) {
      return NextResponse.json({ success: false, error: parsedParams.error.issues[0]?.message ?? "Invalid reservation id." }, { status: 400 });
    }
    const json = await request.json().catch(() => null);
    const parsedBody = bodySchema.safeParse(json);
    if (!parsedBody.success) {
      return NextResponse.json({ success: false, error: "Invalid payload.", details: parsedBody.error.flatten() }, { status: 400 });
    }

    const originalReservationId = parsedParams.data.id;
    const payload = parsedBody.data;
    if (!isValidDateString(payload.checkin_date) || !isValidDateString(payload.checkout_date)) {
      return NextResponse.json({ success: false, error: "Invalid date format. Use YYYY-MM-DD." }, { status: 400 });
    }
    if (payload.checkout_date <= payload.checkin_date) {
      return NextResponse.json({ success: false, error: "checkout_date must be after checkin_date." }, { status: 400 });
    }

    const nights = listNights(payload.checkin_date, payload.checkout_date);
    if (!payload.room_id && !payload.room_type_id) {
      return NextResponse.json({ success: false, error: "Either room_id or room_type_id is required." }, { status: 400 });
    }

    const supabase = createServerSupabaseClient();

    const { data: originalReservation, error: originalError } = await supabase
      .from("reservations")
      .select("id, booking_code, guest_name, phone, source, status, checkin_date, checkout_date, checkin_time, note, specials, guest_profile_id")
      .eq("id", originalReservationId)
      .maybeSingle();
    if (originalError) {
      return NextResponse.json({ success: false, error: originalError.message }, { status: 500 });
    }
    if (!originalReservation) {
      return NextResponse.json({ success: false, error: "Original reservation not found." }, { status: 404 });
    }

    if (payload.room_id) {
      try {
        await assertRoomAvailableForDateRange(supabase as any, {
          roomId: payload.room_id,
          checkinDate: payload.checkin_date,
          checkoutDate: payload.checkout_date,
        });
      } catch (error) {
        if (error instanceof PlannedRoomMoveError) {
          return NextResponse.json({ success: false, error: error.message }, { status: error.status });
        }
        throw error;
      }
    }

    let capacityRoomTypeId: number | null = payload.room_type_id ?? null;
    if (payload.room_id) {
      const { data: selectedRoom, error: selectedRoomError } = await supabase
        .from("rooms")
        .select("room_type_id")
        .eq("id", payload.room_id)
        .maybeSingle();
      if (selectedRoomError) {
        return NextResponse.json({ success: false, error: selectedRoomError.message }, { status: 500 });
      }
      const resolvedRoomTypeId = Number(selectedRoom?.room_type_id ?? 0);
      if (Number.isFinite(resolvedRoomTypeId) && resolvedRoomTypeId > 0) {
        capacityRoomTypeId = resolvedRoomTypeId;
      }
    }

    if (capacityRoomTypeId !== null) {
      try {
        await assertRoomTypeCapacityForDateRange(supabase as any, {
          roomTypeId: capacityRoomTypeId,
          nights,
        });
      } catch (error) {
        if (error instanceof PlannedRoomMoveError) {
          return NextResponse.json({ success: false, error: error.message }, { status: error.status });
        }
        throw error;
      }
    }

    const { data: reservation, error } = await supabase.rpc("booking_create_reservation", {
      p_guest_name: String(originalReservation.guest_name ?? "").trim(),
      p_room_id: payload.room_id || null,
      p_room_type_id: payload.room_type_id ?? null,
      p_checkin_date: payload.checkin_date,
      p_checkout_date: payload.checkout_date,
      p_source: payload.source,
      p_phone: String(originalReservation.phone ?? "").trim() || null,
      p_checkin_time: String(originalReservation.checkin_time ?? "").trim() || null,
      p_note: String(payload.note ?? "").trim() || null,
      p_ota_prices: null,
    });

    if (error) {
      return NextResponse.json({ success: false, error: error.message ?? "Failed to create linked extension reservation." }, { status: 500 });
    }
    if (!reservation?.id) {
      return NextResponse.json({ success: false, error: "Failed to create linked extension reservation." }, { status: 500 });
    }

    const newReservationId = String(reservation.id);

    await supabase
      .from("reservations")
      .update({
        parent_reservation_id: originalReservationId,
        specials: payload.copy_preferences ? originalReservation.specials ?? null : null,
        note: String(payload.note ?? "").trim() || (payload.copy_preferences ? originalReservation.note ?? null : null),
        rate_plan_id: payload.rate_plan_id || null,
      })
      .eq("id", newReservationId);

    if (originalReservation.guest_profile_id) {
      try {
        await linkPrimaryGuestToReservation(supabase as any, newReservationId, String(originalReservation.guest_profile_id));
      } catch (error) {
        if (error instanceof ReservationPartyError) {
          return NextResponse.json({ success: false, error: error.message }, { status: error.status });
        }
        throw error;
      }
    }

    if (payload.copy_accompanying) {
      const { data: originalGuests, error: guestsError } = await supabase
        .from("reservation_guests")
        .select("guest_profile_id, role, display_order")
        .eq("reservation_id", originalReservationId)
        .eq("role", "accompanying");
      if (guestsError) {
        return NextResponse.json({ success: false, error: guestsError.message }, { status: 500 });
      }
      if ((originalGuests ?? []).length > 0) {
        const companionRows = (originalGuests ?? []).map((row: any) => ({
          reservation_id: newReservationId,
          guest_profile_id: row.guest_profile_id,
          role: "accompanying",
          display_order: row.display_order,
        }));
        const { error: insertGuestsError } = await supabase.from("reservation_guests").insert(companionRows);
        if (insertGuestsError) {
          return NextResponse.json({ success: false, error: insertGuestsError.message }, { status: 500 });
        }
      }
    }

    if (payload.copy_preferences) {
      const { data: prefs, error: prefsError } = await supabase
        .from("reservation_preferences")
        .select("feature_code")
        .eq("reservation_id", originalReservationId);
      if (prefsError) {
        return NextResponse.json({ success: false, error: prefsError.message }, { status: 500 });
      }
      if ((prefs ?? []).length > 0) {
        const inserts = (prefs ?? []).map((row: any) => ({
          reservation_id: newReservationId,
          feature_code: row.feature_code,
        }));
        const { error: prefInsertError } = await supabase.from("reservation_preferences").insert(inserts);
        if (prefInsertError) {
          return NextResponse.json({ success: false, error: prefInsertError.message }, { status: 500 });
        }
      }
    }

    await supabase.from("audit_logs").insert({
      action: "linked_extension_created",
      entity_type: "reservation",
      entity_id: newReservationId,
      before_json: {
        parent_reservation_id: originalReservationId,
        parent_booking_code: originalReservation.booking_code,
      },
      after_json: {
        source: payload.source,
        checkin_date: payload.checkin_date,
        checkout_date: payload.checkout_date,
        room_id: payload.room_id || null,
        room_type_id: payload.room_type_id ?? null,
        copy_accompanying: payload.copy_accompanying,
        copy_preferences: payload.copy_preferences,
      },
    });

    return NextResponse.json({
      success: true,
      reservation_id: newReservationId,
      parent_reservation_id: originalReservationId,
      reservation,
    });
  } catch (error) {
    return NextResponse.json({ success: false, error: String(error) }, { status: 500 });
  }
}
