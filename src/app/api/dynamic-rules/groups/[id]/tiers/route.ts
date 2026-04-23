import { replaceGroupTiers, requireDynamicRulesAdminAccess } from "@/lib/dynamic-rules/service";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

export const dynamic = "force-dynamic";
export const fetchCache = "force-no-store";

const payloadSchema = z.object({
  tiers: z.array(
    z.object({
      id: z.string().uuid().optional(),
      trigger_metric: z.enum(["occ_percent", "occ_rooms_booked"]),
      trigger_threshold: z.number().finite(),
      tier_order: z.number().int().min(1),
    })
  ),
});

export async function PUT(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  const auth = await requireDynamicRulesAdminAccess(request);
  if (!auth.ok) {
    return NextResponse.json({ success: false, error: auth.error }, { status: auth.error === "Unauthorized." ? 401 : 403 });
  }

  const parsed = payloadSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ success: false, error: "Invalid payload.", details: parsed.error.flatten() }, { status: 400 });
  }

  const { id } = await context.params;
  const group = await replaceGroupTiers(auth.supabase, id, parsed.data.tiers);
  return NextResponse.json({ success: true, group });
}
