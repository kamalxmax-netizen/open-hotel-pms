import { createServerSupabaseClient } from "@/lib/supabase/server";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

type RouteParams = { params: { id: string } };

const idSchema = z.string().uuid("Invalid driver id");

const driverUpdateSchema = z
  .object({
    name: z.string().trim().min(1).max(200).optional(),
    phone: z.string().trim().max(50).optional().nullable(),
    license_type: z.string().trim().max(50).optional().nullable(),
    company: z.string().trim().max(200).optional().nullable(),
    photo_url: z.string().trim().max(500).optional().nullable(),
    notes: z.string().trim().max(2000).optional().nullable(),
    is_active: z.boolean().optional(),
  })
  .refine((v) => Object.keys(v).length > 0, { message: "At least one field is required." });

export async function GET(_request: NextRequest, { params }: RouteParams) {
  try {
    const parsedId = idSchema.safeParse(params.id);
    if (!parsedId.success) {
      return NextResponse.json(
        { success: false, error: parsedId.error.issues[0]?.message ?? "Invalid id." },
        { status: 400 }
      );
    }
    const driverId = parsedId.data;

    const supabase = createServerSupabaseClient();
    const { data: driver, error: driverError } = await supabase
      .from("drivers")
      .select(`
        id,
        name,
        phone,
        license_type,
        company,
        photo_url,
        rating_avg,
        total_trips,
        is_active,
        notes,
        created_at,
        updated_at
      `)
      .eq("id", driverId)
      .maybeSingle();

    if (driverError) {
      return NextResponse.json({ success: false, error: driverError.message }, { status: 500 });
    }
    if (!driver) {
      return NextResponse.json({ success: false, error: "Driver not found." }, { status: 404 });
    }

    const { data: trips, error: tripsError } = await supabase
      .from("transfers")
      .select("id, guest_name, pickup_datetime, pickup_location, dropoff_location, status, driver_fee")
      .eq("driver_id", driverId)
      .order("pickup_datetime", { ascending: false })
      .limit(20);

    if (tripsError) {
      return NextResponse.json({ success: false, error: tripsError.message }, { status: 500 });
    }

    const tripIds = (trips ?? []).map((t: any) => String(t.id));
    const ratingByTransferId = new Map<string, { punctuality: number; value: number; service: number }>();

    if (tripIds.length > 0) {
      const { data: ratings, error: ratingsError } = await supabase
        .from("driver_ratings")
        .select("transfer_id, score_punctuality, score_value, score_service")
        .in("transfer_id", tripIds);

      if (ratingsError) {
        return NextResponse.json({ success: false, error: ratingsError.message }, { status: 500 });
      }

      for (const rating of ratings ?? []) {
        ratingByTransferId.set(String(rating.transfer_id), {
          punctuality: Number(rating.score_punctuality),
          value: Number(rating.score_value),
          service: Number(rating.score_service),
        });
      }
    }

    const recent_trips = (trips ?? []).map((trip: any) => ({
      transfer_id: String(trip.id),
      guest_name: trip.guest_name ?? null,
      pickup_datetime: trip.pickup_datetime ?? null,
      pickup_location: trip.pickup_location ?? null,
      dropoff_location: trip.dropoff_location ?? null,
      status: trip.status ?? null,
      driver_fee: trip.driver_fee ?? null,
      rating: ratingByTransferId.get(String(trip.id)) ?? null,
    }));

    return NextResponse.json({ success: true, driver, recent_trips });
  } catch (err) {
    console.error("transportation/drivers/:id GET failed", err);
    const message = err instanceof Error ? err.message : "Internal server error";
    return NextResponse.json({ success: false, error: message }, { status: 500 });
  }
}

export async function PUT(request: NextRequest, { params }: RouteParams) {
  try {
    const parsedId = idSchema.safeParse(params.id);
    if (!parsedId.success) {
      return NextResponse.json(
        { success: false, error: parsedId.error.issues[0]?.message ?? "Invalid id." },
        { status: 400 }
      );
    }
    const driverId = parsedId.data;

    const json = await request.json().catch(() => null);
    const parsed = driverUpdateSchema.safeParse(json);
    if (!parsed.success) {
      return NextResponse.json(
        { success: false, error: "Invalid payload.", details: parsed.error.flatten() },
        { status: 400 }
      );
    }

    const body = parsed.data;
    const supabase = createServerSupabaseClient();

    const { data: existingDriver, error: existingError } = await supabase
      .from("drivers")
      .select("id")
      .eq("id", driverId)
      .maybeSingle();
    if (existingError) {
      return NextResponse.json({ success: false, error: existingError.message }, { status: 500 });
    }
    if (!existingDriver) {
      return NextResponse.json({ success: false, error: "Driver not found." }, { status: 404 });
    }

    const updates: Record<string, unknown> = {};
    if (body.name !== undefined) updates.name = body.name;
    if (body.phone !== undefined) updates.phone = body.phone?.trim() || null;
    if (body.license_type !== undefined) updates.license_type = body.license_type?.trim() || null;
    if (body.company !== undefined) updates.company = body.company?.trim() || null;
    if (body.photo_url !== undefined) updates.photo_url = body.photo_url?.trim() || null;
    if (body.notes !== undefined) updates.notes = body.notes?.trim() || null;
    if (body.is_active !== undefined) updates.is_active = body.is_active;

    const { data: driver, error: updateError } = await supabase
      .from("drivers")
      .update(updates)
      .eq("id", driverId)
      .select(`
        id,
        name,
        phone,
        license_type,
        company,
        photo_url,
        rating_avg,
        total_trips,
        is_active,
        notes,
        created_at,
        updated_at
      `)
      .maybeSingle();

    if (updateError) {
      return NextResponse.json({ success: false, error: updateError.message }, { status: 500 });
    }
    if (!driver) {
      return NextResponse.json({ success: false, error: "Driver not found." }, { status: 404 });
    }

    return NextResponse.json({ success: true, driver });
  } catch (err) {
    console.error("transportation/drivers/:id PUT failed", err);
    const message = err instanceof Error ? err.message : "Internal server error";
    return NextResponse.json({ success: false, error: message }, { status: 500 });
  }
}
