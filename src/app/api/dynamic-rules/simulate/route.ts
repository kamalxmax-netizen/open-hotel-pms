import { requireDynamicRulesReadAccess, simulateDynamicRules } from "@/lib/dynamic-rules/service";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

export const dynamic = "force-dynamic";
export const fetchCache = "force-no-store";

const payloadSchema = z.object({
  stay_date: z.string().date(),
  group_id: z.string().uuid().optional(),
});

export async function POST(request: NextRequest) {
  const auth = await requireDynamicRulesReadAccess(request);
  if (!auth.ok) {
    return NextResponse.json({ success: false, error: auth.error }, { status: auth.error === "Unauthorized." ? 401 : 403 });
  }

  const parsed = payloadSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ success: false, error: "Invalid payload.", details: parsed.error.flatten() }, { status: 400 });
  }

  const result = await simulateDynamicRules(auth.supabase, parsed.data.stay_date, parsed.data.group_id);
  return NextResponse.json(result);
}
