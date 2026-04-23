import { readAlertSettings, requireAlertsAdminAccess, requireAlertsReadAccess, updateAlertSettings } from "@/lib/alerts/service";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

export const dynamic = "force-dynamic";
export const fetchCache = "force-no-store";

const patchSchema = z.object({
  start_time: z.string().regex(/^\d{2}:\d{2}$/).optional(),
  snooze_minutes: z.number().int().min(5).max(480).optional(),
  prepayment_lead_days: z.number().int().min(1).max(30).optional(),
});

export async function GET(request: NextRequest) {
  const auth = await requireAlertsReadAccess(request);
  if (!auth.ok) {
    return NextResponse.json({ success: false, error: auth.error }, { status: auth.error === "Unauthorized." ? 401 : 403 });
  }

  try {
    const settings = await readAlertSettings(auth.supabase);
    return NextResponse.json({ success: true, settings });
  } catch (error) {
    return NextResponse.json({ success: false, error: error instanceof Error ? error.message : "Unexpected error." }, { status: 500 });
  }
}

export async function PATCH(request: NextRequest) {
  const auth = await requireAlertsAdminAccess(request);
  if (!auth.ok) {
    return NextResponse.json({ success: false, error: auth.error }, { status: auth.error === "Unauthorized." ? 401 : 403 });
  }

  const parsed = patchSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ success: false, error: "Invalid payload.", details: parsed.error.flatten() }, { status: 400 });
  }

  try {
    const settings = await updateAlertSettings(auth.supabase, auth.actor.userId, parsed.data);
    return NextResponse.json({ success: true, settings });
  } catch (error) {
    return NextResponse.json({ success: false, error: error instanceof Error ? error.message : "Unexpected error." }, { status: 400 });
  }
}
