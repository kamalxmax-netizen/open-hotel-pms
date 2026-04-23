import { getNightAuditAlertCheck, requireAlertsReadAccess } from "@/lib/alerts/service";
import { NextRequest, NextResponse } from "next/server";

export const dynamic = "force-dynamic";
export const fetchCache = "force-no-store";

export async function GET(request: NextRequest) {
  const auth = await requireAlertsReadAccess(request);
  if (!auth.ok) {
    return NextResponse.json({ success: false, error: auth.error }, { status: auth.error === "Unauthorized." ? 401 : 403 });
  }

  const date = request.nextUrl.searchParams.get("date");
  if (!date) {
    return NextResponse.json({ success: false, error: "date is required." }, { status: 400 });
  }

  try {
    const result = await getNightAuditAlertCheck(auth.supabase, date);
    return NextResponse.json({ success: true, ...result });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unexpected error.";
    return NextResponse.json({ success: false, error: message }, { status: message.includes("YYYY-MM-DD") ? 400 : 500 });
  }
}
