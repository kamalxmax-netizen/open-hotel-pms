import { getBusinessDateContext, projectAlertCountsForRange, requireAlertsReadAccess } from "@/lib/alerts/service";
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
    const from = request.nextUrl.searchParams.get("from") ?? context.businessDate;
    const to = request.nextUrl.searchParams.get("to") ?? context.businessDate;
    const days = await projectAlertCountsForRange(auth.supabase, from, to, context);
    return NextResponse.json({ success: true, from, to, days });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unexpected error.";
    return NextResponse.json({ success: false, error: message }, { status: message.includes("must be") || message.includes("limited") ? 400 : 500 });
  }
}
