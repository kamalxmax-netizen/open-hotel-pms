import { getBusinessDateContext, listAlertsForDate, requireAlertsReadAccess } from "@/lib/alerts/service";
import { NextRequest, NextResponse } from "next/server";

export const dynamic = "force-dynamic";
export const fetchCache = "force-no-store";

export async function GET(request: NextRequest) {
  const auth = await requireAlertsReadAccess(request);
  if (!auth.ok) {
    return NextResponse.json({ success: false, error: auth.error }, { status: auth.error === "Unauthorized." ? 401 : 403 });
  }

  try {
    const context = await getBusinessDateContext(auth.supabase);
    const payload = await listAlertsForDate(auth.supabase, context.businessDate, {
      materialize: true,
      context,
    });
    return NextResponse.json({ success: true, ...payload });
  } catch (error) {
    return NextResponse.json({ success: false, error: error instanceof Error ? error.message : "Unexpected error." }, { status: 500 });
  }
}
