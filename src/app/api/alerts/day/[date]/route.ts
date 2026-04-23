import { getBusinessDateContext, listAlertsForDate, requireAlertsReadAccess } from "@/lib/alerts/service";
import { NextRequest, NextResponse } from "next/server";

export const dynamic = "force-dynamic";
export const fetchCache = "force-no-store";

export async function GET(request: NextRequest, { params }: { params: { date: string } }) {
  const auth = await requireAlertsReadAccess(request);
  if (!auth.ok) {
    return NextResponse.json({ success: false, error: auth.error }, { status: auth.error === "Unauthorized." ? 401 : 403 });
  }

  try {
    const context = await getBusinessDateContext(auth.supabase);
    const payload = await listAlertsForDate(auth.supabase, params.date, {
      materialize: params.date === context.businessDate,
      context,
    });
    return NextResponse.json({ success: true, ...payload });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unexpected error.";
    return NextResponse.json({ success: false, error: message }, { status: message.includes("YYYY-MM-DD") ? 400 : 500 });
  }
}
