import { linenApiError, requireLinenAccess } from "@/lib/linen/api-auth";
import { NextRequest, NextResponse } from "next/server";

export const dynamic = "force-dynamic";
export const fetchCache = "force-no-store";

export async function GET(request: NextRequest) {
  try {
    const { supabase } = await requireLinenAccess(request);
    const limit = Math.min(20, Math.max(1, Number(request.nextUrl.searchParams.get("limit") ?? 10)));

    const { data, error } = await supabase
      .from("linen_edit_audit_log")
      .select("*")
      .order("edited_at", { ascending: false })
      .limit(limit);

    if (error) {
      if (error.code === "42P01") {
        return NextResponse.json({ success: true, data: [] });
      }
      throw new Error(error.message);
    }

    return NextResponse.json({ success: true, data: data ?? [] });
  } catch (error) {
    console.error("api/linen/edits/recent GET failed", error);
    const { status, message } = linenApiError(error, "Failed to load recent linen edits.");
    return NextResponse.json({ success: false, error: message }, { status });
  }
}
