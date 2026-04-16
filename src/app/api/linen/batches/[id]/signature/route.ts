import { linenApiError, requireLinenAccess } from "@/lib/linen/api-auth";
import { uploadLinenSignature } from "@/lib/linen/signature-upload";
import { NextRequest, NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const fetchCache = "force-no-store";

export async function POST(request: NextRequest, { params }: { params: { id: string } }) {
  try {
    const { supabase } = await requireLinenAccess(request);
    const form = await request.formData();
    const type = String(form.get("type") ?? "");
    if (type !== "vendor_pickup" && type !== "fo_return") {
      return NextResponse.json({ success: false, error: "Invalid signature type." }, { status: 400 });
    }
    const file = form.get("file");
    if (!(file instanceof File)) {
      return NextResponse.json({ success: false, error: "file is required." }, { status: 400 });
    }
    const buffer = Buffer.from(await file.arrayBuffer());
    const data = await uploadLinenSignature({ supabase, batchId: params.id, type, buffer });
    return NextResponse.json({ success: true, data });
  } catch (error) {
    console.error("api/linen/batches/[id]/signature POST failed", error);
    const { status, message } = linenApiError(error, "Failed to upload signature.");
    return NextResponse.json({ success: false, error: message }, { status });
  }
}
