import {
  getActiveVehicleSummary,
  getVehicleErrorMessage,
  getVehicleErrorStatus,
  requireVehicleActor,
} from "@/lib/vehicles";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { NextRequest, NextResponse } from "next/server";

export const dynamic = "force-dynamic";
export const fetchCache = "force-no-store";

export async function GET(request: NextRequest) {
  try {
    const supabase = createServerSupabaseClient();
    await requireVehicleActor(supabase, request);
    const rooms = await getActiveVehicleSummary(supabase);
    const activeCount = Object.values(rooms).reduce((sum, vehicles) => sum + vehicles.length, 0);

    return NextResponse.json({
      success: true,
      active_count: activeCount,
      rooms,
      generated_at: new Date().toISOString(),
    });
  } catch (error) {
    return NextResponse.json(
      { success: false, error: getVehicleErrorMessage(error) },
      { status: getVehicleErrorStatus(error) },
    );
  }
}
