import { linenApiError, requireLinenAccess } from "@/lib/linen/api-auth";
import type { LinenMonthlyCloseResult } from "@/lib/types";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

export const dynamic = "force-dynamic";
export const fetchCache = "force-no-store";

const bodySchema = z.object({
  year: z.coerce.number().int().min(2020).max(2100),
  month: z.coerce.number().int().min(1).max(12),
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

    const { data, error } = await (supabase as any).rpc("fn_linen_monthly_close", {
      p_year: parsed.data.year,
      p_month: parsed.data.month,
      p_actor: actor.userId,
    });

    if (error) throw new Error(error.message);
    const result = data as LinenMonthlyCloseResult;
    return NextResponse.json(result, { status: result.success ? 200 : 409 });
  } catch (error) {
    console.error("api/linen/monthly/close POST failed", error);
    const { status, message } = linenApiError(error, "Failed to close linen month.");
    return NextResponse.json({ success: false, error: message }, { status });
  }
}
