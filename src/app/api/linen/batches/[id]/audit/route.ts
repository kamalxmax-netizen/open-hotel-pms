import { linenApiError, requireLinenAccess } from "@/lib/linen/api-auth";
import { NextRequest, NextResponse } from "next/server";

export const dynamic = "force-dynamic";
export const fetchCache = "force-no-store";

export async function GET(request: NextRequest, { params }: { params: { id: string } }) {
  try {
    const { supabase } = await requireLinenAccess(request);
    const { data, error } = await supabase
      .from("linen_edit_audit_log")
      .select("*")
      .eq("batch_id", params.id)
      .order("edited_at", { ascending: false });

    if (error) throw new Error(error.message);
    return NextResponse.json({ success: true, data: data ?? [] });
  } catch (error) {
    console.error("api/linen/batches/[id]/audit GET failed", error);
    const { status, message } = linenApiError(error, "Failed to load linen batch audit logs.");
    return NextResponse.json({ success: false, error: message }, { status });
  }
}
