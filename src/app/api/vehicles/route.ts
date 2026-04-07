import {
  VEHICLE_COLORS,
  VEHICLE_COUNTRIES,
  VEHICLE_TYPES,
  createVehicleLinks,
  getActiveVehicles,
  getCheckedOutTodayVehicles,
  getVehicleErrorMessage,
  getVehicleErrorStatus,
  requireVehicleActor,
} from "@/lib/vehicles";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

export const dynamic = "force-dynamic";
export const fetchCache = "force-no-store";

const createSchema = z.object({
  reservation_id: z.string().uuid("reservation_id must be uuid"),
  group_link: z.boolean().optional().default(false),
  vehicle_type: z.enum(VEHICLE_TYPES),
  plate_number: z.string().trim().max(120).nullable().optional(),
  plate_province: z.string().trim().max(120).nullable().optional(),
  plate_country: z.enum(VEHICLE_COUNTRIES).optional().default("TH"),
  vehicle_brand: z.string().trim().max(120).nullable().optional(),
  vehicle_model: z.string().trim().max(120).nullable().optional(),
  vehicle_color: z.enum(VEHICLE_COLORS).optional().default("white"),
  description: z.string().trim().max(500).nullable().optional(),
}).superRefine((payload, ctx) => {
  const hasPlate = Boolean(payload.plate_number?.trim());
  const hasDescription = Boolean(payload.description?.trim());
  if (!hasPlate && !hasDescription) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: "plate_number or description is required.",
      path: ["plate_number"],
    });
  }
});

function groupVehiclesByColumn<T extends { vehicle_type: string }>(vehicles: T[]) {
  return {
    cars: vehicles.filter((vehicle) => vehicle.vehicle_type === "car"),
    motorcycles_bicycles: vehicles.filter((vehicle) => vehicle.vehicle_type !== "car"),
  };
}

export async function GET(request: NextRequest) {
  try {
    const supabase = createServerSupabaseClient();
    await requireVehicleActor(supabase, request);

    const [activeVehicles, checkedOutToday] = await Promise.all([
      getActiveVehicles(supabase),
      getCheckedOutTodayVehicles(supabase),
    ]);

    const activeGrouped = groupVehiclesByColumn(activeVehicles);
    const checkedOutGrouped = groupVehiclesByColumn(checkedOutToday);

    return NextResponse.json({
      success: true,
      summary: {
        active_count: activeVehicles.length,
        checked_out_today_count: checkedOutToday.length,
        total_visible: activeVehicles.length + checkedOutToday.length,
      },
      active_vehicles: activeVehicles,
      checked_out_today: checkedOutToday,
      grouped: {
        cars: {
          active: activeGrouped.cars,
          checked_out_today: checkedOutGrouped.cars,
        },
        motorcycles_bicycles: {
          active: activeGrouped.motorcycles_bicycles,
          checked_out_today: checkedOutGrouped.motorcycles_bicycles,
        },
      },
    });
  } catch (error) {
    return NextResponse.json(
      { success: false, error: getVehicleErrorMessage(error) },
      { status: getVehicleErrorStatus(error) },
    );
  }
}

export async function POST(request: NextRequest) {
  try {
    const json = await request.json().catch(() => null);
    const parsed = createSchema.safeParse(json);
    if (!parsed.success) {
      return NextResponse.json(
        { success: false, error: "Invalid payload.", details: parsed.error.flatten() },
        { status: 400 },
      );
    }

    const supabase = createServerSupabaseClient();
    const actor = await requireVehicleActor(supabase, request);
    const result = await createVehicleLinks(supabase, {
      reservationId: parsed.data.reservation_id,
      groupLink: parsed.data.group_link,
      actorName: actor.displayName,
      vehicleType: parsed.data.vehicle_type,
      plateNumber: parsed.data.plate_number ?? null,
      plateProvince: parsed.data.plate_province ?? null,
      plateCountry: parsed.data.plate_country,
      vehicleBrand: parsed.data.vehicle_brand ?? null,
      vehicleModel: parsed.data.vehicle_model ?? null,
      vehicleColor: parsed.data.vehicle_color,
      description: parsed.data.description ?? null,
    });

    return NextResponse.json({
      success: true,
      vehicle: result.vehicles[0] ?? null,
      vehicles: result.vehicles,
      created_count: result.created_count,
      skipped_count: result.skipped_count,
      skipped_reservation_ids: result.skipped_reservation_ids,
    }, { status: 201 });
  } catch (error) {
    return NextResponse.json(
      { success: false, error: getVehicleErrorMessage(error) },
      { status: getVehicleErrorStatus(error) },
    );
  }
}
