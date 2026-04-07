import {
  VEHICLE_COLORS,
  VEHICLE_COUNTRIES,
  VEHICLE_TYPES,
  getVehicleById,
  getVehicleErrorMessage,
  getVehicleErrorStatus,
  requireVehicleActor,
  updateVehicle,
} from "@/lib/vehicles";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

export const dynamic = "force-dynamic";
export const fetchCache = "force-no-store";

const paramsSchema = z.object({
  id: z.string().uuid("Invalid vehicle id."),
});

const patchSchema = z.object({
  vehicle_type: z.enum(VEHICLE_TYPES).optional(),
  plate_number: z.string().trim().max(120).nullable().optional(),
  plate_province: z.string().trim().max(120).nullable().optional(),
  plate_country: z.enum(VEHICLE_COUNTRIES).optional(),
  vehicle_brand: z.string().trim().max(120).nullable().optional(),
  vehicle_model: z.string().trim().max(120).nullable().optional(),
  vehicle_color: z.enum(VEHICLE_COLORS).optional(),
  description: z.string().trim().max(500).nullable().optional(),
}).refine((payload) => Object.keys(payload).length > 0, {
  message: "At least one field is required.",
});

export async function GET(request: NextRequest, { params }: { params: { id: string } }) {
  try {
    const parsedParams = paramsSchema.safeParse(params);
    if (!parsedParams.success) {
      return NextResponse.json({ success: false, error: parsedParams.error.issues[0]?.message ?? "Invalid vehicle id." }, { status: 400 });
    }

    const supabase = createServerSupabaseClient();
    await requireVehicleActor(supabase, request);
    const vehicle = await getVehicleById(supabase, parsedParams.data.id);
    if (!vehicle) {
      return NextResponse.json({ success: false, error: "Vehicle not found." }, { status: 404 });
    }

    return NextResponse.json({
      success: true,
      vehicle,
    });
  } catch (error) {
    return NextResponse.json(
      { success: false, error: getVehicleErrorMessage(error) },
      { status: getVehicleErrorStatus(error) },
    );
  }
}

export async function PATCH(request: NextRequest, { params }: { params: { id: string } }) {
  try {
    const parsedParams = paramsSchema.safeParse(params);
    if (!parsedParams.success) {
      return NextResponse.json({ success: false, error: parsedParams.error.issues[0]?.message ?? "Invalid vehicle id." }, { status: 400 });
    }

    const json = await request.json().catch(() => null);
    const parsedBody = patchSchema.safeParse(json);
    if (!parsedBody.success) {
      return NextResponse.json(
        { success: false, error: "Invalid payload.", details: parsedBody.error.flatten() },
        { status: 400 },
      );
    }

    const supabase = createServerSupabaseClient();
    await requireVehicleActor(supabase, request);
    const vehicle = await updateVehicle(supabase, parsedParams.data.id, parsedBody.data);

    return NextResponse.json({
      success: true,
      vehicle,
    });
  } catch (error) {
    return NextResponse.json(
      { success: false, error: getVehicleErrorMessage(error) },
      { status: getVehicleErrorStatus(error) },
    );
  }
}
