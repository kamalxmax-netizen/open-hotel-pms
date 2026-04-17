import { editLaundryBatchWithAudit } from "@/lib/linen/audit";
import { linenApiError, requireLinenAccess } from "@/lib/linen/api-auth";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

export const dynamic = "force-dynamic";
export const fetchCache = "force-no-store";

const bodySchema = z.object({
  changes: z.array(z.object({
    entity_type: z.enum(["batch_item", "return_item", "extra_item", "rewash_event", "rate", "note"]),
    entity_id: z.string().optional(),
    field_name: z.string().trim().min(1),
    old_value: z.string(),
    new_value: z.string(),
  })).min(1),
  reason: z.string().trim().optional().nullable(),
});

export async function PATCH(request: NextRequest, { params }: { params: { id: string } }) {
  try {
    const { supabase, actor } = await requireLinenAccess(request);
    if (!actor.isAdmin) {
      return NextResponse.json({ success: false, error: "Forbidden" }, { status: 403 });
    }

    const body = await request.json().catch(() => ({}));
    const parsed = bodySchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json({ success: false, error: "Invalid payload.", details: parsed.error.flatten() }, { status: 400 });
    }

    const data = await editLaundryBatchWithAudit(supabase, {
      batchId: params.id,
      changes: parsed.data.changes,
      reason: parsed.data.reason,
      actorUserId: actor.userId,
    });
    return NextResponse.json({ success: true, data });
  } catch (error) {
    console.error("api/linen/batches/[id]/edit PATCH failed", error);
    const { status, message } = linenApiError(error, "Failed to edit linen batch.");
    return NextResponse.json({ success: false, error: message }, { status });
  }
}
