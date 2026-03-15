import { runGroupMassCheckin } from "@/lib/group-checkin-service";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { NextRequest, NextResponse } from "next/server";

export async function POST(
  request: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  try {
    const supabase = createServerSupabaseClient();
    const { id: groupId } = await context.params;
    const body = await request.json().catch(() => null);
    const rawItems = Array.isArray(body?.items) ? body.items : [];
    const strictDueIn = body?.strict_due_in !== false;

    const result = await runGroupMassCheckin({
      supabase,
      groupId,
      rawItems,
      strictDueIn,
    });

    if (!result.ok) {
      return NextResponse.json({ success: false, error: result.error }, { status: result.status });
    }

    return NextResponse.json(result.data);
  } catch (err) {
    return NextResponse.json({ success: false, error: String(err) }, { status: 500 });
  }
}
