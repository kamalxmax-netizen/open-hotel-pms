import { linenApiError, requireLinenAccess } from "@/lib/linen/api-auth";
import { resolveRewashEvent } from "@/lib/linen/rewash";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

export const dynamic = "force-dynamic";
export const fetchCache = "force-no-store";

const bodySchema = z.object({
  resolved_in_batch_id: z.string().uuid(),
  resolved_qty: z.coerce.number().int().min(0),
});

export async function POST(request: NextRequest, { params }: { params: { id: string } }) {
  try {
    const { supabase } = await requireLinenAccess(request);
    const body = await request.json().catch(() => ({}));
    const parsed = bodySchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json({ success: false, error: "Invalid payload.", details: parsed.error.flatten() }, { status: 400 });
    }

    const event = await resolveRewashEvent(supabase, {
      id: Number(params.id),
      resolvedBatchId: parsed.data.resolved_in_batch_id,
      resolvedQty: parsed.data.resolved_qty,
    });
    return NextResponse.json({ success: true, data: { event } });
  } catch (error) {
    console.error("api/linen/rewash/[id]/resolve POST failed", error);
    const { status, message } = linenApiError(error, "Failed to resolve rewash event.");
    return NextResponse.json({ success: false, error: message }, { status });
  }
}
