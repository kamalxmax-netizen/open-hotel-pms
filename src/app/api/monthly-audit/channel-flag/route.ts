import {
  abbreviatedTaxErrorResponse,
  requireAbbreviatedTaxActor,
} from "@/lib/abbreviated-tax-invoice/api-auth";
import { getChannelFlag, setChannelFlag } from "@/lib/monthly-audit-channel-flag/service";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

export const dynamic = "force-dynamic";
export const fetchCache = "force-no-store";

const channelSchema = z.enum(["ota", "walkin", "direct", "agent"]);

const getQuerySchema = z.object({
  entry_id: z.string().uuid(),
});

const postSchema = z.object({
  entry_id: z.string().uuid(),
  actual_channel: channelSchema,
  tax_invoice_channel: channelSchema,
  reason: z.string().trim().max(500).optional(),
});

export async function GET(request: NextRequest) {
  try {
    const actor = await requireAbbreviatedTaxActor(request);
    if (!actor.ok) return actor.response;

    const parsed = getQuerySchema.safeParse({
      entry_id: request.nextUrl.searchParams.get("entry_id") ?? undefined,
    });
    if (!parsed.success) {
      return NextResponse.json(
        { success: false, error: "Invalid query.", details: parsed.error.flatten() },
        { status: 400 }
      );
    }

    const result = await getChannelFlag(actor.supabase, parsed.data.entry_id);
    return NextResponse.json({ success: true, data: result, flag: result });
  } catch (err) {
    return abbreviatedTaxErrorResponse(err);
  }
}

export async function POST(request: NextRequest) {
  try {
    const actor = await requireAbbreviatedTaxActor(request);
    if (!actor.ok) return actor.response;

    const body = await request.json().catch(() => null);
    const parsed = postSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { success: false, error: "Invalid payload.", details: parsed.error.flatten() },
        { status: 400 }
      );
    }

    const result = await setChannelFlag(actor.supabase, {
      entryId: parsed.data.entry_id,
      actualChannel: parsed.data.actual_channel,
      taxInvoiceChannel: parsed.data.tax_invoice_channel,
      reason: parsed.data.reason,
      userId: actor.user.id,
    });
    return NextResponse.json({ success: true, data: result, flag: result });
  } catch (err) {
    return abbreviatedTaxErrorResponse(err);
  }
}
