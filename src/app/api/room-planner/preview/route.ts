import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { getAuthenticatedUser } from "@/lib/server-auth";
import {
  previewRoomPlannerActions,
  RoomPlannerEngineError,
  type RoomPlannerActionInput,
} from "@/lib/room-planner-engine";

const nightOverrideSchema = z.object({
  stay_date: z.string(),
  nightly_price: z.coerce.number(),
});

const actionSchema = z.object({
  type: z.enum(["MOVE_WHOLE", "ASSIGN", "UNASSIGN"]),
  reservation_id: z.string().uuid("reservation_id must be uuid"),
  to_room_id: z.string().uuid().optional().nullable(),
  pricing_policy: z.enum(["keep_rtc", "reprice_grid"]).optional(),
  ota_night_overrides: z.array(nightOverrideSchema).optional().nullable(),
});

const payloadSchema = z.object({
  actions: z.array(actionSchema).min(1),
});

export async function POST(request: NextRequest) {
  try {
    const supabase = createServerSupabaseClient();
    const user = await getAuthenticatedUser(supabase, request);
    if (!user) {
      return NextResponse.json({ success: false, error: "Unauthorized" }, { status: 401 });
    }

    const json = await request.json().catch(() => null);
    const parsed = payloadSchema.safeParse(json);
    if (!parsed.success) {
      return NextResponse.json(
        { success: false, error: "Invalid payload.", details: parsed.error.flatten() },
        { status: 400 }
      );
    }

    const actions = parsed.data.actions as RoomPlannerActionInput[];
    const preview = await previewRoomPlannerActions({
      supabase: supabase as any,
      actions,
    });

    return NextResponse.json({
      success: true,
      previews: preview.previews,
      warnings: preview.warnings,
    });
  } catch (error) {
    if (error instanceof RoomPlannerEngineError) {
      return NextResponse.json({ success: false, error: error.message }, { status: error.status });
    }
    return NextResponse.json({ success: false, error: String(error) }, { status: 500 });
  }
}
