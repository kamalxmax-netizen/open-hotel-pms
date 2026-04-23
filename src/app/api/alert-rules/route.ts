import {
  createAlertRule,
  deleteAlertRule,
  getBusinessDateContext,
  listAlertRules,
  requireAlertsAdminAccess,
  requireAlertsReadAccess,
  updateAlertRule,
} from "@/lib/alerts/service";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

export const dynamic = "force-dynamic";
export const fetchCache = "force-no-store";

const baseSchema = z.object({
  name: z.string().trim().min(1).max(120),
  is_active: z.boolean().optional(),
  trigger_mode: z.enum(["all_year", "date_range"]),
  date_start: z.string().date().nullable().optional(),
  date_end: z.string().date().nullable().optional(),
  occ_threshold: z.number().min(0).max(100),
  scope: z.enum(["all", "individual", "group"]),
});

const patchSchema = baseSchema.partial().extend({
  id: z.string().uuid(),
});

const deleteSchema = z.object({
  id: z.string().uuid(),
});

function overlapResponse(conflicts: unknown) {
  return NextResponse.json(
    { success: false, error: "Rule overlaps with existing active rule(s).", conflicts: conflicts ?? [] },
    { status: 409 }
  );
}

export async function GET(request: NextRequest) {
  const auth = await requireAlertsReadAccess(request);
  if (!auth.ok) {
    return NextResponse.json({ success: false, error: auth.error }, { status: auth.error === "Unauthorized." ? 401 : 403 });
  }

  try {
    const context = await getBusinessDateContext(auth.supabase);
    const includeArchived = ["1", "true", "yes"].includes(String(request.nextUrl.searchParams.get("include_archived") ?? "").toLowerCase());
    const rules = await listAlertRules(auth.supabase, {
      businessDate: context.businessDate,
      includeArchived,
    });
    return NextResponse.json({ success: true, rules });
  } catch (error) {
    return NextResponse.json({ success: false, error: error instanceof Error ? error.message : "Unexpected error." }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  const auth = await requireAlertsAdminAccess(request);
  if (!auth.ok) {
    return NextResponse.json({ success: false, error: auth.error }, { status: auth.error === "Unauthorized." ? 401 : 403 });
  }

  const parsed = baseSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ success: false, error: "Invalid payload.", details: parsed.error.flatten() }, { status: 400 });
  }

  try {
    const rule = await createAlertRule(auth.supabase, auth.actor.userId, {
      ...parsed.data,
      is_active: parsed.data.is_active ?? true,
      date_start: parsed.data.date_start ?? null,
      date_end: parsed.data.date_end ?? null,
    });
    return NextResponse.json({ success: true, rule }, { status: 201 });
  } catch (error) {
    if (error instanceof Error && (error as any).conflicts) {
      return overlapResponse((error as any).conflicts);
    }
    return NextResponse.json({ success: false, error: error instanceof Error ? error.message : "Unexpected error." }, { status: 400 });
  }
}

export async function PATCH(request: NextRequest) {
  const auth = await requireAlertsAdminAccess(request);
  if (!auth.ok) {
    return NextResponse.json({ success: false, error: auth.error }, { status: auth.error === "Unauthorized." ? 401 : 403 });
  }

  const parsed = patchSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ success: false, error: "Invalid payload.", details: parsed.error.flatten() }, { status: 400 });
  }

  try {
    const rule = await updateAlertRule(auth.supabase, parsed.data.id, parsed.data);
    return NextResponse.json({ success: true, rule });
  } catch (error) {
    if (error instanceof Error && (error as any).conflicts) {
      return overlapResponse((error as any).conflicts);
    }
    const message = error instanceof Error ? error.message : "Unexpected error.";
    return NextResponse.json({ success: false, error: message }, { status: message.includes("not found") ? 404 : 400 });
  }
}

export async function DELETE(request: NextRequest) {
  const auth = await requireAlertsAdminAccess(request);
  if (!auth.ok) {
    return NextResponse.json({ success: false, error: auth.error }, { status: auth.error === "Unauthorized." ? 401 : 403 });
  }

  const parsed = deleteSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ success: false, error: "Invalid payload.", details: parsed.error.flatten() }, { status: 400 });
  }

  try {
    await deleteAlertRule(auth.supabase, parsed.data.id);
    return NextResponse.json({ success: true });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unexpected error.";
    return NextResponse.json({ success: false, error: message }, { status: 400 });
  }
}
