import { createServerSupabaseClient } from "@/lib/supabase/server";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

type RouteParams = { params: { id: string } };

const idSchema = z.string().uuid("Invalid vehicle id");

const vehicleUpdateSchema = z
  .object({
    plate_number: z.string().trim().min(1).max(20).optional(),
    vehicle_type: z.string().trim().min(1).max(50).optional(),
    capacity: z.number().int().min(1).max(100).optional(),
    color: z.string().trim().max(50).optional().nullable(),
    default_driver_id: z.string().uuid().optional().nullable(),
    notes: z.string().trim().max(2000).optional().nullable(),
    is_active: z.boolean().optional(),
  })
  .refine((v) => Object.keys(v).length > 0, { message: "At least one field is required." });

export async function PUT(request: NextRequest, { params }: RouteParams) {
  try {
    const parsedId = idSchema.safeParse(params.id);
    if (!parsedId.success) {
      return NextResponse.json(
        { success: false, error: parsedId.error.issues[0]?.message ?? "Invalid id." },
        { status: 400 }
      );
    }
    const vehicleId = parsedId.data;

    const json = await request.json().catch(() => null);
    const parsed = vehicleUpdateSchema.safeParse(json);
    if (!parsed.success) {
      return NextResponse.json(
        { success: false, error: "Invalid payload.", details: parsed.error.flatten() },
        { status: 400 }
      );
    }

    const body = parsed.data;
    const supabase = createServerSupabaseClient();

    const { data: existing, error: existingError } = await supabase
      .from("vehicles")
      .select("id")
      .eq("id", vehicleId)
      .maybeSingle();

    if (existingError) {
      return NextResponse.json({ success: false, error: existingError.message }, { status: 500 });
    }
    if (!existing) {
      return NextResponse.json({ success: false, error: "Vehicle not found." }, { status: 404 });
    }

    if (body.default_driver_id) {
      const { data: driver, error: driverError } = await supabase
        .from("drivers")
        .select("id")
        .eq("id", body.default_driver_id)
        .maybeSingle();

      if (driverError) {
        return NextResponse.json({ success: false, error: driverError.message }, { status: 500 });
      }
      if (!driver) {
        return NextResponse.json({ success: false, error: "Default driver not found." }, { status: 400 });
      }
    }

    const updates: Record<string, unknown> = {};
    if (body.plate_number !== undefined) updates.plate_number = body.plate_number;
    if (body.vehicle_type !== undefined) updates.vehicle_type = body.vehicle_type;
    if (body.capacity !== undefined) updates.capacity = body.capacity;
    if (body.color !== undefined) updates.color = body.color?.trim() || null;
    if (body.default_driver_id !== undefined) updates.default_driver_id = body.default_driver_id ?? null;
    if (body.notes !== undefined) updates.notes = body.notes?.trim() || null;
    if (body.is_active !== undefined) updates.is_active = body.is_active;

    const { data: vehicle, error: updateError } = await supabase
      .from("vehicles")
      .update(updates)
      .eq("id", vehicleId)
      .select(`
        id,
        plate_number,
        vehicle_type,
        capacity,
        color,
        default_driver_id,
        is_active,
        notes,
        created_at,
        updated_at
      `)
      .maybeSingle();

    if (updateError) {
      if (updateError.code === "23505") {
        return NextResponse.json({ success: false, error: "Plate number already exists." }, { status: 409 });
      }
      return NextResponse.json({ success: false, error: updateError.message }, { status: 500 });
    }
    if (!vehicle) {
      return NextResponse.json({ success: false, error: "Vehicle not found." }, { status: 404 });
    }

    let default_driver_name: string | null = null;
    if (vehicle.default_driver_id) {
      const { data: driver, error: driverError } = await supabase
        .from("drivers")
        .select("id, name")
        .eq("id", vehicle.default_driver_id)
        .maybeSingle();
      if (driverError) {
        return NextResponse.json({ success: false, error: driverError.message }, { status: 500 });
      }
      default_driver_name = driver?.name ?? null;
    }

    return NextResponse.json({
      success: true,
      vehicle: {
        ...vehicle,
        default_driver_name,
      },
    });
  } catch (err) {
    console.error("transportation/vehicles/:id PUT failed", err);
    const message = err instanceof Error ? err.message : "Internal server error";
    return NextResponse.json({ success: false, error: message }, { status: 500 });
  }
}
