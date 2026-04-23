import { listAppliedLogRows, requireDynamicRulesReadAccess } from "@/lib/dynamic-rules/service";
import { NextRequest, NextResponse } from "next/server";

export const dynamic = "force-dynamic";
export const fetchCache = "force-no-store";

export async function GET(request: NextRequest) {
  const auth = await requireDynamicRulesReadAccess(request);
  if (!auth.ok) {
    return NextResponse.json({ success: false, error: auth.error }, { status: auth.error === "Unauthorized." ? 401 : 403 });
  }

  const rows = await listAppliedLogRows(auth.supabase, {
    hours: request.nextUrl.searchParams.get("hours") ? Number(request.nextUrl.searchParams.get("hours")) : undefined,
    limit: request.nextUrl.searchParams.get("limit") ? Number(request.nextUrl.searchParams.get("limit")) : undefined,
  });

  return NextResponse.json({ success: true, rows });
}
