import {
  getVehicleErrorMessage,
  getVehicleErrorStatus,
  requireVehicleActor,
  unlinkVehicle,
} from "@/lib/vehicles";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

export const dynamic = "force-dynamic";
export const fetchCache = "force-no-store";

const paramsSchema = z.object({
  id: z.string().uuid("Invalid vehicle id."),
});

export async function POST(request: NextRequest, { params }: { params: { id: string } }) {
  try {
    const parsedParams = paramsSchema.safeParse(params);
    if (!parsedParams.success) {
      return NextResponse.json({ success: false, error: parsedParams.error.issues[0]?.message ?? "Invalid vehicle id." }, { status: 400 });
    }

    const supabase = createServerSupabaseClient();
    await requireVehicleActor(supabase, request);
    const vehicle = await unlinkVehicle(supabase, parsedParams.data.id);

    return NextResponse.json({
      success: true,
      vehicle,
      message: "Vehicle unlinked.",
    });
  } catch (error) {
    return NextResponse.json(
      { success: false, error: getVehicleErrorMessage(error) },
      { status: getVehicleErrorStatus(error) },
    );
  }
}
