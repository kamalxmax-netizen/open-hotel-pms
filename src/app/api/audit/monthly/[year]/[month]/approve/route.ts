import { assertAdminOrSupervisor, getAuthenticatedUser } from "@/lib/server-auth";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { approveMonth, reopenMonth, MonthlyAuditError } from "@/lib/monthly-audit";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

export const dynamic = "force-dynamic";

const paramsSchema = z.object({
  year: z.coerce.number().int().min(2025).max(2030),
  month: z.coerce.number().int().min(1).max(12),
});

const bodySchema = z.object({
  action: z.enum(["approve", "reopen"]),
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

    const parsedParams = paramsSchema.safeParse(params);
    if (!parsedParams.success) {
      return NextResponse.json(
        { success: false, error: "Invalid params.", details: parsedParams.error.flatten() },
        { status: 400 }
      );
    }

    const body = await request.json().catch(() => null);
    const parsedBody = bodySchema.safeParse(body);
    if (!parsedBody.success) {
      return NextResponse.json(
        { success: false, error: "Invalid payload.", details: parsedBody.error.flatten() },
        { status: 400 }
      );
    }

    const { year, month } = parsedParams.data;

    if (parsedBody.data.action === "approve") {
      const period = await approveMonth({
        supabase,
        year,
        month,
        auditedByUserId: user.id,
      });
      return NextResponse.json({ success: true, period });
    }

    // reopen
    await reopenMonth({
      supabase,
      year,
      month,
      userId: user.id,
    });
    return NextResponse.json({ success: true, message: "Period reopened for review." });
  } catch (err) {
    if (err instanceof MonthlyAuditError) {
      return NextResponse.json({ success: false, error: err.message }, { status: err.status });
    }
    const message = err instanceof Error ? err.message : "Internal server error";
    const status = message === "Forbidden" ? 403 : 500;
    return NextResponse.json({ success: false, error: message }, { status });
  }
}
