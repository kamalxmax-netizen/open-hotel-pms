import { createRuleGroup, listRuleGroups, requireDynamicRulesAdminAccess, requireDynamicRulesReadAccess } from "@/lib/dynamic-rules/service";
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

function buildRouteError(error: unknown) {
  const message = error instanceof Error ? error.message : "Unexpected error.";
  const normalized = message.toLowerCase();
  const schemaCacheMissing =
    normalized.includes("schema cache")
    || normalized.includes("could not find the table")
    || normalized.includes("pgrst205");

  return {
    success: false as const,
    error: message,
    hint: schemaCacheMissing
      ? "Phase 73 tables may exist in Postgres but are still missing from the Supabase REST schema cache. Run: NOTIFY pgrst, 'reload schema';"
      : undefined,
  };
}

export async function GET(request: NextRequest) {
  const auth = await requireDynamicRulesReadAccess(request);
  if (!auth.ok) {
    return NextResponse.json({ success: false, error: auth.error }, { status: auth.error === "Unauthorized." ? 401 : 403 });
  }

  try {
    const groups = await listRuleGroups(auth.supabase);
    return NextResponse.json({ success: true, groups });
  } catch (error) {
    return NextResponse.json(buildRouteError(error), { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  const auth = await requireDynamicRulesAdminAccess(request);
  if (!auth.ok) {
    return NextResponse.json({ success: false, error: auth.error }, { status: auth.error === "Unauthorized." ? 401 : 403 });
  }

  const parsed = groupSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ success: false, error: "Invalid payload.", details: parsed.error.flatten() }, { status: 400 });
  }

  try {
    const group = await createRuleGroup(auth.supabase, auth.actor.userId, parsed.data);
    return NextResponse.json({ success: true, group });
  } catch (error) {
    return NextResponse.json(buildRouteError(error), { status: 500 });
  }
}
