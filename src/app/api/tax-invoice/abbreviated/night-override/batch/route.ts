import {
  abbreviatedTaxErrorResponse,
  requireAbbreviatedTaxActor,
} from "@/lib/abbreviated-tax-invoice/api-auth";
import { setNightOverridesBatch } from "@/lib/abbreviated-tax-invoice/service";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

export const dynamic = "force-dynamic";
export const fetchCache = "force-no-store";

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

const bodySchema = z.object({
  entry_id: z.string().uuid(),
  nights: z.array(
    z.object({
      date: z.string().regex(DATE_RE),
      decision: z.enum(["include_this_month", "carry_to_next", "excluded_full_tax"]),
      reason: z.string().trim().max(500).optional(),
    })
  ).min(1).max(100),
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

    const result = await setNightOverridesBatch(actor.supabase, {
      entryId: parsed.data.entry_id,
      nights: parsed.data.nights,
      userId: actor.user.id,
    });
    return NextResponse.json({ success: true, data: result });
  } catch (err) {
    return abbreviatedTaxErrorResponse(err);
  }
}
