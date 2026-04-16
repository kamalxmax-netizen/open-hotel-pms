import { getLaundryBatchDetail } from "@/lib/linen/batch-service";
import { linenApiError, requireLinenAccess } from "@/lib/linen/api-auth";
import { NextRequest, NextResponse } from "next/server";

export const dynamic = "force-dynamic";
export const fetchCache = "force-no-store";

export async function GET(request: NextRequest, { params }: { params: { id: string } }) {
  try {
    const { supabase } = await requireLinenAccess(request);
    const data = await getLaundryBatchDetail(supabase, params.id);
    return NextResponse.json({ success: true, data });
  } catch (error) {
    console.error("api/linen/batches/[id] GET failed", error);
    const { status, message } = linenApiError(error, "Failed to load linen batch.");
    return NextResponse.json({ success: false, error: message }, { status });
  }
}

export async function PATCH(request: NextRequest, { params }: { params: { id: string } }) {
  try {
    const { supabase } = await requireLinenAccess(request);
    const body = await request.json().catch(() => ({}));
    const allowed: Record<string, unknown> = {};
    if (typeof body.vendor_name === "string" || body.vendor_name === null) allowed.vendor_name = body.vendor_name;
    if (typeof body.notes === "string" || body.notes === null) allowed.notes = body.notes;
    if (Object.keys(allowed).length === 0) {
      return NextResponse.json({ success: false, error: "No supported fields to update." }, { status: 400 });
    }
    const { error } = await supabase.from("laundry_batches").update(allowed).eq("id", params.id);
    if (error) throw new Error(error.message);
    const data = await getLaundryBatchDetail(supabase, params.id);
    return NextResponse.json({ success: true, data });
  } catch (error) {
    console.error("api/linen/batches/[id] PATCH failed", error);
    const { status, message } = linenApiError(error, "Failed to update linen batch.");
    return NextResponse.json({ success: false, error: message }, { status });
  }
}
