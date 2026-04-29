import { computeLinenDailySnapshot } from "@/lib/linen/daily-snapshot";
import { linenApiError, requireLinenAccess } from "@/lib/linen/api-auth";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

export const dynamic = "force-dynamic";
export const fetchCache = "force-no-store";

const bodySchema = z.object({
  business_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  reason: z.string().trim().max(500).optional().nullable(),
});

export async function POST(request: NextRequest) {
  try {
    const { supabase, actor } = await requireLinenAccess(request);
    if (!actor.isAdmin) {
      return NextResponse.json({ success: false, error: "Forbidden" }, { status: 403 });
    }

    const body = await request.json().catch(() => ({}));
    const parsed = bodySchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { success: false, error: "Invalid payload.", details: parsed.error.flatten() },
        { status: 400 }
      );
    }

    const snapshot = await computeLinenDailySnapshot(supabase, parsed.data.business_date, {
      actorUserId: actor.userId,
      reason: parsed.data.reason,
    });

    return NextResponse.json({ success: true, data: snapshot });
  } catch (error) {
    console.error("api/linen/snapshots/recompute POST failed", error);
    const { status, message } = linenApiError(error, "Failed to recompute linen daily snapshot.");
    return NextResponse.json({ success: false, error: message }, { status });
  }
}
