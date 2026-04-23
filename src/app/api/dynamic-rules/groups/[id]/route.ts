import { deleteRuleGroup, getRuleGroup, requireDynamicRulesAdminAccess, requireDynamicRulesReadAccess, updateRuleGroup } from "@/lib/dynamic-rules/service";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

export const dynamic = "force-dynamic";
export const fetchCache = "force-no-store";

const groupSchema = z.object({
  name: z.string().trim().min(1).max(120),
  priority: z.number().int().min(0).max(9999).optional(),
  trigger_scope: z.enum(["hotel_wide", "group_aggregate", "per_room_type"]),
  mode: z.enum(["suggest_only", "auto_apply"]),
  is_active: z.boolean().optional(),
  effective_from: z.string().date().optional().nullable(),
  effective_to: z.string().date().optional().nullable(),
  applies_to_dow: z.array(z.number().int().min(0).max(6)).optional().nullable(),
});

export async function GET(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  const auth = await requireDynamicRulesReadAccess(request);
  if (!auth.ok) {
    return NextResponse.json({ success: false, error: auth.error }, { status: auth.error === "Unauthorized." ? 401 : 403 });
  }

  const { id } = await context.params;
  const group = await getRuleGroup(auth.supabase, id);
  if (!group) {
    return NextResponse.json({ success: false, error: "Group not found." }, { status: 404 });
  }

  return NextResponse.json({ success: true, group });
}

export async function PUT(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  const auth = await requireDynamicRulesAdminAccess(request);
  if (!auth.ok) {
    return NextResponse.json({ success: false, error: auth.error }, { status: auth.error === "Unauthorized." ? 401 : 403 });
  }

  const parsed = groupSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ success: false, error: "Invalid payload.", details: parsed.error.flatten() }, { status: 400 });
  }

  const { id } = await context.params;
  const group = await updateRuleGroup(auth.supabase, id, parsed.data);
  if (!group) {
    return NextResponse.json({ success: false, error: "Group not found." }, { status: 404 });
  }
  return NextResponse.json({ success: true, group });
}

export async function DELETE(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  const auth = await requireDynamicRulesAdminAccess(request);
  if (!auth.ok) {
    return NextResponse.json({ success: false, error: auth.error }, { status: auth.error === "Unauthorized." ? 401 : 403 });
  }

  const { id } = await context.params;
  await deleteRuleGroup(auth.supabase, id);
  return NextResponse.json({ success: true });
}
