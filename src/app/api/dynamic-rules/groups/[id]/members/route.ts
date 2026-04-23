import { replaceGroupMembers, requireDynamicRulesAdminAccess } from "@/lib/dynamic-rules/service";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

export const dynamic = "force-dynamic";
export const fetchCache = "force-no-store";

const payloadSchema = z.object({
  members: z.array(
    z.object({
      room_type_id: z.string().trim().min(1),
      action_type: z.enum(["percent", "fixed_thb", "step", "override"]),
      action_value: z.number().finite(),
      rounding: z.enum(["none", "nearest_10", "nearest_50", "nearest_100"]),
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
  const group = await replaceGroupMembers(auth.supabase, id, parsed.data.members);
  return NextResponse.json({ success: true, group });
}
