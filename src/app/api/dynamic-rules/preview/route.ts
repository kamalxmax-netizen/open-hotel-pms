import { bulkActionPreviewRows, listPreviewRows, requireDynamicRulesReadAccess } from "@/lib/dynamic-rules/service";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

export const dynamic = "force-dynamic";
export const fetchCache = "force-no-store";

const actionSchema = z.object({
  preview_ids: z.array(z.string().uuid()).min(1),
  action: z.enum(["approve", "reject"]),
  reject_reason: z.string().trim().max(1000).optional(),
});

export async function GET(request: NextRequest) {
  const auth = await requireDynamicRulesReadAccess(request);
  if (!auth.ok) {
    return NextResponse.json({ success: false, error: auth.error }, { status: auth.error === "Unauthorized." ? 401 : 403 });
  }

  const filters = {
    status: request.nextUrl.searchParams.get("status") ?? undefined,
    fromDate: request.nextUrl.searchParams.get("from_date") ?? undefined,
    toDate: request.nextUrl.searchParams.get("to_date") ?? undefined,
    roomTypeId: request.nextUrl.searchParams.get("room_type_id") ?? undefined,
    groupId: request.nextUrl.searchParams.get("group_id") ?? undefined,
    direction: request.nextUrl.searchParams.get("direction") ?? undefined,
    includeAllEvaluations: ["1", "true", "yes"].includes(String(request.nextUrl.searchParams.get("include_all_evaluations") ?? "").toLowerCase()),
    limit: request.nextUrl.searchParams.get("limit") ? Number(request.nextUrl.searchParams.get("limit")) : undefined,
  };

  const result = await listPreviewRows(auth.supabase, filters);
  return NextResponse.json({ success: true, rows: result.rows, summary: result.summary });
}

export async function POST(request: NextRequest) {
  const auth = await requireDynamicRulesReadAccess(request);
  if (!auth.ok) {
    return NextResponse.json({ success: false, error: auth.error }, { status: auth.error === "Unauthorized." ? 401 : 403 });
  }

  const parsed = actionSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ success: false, error: "Invalid payload.", details: parsed.error.flatten() }, { status: 400 });
  }

  const result = await bulkActionPreviewRows(auth.supabase, auth.actor.userId, parsed.data);
  return NextResponse.json(result, { status: result.success ? 200 : 400 });
}
