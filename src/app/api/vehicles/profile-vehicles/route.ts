import {
  getProfileDistinctVehicles,
  getVehicleErrorMessage,
  getVehicleErrorStatus,
  requireVehicleActor,
} from "@/lib/vehicles";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

export const dynamic = "force-dynamic";
export const fetchCache = "force-no-store";

const querySchema = z.object({
  guest_profile_id: z.string().uuid("guest_profile_id must be uuid"),
});

export async function GET(request: NextRequest) {
  try {
    const parsed = querySchema.safeParse({
      guest_profile_id: request.nextUrl.searchParams.get("guest_profile_id") ?? undefined,
    });
    if (!parsed.success) {
      return NextResponse.json(
        { success: false, error: "Invalid query.", details: parsed.error.flatten() },
        { status: 400 },
      );
    }

    const supabase = createServerSupabaseClient();
    await requireVehicleActor(supabase, request);
    const vehicles = await getProfileDistinctVehicles(supabase, parsed.data.guest_profile_id);

    return NextResponse.json({
      success: true,
      guest_profile_id: parsed.data.guest_profile_id,
      vehicles,
      count: vehicles.length,
    });
  } catch (error) {
    return NextResponse.json(
      { success: false, error: getVehicleErrorMessage(error) },
      { status: getVehicleErrorStatus(error) },
    );
  }
}
