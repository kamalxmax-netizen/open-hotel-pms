import { linenApiError, requireLinenAccess } from "@/lib/linen/api-auth";
import {
  addAccumulatedDayuseToBatch,
  addDayuseRoomsToAccumulator,
  DAYUSE_TOWEL_THRESHOLD,
  getDayuseAccumulator,
} from "@/lib/linen/dayuse-accumulator";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

export const dynamic = "force-dynamic";
export const fetchCache = "force-no-store";

const schema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("add_rooms"), room_count: z.coerce.number().int().positive(), business_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/) }),
  z.object({ action: z.literal("add_to_batch"), batch_id: z.string().uuid() }),
]);

export async function GET(request: NextRequest) {
  try {
    const { supabase } = await requireLinenAccess(request);
    const rows = await getDayuseAccumulator(supabase);
    const towel = rows.find((row: any) => Number(row.item_number) === 2);
    return NextResponse.json({
      success: true,
      data: {
        items: rows,
        dayuse_towel_count: Number((towel as any)?.qty_accumulated ?? 0),
        dayuse_threshold: DAYUSE_TOWEL_THRESHOLD,
      },
    });
  } catch (error) {
    console.error("api/linen/dayuse GET failed", error);
    const { status, message } = linenApiError(error, "Failed to load dayuse linen.");
    return NextResponse.json({ success: false, error: message }, { status });
  }
}

export async function POST(request: NextRequest) {
  try {
    const { supabase } = await requireLinenAccess(request);
    const body = await request.json().catch(() => ({}));
    const parsed = schema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json({ success: false, error: "Invalid payload.", details: parsed.error.flatten() }, { status: 400 });
    }
    const data = parsed.data.action === "add_rooms"
      ? await addDayuseRoomsToAccumulator(supabase, parsed.data)
      : await addAccumulatedDayuseToBatch(supabase, parsed.data.batch_id);
    return NextResponse.json({ success: true, data });
  } catch (error) {
    console.error("api/linen/dayuse POST failed", error);
    const { status, message } = linenApiError(error, "Failed to update dayuse linen.");
    return NextResponse.json({ success: false, error: message }, { status });
  }
}
