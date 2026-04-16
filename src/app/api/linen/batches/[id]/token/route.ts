import { getLaundryBatchDetail } from "@/lib/linen/batch-service";
import { linenApiError, requireLinenAccess } from "@/lib/linen/api-auth";
import { createVendorToken } from "@/lib/linen/vendor-token";
import { NextRequest, NextResponse } from "next/server";

export const dynamic = "force-dynamic";
export const fetchCache = "force-no-store";

export async function POST(request: NextRequest, { params }: { params: { id: string } }) {
  try {
    const { supabase } = await requireLinenAccess(request);
    const detail = await getLaundryBatchDetail(supabase, params.id);
    const origin = request.nextUrl.origin;
    const data = await createVendorToken(supabase, params.id, {
      vendorName: (detail.batch as any).vendor_name,
      baseUrl: origin,
    });
    return NextResponse.json({ success: true, data });
  } catch (error) {
    console.error("api/linen/batches/[id]/token POST failed", error);
    const { status, message } = linenApiError(error, "Failed to create vendor token.");
    return NextResponse.json({ success: false, error: message }, { status });
  }
}
