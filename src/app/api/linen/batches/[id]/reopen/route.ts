import { reopenLaundryBatch } from "@/lib/linen/batch-service";
import { linenApiError, requireLinenAccess } from "@/lib/linen/api-auth";
import { NextRequest, NextResponse } from "next/server";

export const dynamic = "force-dynamic";
export const fetchCache = "force-no-store";

export async function POST(request: NextRequest, { params }: { params: { id: string } }) {
  try {
    const { supabase, actor } = await requireLinenAccess(request);
    if (!actor.isAdmin) return NextResponse.json({ success: false, error: "Forbidden" }, { status: 403 });
    const data = await reopenLaundryBatch(supabase, params.id, actor.name);
    return NextResponse.json({ success: true, data });
  } catch (error) {
    console.error("api/linen/batches/[id]/reopen POST failed", error);
    const { status, message } = linenApiError(error, "Failed to reopen linen batch.");
    return NextResponse.json({ success: false, error: message }, { status });
  }
}
