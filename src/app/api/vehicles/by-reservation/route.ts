import {
  getVehicleErrorMessage,
  getVehicleErrorStatus,
  getVehiclesByReservation,
  requireVehicleActor,
} from "@/lib/vehicles";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

export const dynamic = "force-dynamic";
export const fetchCache = "force-no-store";

const querySchema = z.object({
  reservation_id: z.string().uuid("reservation_id must be uuid"),
});

export async function GET(request: NextRequest) {
  try {
    const parsed = querySchema.safeParse({
      reservation_id: request.nextUrl.searchParams.get("reservation_id") ?? undefined,
    });
    if (!parsed.success) {
      return NextResponse.json(
        { success: false, error: "Invalid query.", details: parsed.error.flatten() },
        { status: 400 },
      );
    }

    const supabase = createServerSupabaseClient();
    await requireVehicleActor(supabase, request);
    const vehicles = await getVehiclesByReservation(supabase, parsed.data.reservation_id);

    return NextResponse.json({
      success: true,
      reservation_id: parsed.data.reservation_id,
      vehicles,
      active_vehicles: vehicles.filter((vehicle) => vehicle.is_active),
      history: vehicles.filter((vehicle) => !vehicle.is_active),
    });
  } catch (error) {
    return NextResponse.json(
      { success: false, error: getVehicleErrorMessage(error) },
      { status: getVehicleErrorStatus(error) },
    );
  }
}
