import { linenApiError, requireLinenAccess } from "@/lib/linen/api-auth";
import { reopenLinenMonth } from "@/lib/linen/month-close";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

export const dynamic = "force-dynamic";
export const fetchCache = "force-no-store";

const bodySchema = z.object({
  year: z.coerce.number().int().min(2020).max(2100),
  month: z.coerce.number().int().min(1).max(12),
  reason: z.string().trim().min(10).max(500),
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

    const result = await reopenLinenMonth(supabase, {
      year: parsed.data.year,
      month: parsed.data.month,
      reason: parsed.data.reason,
      actorUserId: actor.userId,
    });
    return NextResponse.json(result, { status: result.success ? 200 : 409 });
  } catch (error) {
    console.error("api/linen/monthly/reopen POST failed", error);
    const { status, message } = linenApiError(error, "Failed to reopen linen month.");
    return NextResponse.json({ success: false, error: message }, { status });
  }
}
