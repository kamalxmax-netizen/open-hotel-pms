import { linenApiError, requireLinenAccess } from "@/lib/linen/api-auth";
import { resolvePendingItems } from "@/lib/linen/pending-service";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

export const dynamic = "force-dynamic";
export const fetchCache = "force-no-store";

const schema = z.object({
  batch_id: z.string().uuid(),
  pending_items: z.array(z.object({ pending_item_id: z.string().uuid() })).min(1),
});

export async function POST(request: NextRequest) {
  try {
    const { supabase } = await requireLinenAccess(request);
    const body = await request.json().catch(() => ({}));
    const parsed = schema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json({ success: false, error: "Invalid payload.", details: parsed.error.flatten() }, { status: 400 });
    }
    const data = await resolvePendingItems(supabase, parsed.data.batch_id, parsed.data.pending_items);
    return NextResponse.json({ success: true, data });
  } catch (error) {
    console.error("api/linen/pending/resolve POST failed", error);
    const { status, message } = linenApiError(error, "Failed to resolve pending linen.");
    return NextResponse.json({ success: false, error: message }, { status });
  }
}
