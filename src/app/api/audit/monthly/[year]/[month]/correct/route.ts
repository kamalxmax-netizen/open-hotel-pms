import { assertAdminOrSupervisor, getAuthenticatedUser } from "@/lib/server-auth";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { applyCorrection, MonthlyAuditError } from "@/lib/monthly-audit";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

export const dynamic = "force-dynamic";

const paramsSchema = z.object({
  year: z.coerce.number().int().min(2025).max(2030),
  month: z.coerce.number().int().min(1).max(12),
});

const correctSchema = z.object({
  entry_id: z.string().uuid(),
  corrections: z.array(
    z.object({
      field_name: z.string().trim().min(1).max(100),
      new_value: z.string().max(1000),
      reason: z.string().trim().max(500).optional(),
    })
  ).min(1).max(20),
});

export async function POST(
  request: NextRequest,
  { params }: { params: { year: string; month: string } }
) {
  try {
    const supabase = createServerSupabaseClient();
    const user = await getAuthenticatedUser(supabase, request);
    if (!user) {
      return NextResponse.json({ success: false, error: "Unauthorized" }, { status: 401 });
    }
    await assertAdminOrSupervisor(supabase, user.id);

    const body = await request.json().catch(() => null);
    const parsed = correctSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { success: false, error: "Invalid payload.", details: parsed.error.flatten() },
        { status: 400 }
      );
    }

    const parsedParams = paramsSchema.safeParse(params);
    if (!parsedParams.success) {
      return NextResponse.json(
        { success: false, error: "Invalid params.", details: parsedParams.error.flatten() },
        { status: 400 }
      );
    }
    const { year, month } = parsedParams.data;

    const { data: entryScope, error: entryScopeError } = await supabase
      .from("monthly_audit_entries")
      .select("id, monthly_audit_periods!inner(year, month)")
      .eq("id", parsed.data.entry_id)
      .maybeSingle();

    if (entryScopeError) {
      return NextResponse.json({ success: false, error: entryScopeError.message }, { status: 500 });
    }
    if (!entryScope) {
      return NextResponse.json({ success: false, error: "Entry not found." }, { status: 404 });
    }

    const scopedPeriod = Array.isArray((entryScope as any).monthly_audit_periods)
      ? (entryScope as any).monthly_audit_periods[0]
      : (entryScope as any).monthly_audit_periods;
    if (Number(scopedPeriod?.year) !== year || Number(scopedPeriod?.month) !== month) {
      return NextResponse.json(
        { success: false, error: "Entry does not belong to the specified month." },
        { status: 400 }
      );
    }

    const results = [];
    for (const correction of parsed.data.corrections) {
      const result = await applyCorrection({
        supabase,
        entryId: parsed.data.entry_id,
        fieldName: correction.field_name,
        newValue: correction.new_value,
        reason: correction.reason,
        correctedByUserId: user.id,
      });
      results.push(result);
    }

    return NextResponse.json({ success: true, corrections: results });
  } catch (err) {
    if (err instanceof MonthlyAuditError) {
      return NextResponse.json({ success: false, error: err.message }, { status: err.status });
    }
    const message = err instanceof Error ? err.message : "Internal server error";
    const status = message === "Forbidden" ? 403 : 500;
    return NextResponse.json({ success: false, error: message }, { status });
  }
}
