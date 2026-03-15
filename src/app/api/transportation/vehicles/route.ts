import { createServerSupabaseClient } from "@/lib/supabase/server";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

export const dynamic = "force-dynamic";
export const fetchCache = "force-no-store";

const querySchema = z.object({
  is_active: z.enum(["true", "false", "all"]).optional(),
});

const vehicleCreateSchema = z.object({
  plate_number: z.string().trim().min(1, "Plate number is required").max(20),
  vehicle_type: z.string().trim().min(1, "Vehicle type is required").max(50),
  capacity: z.number().int().min(1).max(100).optional().default(4),
  color: z.string().trim().max(50).optional().nullable(),
  default_driver_id: z.string().uuid().optional().nullable(),
  notes: z.string().trim().max(2000).optional().nullable(),
  is_active: z.boolean().optional().default(true),
});

type VehicleRow = {
  id: string;
  plate_number: string;
  vehicle_type: string;
  capacity: number;
  color: string | null;
  default_driver_id: string | null;
  is_active: boolean;
  notes: string | null;
  created_at: string;
  updated_at: string;
};

async function enrichVehicles(
  supabase: ReturnType<typeof createServerSupabaseClient>,
  vehicles: VehicleRow[]
) {
  const driverIds = Array.from(
    new Set(vehicles.map((v) => v.default_driver_id).filter((id): id is string => Boolean(id)))
  );

  const driverNameById = new Map<string, string>();
  if (driverIds.length > 0) {
    const { data: drivers, error } = await supabase
      .from("drivers")
      .select("id, name")
      .in("id", driverIds);

    if (error) return { error };
    for (const driver of drivers ?? []) {
      driverNameById.set(String(driver.id), String(driver.name));
    }
  }

  const enriched = vehicles.map((vehicle) => ({
    ...vehicle,
    default_driver_name: vehicle.default_driver_id
      ? (driverNameById.get(vehicle.default_driver_id) ?? null)
      : null,
  }));

  return { data: enriched };
}

export async function GET(request: NextRequest) {
  try {
    const parsedQuery = querySchema.safeParse({
      is_active: request.nextUrl.searchParams.get("is_active") ?? undefined,
    });
    if (!parsedQuery.success) {
      return NextResponse.json(
        { success: false, error: "Invalid query params.", details: parsedQuery.error.flatten() },
        { status: 400 }
      );
    }

    const isActiveParam = parsedQuery.data.is_active ?? "true";
    const supabase = createServerSupabaseClient();

    let query = supabase
      .from("vehicles")
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
      .order("plate_number", { ascending: true });

    if (isActiveParam === "false") {
      query = query.eq("is_active", false);
    } else if (isActiveParam !== "all") {
      query = query.eq("is_active", true);
    }

    const { data, error } = await query;
    if (error) {
      return NextResponse.json({ success: false, error: error.message }, { status: 500 });
    }

    const enriched = await enrichVehicles(supabase, (data ?? []) as VehicleRow[]);
    if (enriched.error) {
      return NextResponse.json({ success: false, error: enriched.error.message }, { status: 500 });
    }

    return NextResponse.json({ success: true, vehicles: enriched.data ?? [] });
  } catch (err) {
    console.error("transportation/vehicles GET failed", err);
    const message = err instanceof Error ? err.message : "Internal server error";
    return NextResponse.json({ success: false, error: message }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const json = await request.json().catch(() => null);
    const parsed = vehicleCreateSchema.safeParse(json);
    if (!parsed.success) {
      return NextResponse.json(
        { success: false, error: "Invalid payload.", details: parsed.error.flatten() },
        { status: 400 }
      );
    }

    const body = parsed.data;
    const supabase = createServerSupabaseClient();

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

    const { data: inserted, error: insertError } = await supabase
      .from("vehicles")
      .insert({
        plate_number: body.plate_number,
        vehicle_type: body.vehicle_type,
        capacity: body.capacity ?? 4,
        color: body.color?.trim() || null,
        default_driver_id: body.default_driver_id ?? null,
        notes: body.notes?.trim() || null,
        is_active: body.is_active ?? true,
      })
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
      .single();

    if (insertError) {
      if (insertError.code === "23505") {
        return NextResponse.json({ success: false, error: "Plate number already exists." }, { status: 409 });
      }
      return NextResponse.json({ success: false, error: insertError.message }, { status: 500 });
    }

    const enriched = await enrichVehicles(supabase, [inserted as unknown as VehicleRow]);
    if (enriched.error) {
      return NextResponse.json({ success: false, error: enriched.error.message }, { status: 500 });
    }

    return NextResponse.json({ success: true, vehicle: enriched.data?.[0] ?? null }, { status: 201 });
  } catch (err) {
    console.error("transportation/vehicles POST failed", err);
    const message = err instanceof Error ? err.message : "Internal server error";
    return NextResponse.json({ success: false, error: message }, { status: 500 });
  }
}
