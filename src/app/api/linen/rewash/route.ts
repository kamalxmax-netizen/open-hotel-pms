import { linenApiError, requireLinenAccess } from "@/lib/linen/api-auth";
import { createRewashEvents } from "@/lib/linen/rewash";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

export const dynamic = "force-dynamic";
export const fetchCache = "force-no-store";

const bodySchema = z.object({
  sent_in_batch_id: z.string().uuid(),
  items: z.array(z.object({
    linen_item_id: z.coerce.number().int().positive(),
    is_dayuse: z.boolean().default(false),
    qty: z.coerce.number().int().positive(),
    photo_keys: z.array(z.string().trim().min(1)).min(1),
    note: z.string().trim().optional().nullable(),
  })).min(1),
  note: z.string().trim().optional().nullable(),
});

export async function POST(request: NextRequest) {
  try {
    const { supabase, actor } = await requireLinenAccess(request);
    const body = await request.json().catch(() => ({}));
    const parsed = bodySchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json({ success: false, error: "Invalid payload.", details: parsed.error.flatten() }, { status: 400 });
    }

    const events = await createRewashEvents(supabase, {
      batchId: parsed.data.sent_in_batch_id,
      createdBy: actor.userId,
      items: parsed.data.items,
      note: parsed.data.note,
    });
    return NextResponse.json({ success: true, data: { events } });
  } catch (error) {
    console.error("api/linen/rewash POST failed", error);
    const { status, message } = linenApiError(error, "Failed to create rewash events.");
    return NextResponse.json({ success: false, error: message }, { status });
  }
}
