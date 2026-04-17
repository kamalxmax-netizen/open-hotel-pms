import { linenApiError, requireLinenAccess } from "@/lib/linen/api-auth";
import { computeMonthlyVariance } from "@/lib/linen/monthly-variance";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

export const dynamic = "force-dynamic";
export const fetchCache = "force-no-store";

const querySchema = z.object({
  year: z.coerce.number().int().min(2020).max(2100),
  month: z.coerce.number().int().min(1).max(12),
});

export async function GET(request: NextRequest) {
  try {
    const parsed = querySchema.safeParse({
      year: request.nextUrl.searchParams.get("year"),
      month: request.nextUrl.searchParams.get("month"),
    });
    if (!parsed.success) {
      return NextResponse.json(
        { success: false, error: "Invalid query.", details: parsed.error.flatten() },
        { status: 400 }
      );
    }

    const { supabase } = await requireLinenAccess(request);
    const data = await computeMonthlyVariance(supabase, parsed.data.year, parsed.data.month);
    return NextResponse.json(data);
  } catch (error) {
    console.error("api/linen/monthly/variance GET failed", error);
    const { status, message } = linenApiError(error, "Failed to load linen monthly variance.");
    return NextResponse.json({ success: false, error: message }, { status });
  }
}
