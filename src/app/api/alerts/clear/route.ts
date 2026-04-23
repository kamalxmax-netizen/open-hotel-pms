import { clearAlert, requireAlertsReadAccess } from "@/lib/alerts/service";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

export const dynamic = "force-dynamic";
export const fetchCache = "force-no-store";

const schema = z.object({
  daily_state_id: z.string().uuid(),
  note: z.string().trim().min(1).max(1000),
});

export async function POST(request: NextRequest) {
  const auth = await requireAlertsReadAccess(request);
  if (!auth.ok) {
    return NextResponse.json({ success: false, error: auth.error }, { status: auth.error === "Unauthorized." ? 401 : 403 });
  }

  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ success: false, error: "Invalid payload.", details: parsed.error.flatten() }, { status: 400 });
  }

  try {
    const row = await clearAlert(auth.supabase, auth.actor.userId, parsed.data.daily_state_id, parsed.data.note);
    return NextResponse.json({ success: true, row });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unexpected error.";
    return NextResponse.json({ success: false, error: message }, { status: message.includes("not found") ? 404 : 400 });
  }
}
