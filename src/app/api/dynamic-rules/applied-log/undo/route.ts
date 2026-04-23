import { requireDynamicRulesReadAccess, undoAppliedLogRow } from "@/lib/dynamic-rules/service";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

export const dynamic = "force-dynamic";
export const fetchCache = "force-no-store";

const payloadSchema = z.object({
  applied_log_id: z.string().uuid(),
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

  const result = await undoAppliedLogRow(auth.supabase, auth.actor.userId, parsed.data.applied_log_id);
  return NextResponse.json(result, { status: result.success ? 200 : result.error_code === "NOT_FOUND" ? 404 : result.error_code === "DIVERGED" ? 409 : 400 });
}
