import { requireDynamicRulesAdminAccess, runDynamicEvaluation } from "@/lib/dynamic-rules/service";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

export const dynamic = "force-dynamic";
export const fetchCache = "force-no-store";

const payloadSchema = z.object({
  start_date: z.string().date(),
  end_date: z.string().date(),
});

export async function POST(request: NextRequest) {
  const auth = await requireDynamicRulesAdminAccess(request);
  if (!auth.ok) {
    return NextResponse.json({ success: false, error: auth.error }, { status: auth.error === "Unauthorized." ? 401 : 403 });
  }

  const parsed = payloadSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ success: false, error: "Invalid payload.", details: parsed.error.flatten() }, { status: 400 });
  }

  const result = await runDynamicEvaluation(auth.supabase, {
    startDate: parsed.data.start_date,
    endDate: parsed.data.end_date,
    actorUserId: auth.actor.userId,
  });

  return NextResponse.json(result, { status: result.success ? 200 : 500 });
}
