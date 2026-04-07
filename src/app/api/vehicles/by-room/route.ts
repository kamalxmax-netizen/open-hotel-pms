import {
  getVehicleErrorMessage,
  getVehicleErrorStatus,
  getVehiclesByRoom,
  requireVehicleActor,
} from "@/lib/vehicles";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

export const dynamic = "force-dynamic";
export const fetchCache = "force-no-store";

const querySchema = z.object({
  room_id: z.string().uuid("room_id must be uuid"),
});

export async function GET(request: NextRequest) {
  try {
    const parsed = querySchema.safeParse({
      room_id: request.nextUrl.searchParams.get("room_id") ?? undefined,
    });
    if (!parsed.success) {
      return NextResponse.json(
        { success: false, error: "Invalid query.", details: parsed.error.flatten() },
        { status: 400 },
      );
    }

    const supabase = createServerSupabaseClient();
    await requireVehicleActor(supabase, request);
    const vehicles = await getVehiclesByRoom(supabase, parsed.data.room_id);

    return NextResponse.json({
      success: true,
      room_id: parsed.data.room_id,
      vehicles,
    });
  } catch (error) {
    return NextResponse.json(
      { success: false, error: getVehicleErrorMessage(error) },
      { status: getVehicleErrorStatus(error) },
    );
  }
}
