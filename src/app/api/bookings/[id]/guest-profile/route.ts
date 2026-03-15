import { createServerSupabaseClient } from "@/lib/supabase/server";
import {
  linkPrimaryGuestToReservation,
  ReservationPartyError,
  unlinkPrimaryGuestFromReservation,
} from "@/lib/reservation-party";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

export const dynamic = "force-dynamic";

const paramsSchema = z.object({
  id: z.string().uuid("Invalid reservation id"),
});

const bodySchema = z.object({
  guest_profile_id: z.string().uuid("guest_profile_id is required"),
});

export async function POST(request: NextRequest, { params }: { params: { id: string } }) {
  try {
    const parsedParams = paramsSchema.safeParse(params);
    if (!parsedParams.success) {
      return NextResponse.json(
        { success: false, error: parsedParams.error.issues[0]?.message ?? "Invalid reservation id." },
        { status: 400 }
      );
    }

    const json = await request.json().catch(() => null);
    const parsedBody = bodySchema.safeParse(json);
    if (!parsedBody.success) {
      return NextResponse.json(
        { success: false, error: "Invalid payload.", details: parsedBody.error.flatten() },
        { status: 400 }
      );
    }

    const supabase = createServerSupabaseClient();
    await linkPrimaryGuestToReservation(
      supabase,
      parsedParams.data.id,
      parsedBody.data.guest_profile_id
    );

    const { data: reservation, error } = await supabase
      .from("reservations")
      .select("id, guest_name, guest_profile_id")
      .eq("id", parsedParams.data.id)
      .maybeSingle();

    if (error) {
      return NextResponse.json({ success: false, error: error.message }, { status: 500 });
    }
    if (!reservation) {
      return NextResponse.json({ success: false, error: "Reservation not found." }, { status: 404 });
    }

    return NextResponse.json({ success: true, reservation });
  } catch (err) {
    if (err instanceof ReservationPartyError) {
      return NextResponse.json(
        { success: false, error: err.message, ...(err.details ?? {}) },
        { status: err.status }
      );
    }
    return NextResponse.json({ success: false, error: String(err) }, { status: 500 });
  }
}

export async function DELETE(_request: NextRequest, { params }: { params: { id: string } }) {
  try {
    const parsedParams = paramsSchema.safeParse(params);
    if (!parsedParams.success) {
      return NextResponse.json(
        { success: false, error: parsedParams.error.issues[0]?.message ?? "Invalid reservation id." },
        { status: 400 }
      );
    }

    const supabase = createServerSupabaseClient();
    await unlinkPrimaryGuestFromReservation(supabase, parsedParams.data.id);

    const { data: reservation, error } = await supabase
      .from("reservations")
      .select("id, guest_profile_id")
      .eq("id", parsedParams.data.id)
      .maybeSingle();

    if (error) {
      return NextResponse.json({ success: false, error: error.message }, { status: 500 });
    }
    if (!reservation) {
      return NextResponse.json({ success: false, error: "Reservation not found." }, { status: 404 });
    }

    return NextResponse.json({ success: true, reservation });
  } catch (err) {
    if (err instanceof ReservationPartyError) {
      return NextResponse.json({ success: false, error: err.message }, { status: err.status });
    }
    return NextResponse.json({ success: false, error: String(err) }, { status: 500 });
  }
}
