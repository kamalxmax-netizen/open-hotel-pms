import { linenApiError, requireLinenAccess } from "@/lib/linen/api-auth";
import {
  createMonthlyVendorToken,
  getLatestMonthlyVendorName,
} from "@/lib/linen/monthly-vendor-token";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

export const dynamic = "force-dynamic";
export const fetchCache = "force-no-store";

const bodySchema = z.object({
  year: z.number().int().min(2020).max(2100),
  month: z.number().int().min(1).max(12),
}).strict();

export async function POST(request: NextRequest) {
  try {
    const body = await request.json().catch(() => null);
    const parsed = bodySchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { success: false, error: "Invalid body.", details: parsed.error.flatten() },
        { status: 400 }
      );
    }

    const { supabase, actor } = await requireLinenAccess(request);
    const { year, month } = parsed.data;
    const vendorName = await getLatestMonthlyVendorName(supabase, year, month);
    const data = await createMonthlyVendorToken(supabase, year, month, {
      vendorName,
      baseUrl: request.nextUrl.origin,
      createdBy: actor.userId,
    });

    return NextResponse.json(data);
  } catch (error) {
    console.error("api/linen/vendor/monthly/generate POST failed", error);
    const { status, message } = linenApiError(error, "Failed to create monthly vendor token.");
    return NextResponse.json({ success: false, error: message }, { status });
  }
}
