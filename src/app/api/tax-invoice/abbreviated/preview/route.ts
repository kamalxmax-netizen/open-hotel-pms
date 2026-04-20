import {
  abbreviatedTaxErrorResponse,
  requireAbbreviatedTaxActor,
} from "@/lib/abbreviated-tax-invoice/api-auth";
import { buildAbbreviatedPreview } from "@/lib/abbreviated-tax-invoice/service";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

export const dynamic = "force-dynamic";
export const fetchCache = "force-no-store";

const querySchema = z.object({
  year: z.coerce.number().int().min(2025).max(2035),
  month: z.coerce.number().int().min(1).max(12),
});

export async function GET(request: NextRequest) {
  try {
    const actor = await requireAbbreviatedTaxActor(request);
    if (!actor.ok) return actor.response;

    const parsed = querySchema.safeParse({
      year: request.nextUrl.searchParams.get("year") ?? undefined,
      month: request.nextUrl.searchParams.get("month") ?? undefined,
    });
    if (!parsed.success) {
      return NextResponse.json(
        { success: false, error: "Invalid query.", details: parsed.error.flatten() },
        { status: 400 }
      );
    }

    const preview = await buildAbbreviatedPreview(actor.supabase, parsed.data.year, parsed.data.month);
    return NextResponse.json({ success: true, data: preview, ...preview });
  } catch (err) {
    return abbreviatedTaxErrorResponse(err);
  }
}
