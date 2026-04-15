import { createServerSupabaseClient } from "@/lib/supabase/server";
import { assertAdminOrSupervisor, getAuthenticatedUser } from "@/lib/server-auth";
import { computeStockSnapshot, isBusinessDate } from "@/lib/stock-snapshot";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

export const dynamic = "force-dynamic";
export const fetchCache = "force-no-store";

const bodySchema = z.object({
  note: z.string().trim().min(1, "note is required").max(500),
});

export async function POST(
  request: NextRequest,
  { params }: { params: { date: string } }
) {
  try {
    if (!isBusinessDate(params.date)) {
      return NextResponse.json({ success: false, error: "Invalid business date." }, { status: 400 });
    }

    const parsed = bodySchema.safeParse(await request.json().catch(() => ({})));
    if (!parsed.success) {
      return NextResponse.json(
        { success: false, error: "Invalid payload.", details: parsed.error.flatten() },
        { status: 400 }
      );
    }

    const supabase = createServerSupabaseClient();
    const user = await getAuthenticatedUser(supabase, request);
    if (!user) return NextResponse.json({ success: false, error: "Unauthorized" }, { status: 401 });
    await assertAdminOrSupervisor(supabase, user.id);

    const result = await computeStockSnapshot(supabase, params.date);
    await supabase.from("audit_logs").insert({
      actor_user_id: user.id,
      action: "stock_snapshot_recompute",
      entity_type: "stock_daily_snapshots",
      entity_id: null,
      after_json: { business_date: params.date, note: parsed.data.note, result },
      change_reason: parsed.data.note,
      business_date: params.date,
    });

    return NextResponse.json({
      success: true,
      business_date: params.date,
      products_computed: Number((result as any)?.products_computed ?? 0),
      variance_count: Number((result as any)?.variance_count ?? 0),
      changed_from_previous: true,
    });
  } catch (err) {
    console.error("inventory/snapshots/[date]/recompute POST failed", err);
    const message = err instanceof Error ? err.message : "Internal server error";
    const status = message === "Forbidden" ? 403 : 500;
    return NextResponse.json({ success: false, error: message }, { status });
  }
}
