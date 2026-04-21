import {
  abbreviatedTaxErrorResponse,
  requireAbbreviatedTaxActor,
} from "@/lib/abbreviated-tax-invoice/api-auth";
import {
  buildAbbreviatedPreview,
  buildPosPreviewForDate,
} from "@/lib/abbreviated-tax-invoice/service";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

export const dynamic = "force-dynamic";
export const fetchCache = "force-no-store";

const baseQuerySchema = z.object({
  source: z.enum(["room", "dayuse", "pos"]).optional().default("room"),
  date: z.string().date().optional(),
  year: z.coerce.number().int().min(2025).max(2035).optional(),
  month: z.coerce.number().int().min(1).max(12).optional(),
});

export async function GET(request: NextRequest) {
  try {
    const actor = await requireAbbreviatedTaxActor(request);
    if (!actor.ok) return actor.response;

    const parsed = baseQuerySchema.safeParse({
      source: request.nextUrl.searchParams.get("source") ?? undefined,
      date: request.nextUrl.searchParams.get("date") ?? undefined,
      year: request.nextUrl.searchParams.get("year") ?? undefined,
      month: request.nextUrl.searchParams.get("month") ?? undefined,
    });
    if (!parsed.success) {
      return NextResponse.json(
        { success: false, error: "Invalid query.", details: parsed.error.flatten() },
        { status: 400 }
      );
    }

    const { source, date, year, month } = parsed.data;
    if (source === "pos" && date) {
      const preview = await buildPosPreviewForDate(actor.supabase, date);
      return NextResponse.json({ success: true, data: preview, ...preview });
    }

    if (!year || !month) {
      return NextResponse.json(
        {
          success: false,
          error: source === "pos"
            ? "Missing query. Use year/month for monthly preview or source=pos&date=YYYY-MM-DD for daily preview."
            : "Missing year/month query.",
        },
        { status: 400 }
      );
    }

    const preview = await buildAbbreviatedPreview(
      actor.supabase,
      year,
      month,
      source
    );
    return NextResponse.json({ success: true, data: preview, ...preview });
  } catch (err) {
    return abbreviatedTaxErrorResponse(err);
  }
}
