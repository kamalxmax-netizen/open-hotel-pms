import {
  abbreviatedTaxErrorResponse,
  requireAbbreviatedTaxActor,
} from "@/lib/abbreviated-tax-invoice/api-auth";
import { generateAbbreviatedInvoices } from "@/lib/abbreviated-tax-invoice/service";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

export const dynamic = "force-dynamic";
export const fetchCache = "force-no-store";

const bodySchema = z.object({
  year: z.coerce.number().int().min(2025).max(2035),
  month: z.coerce.number().int().min(1).max(12),
});

export async function POST(request: NextRequest) {
  try {
    const actor = await requireAbbreviatedTaxActor(request);
    if (!actor.ok) return actor.response;

    const body = await request.json().catch(() => null);
    const parsed = bodySchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { success: false, error: "Invalid payload.", details: parsed.error.flatten() },
        { status: 400 }
      );
    }

    const result = await generateAbbreviatedInvoices(
      actor.supabase,
      parsed.data.year,
      parsed.data.month,
      actor.user.id
    );
    return NextResponse.json({ success: true, data: result, ...result });
  } catch (err) {
    return abbreviatedTaxErrorResponse(err);
  }
}
