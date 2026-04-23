import { bulkSnoozeNightAuditAlerts, requireAlertsReadAccess } from "@/lib/alerts/service";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

export const dynamic = "force-dynamic";
export const fetchCache = "force-no-store";

const schema = z.object({
  date: z.string().date(),
  next_date: z.string().date(),
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
    const migrated = await bulkSnoozeNightAuditAlerts(
      auth.supabase,
      auth.actor.userId,
      parsed.data.date,
      parsed.data.next_date,
      parsed.data.note
    );
    return NextResponse.json({ success: true, migrated });
  } catch (error) {
    return NextResponse.json({ success: false, error: error instanceof Error ? error.message : "Unexpected error." }, { status: 400 });
  }
}
