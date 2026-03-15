import { pickBusinessDate } from "@/lib/group-checkin-wizard";
import {
  getBusinessDate,
  getWizardDraft,
} from "@/lib/group-checkin-wizard-service";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { NextRequest, NextResponse } from "next/server";

export async function POST(
  request: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  try {
    const supabase = createServerSupabaseClient();
    const { id: groupId } = await context.params;

    if (!groupId) {
      return NextResponse.json({ success: false, error: "Missing group ID." }, { status: 400 });
    }

    const body = await request.json().catch(() => ({}));
    const fallbackBusinessDate = await getBusinessDate(supabase, null);
    const businessDate = pickBusinessDate(body?.business_date, fallbackBusinessDate);

    const existing = await getWizardDraft(supabase, groupId, businessDate);
    if (!existing || existing.status !== "draft") {
      return NextResponse.json({ success: false, error: "Draft not found." }, { status: 404 });
    }

    const { data, error } = await supabase
      .from("group_checkin_wizard_drafts")
      .update({
        status: "cancelled",
        last_committed_at: new Date().toISOString(),
      })
      .eq("id", existing.id)
      .select("id, booking_group_id, business_date, status, current_step, draft_json, last_committed_at, created_at, updated_at")
      .maybeSingle();

    if (error) {
      return NextResponse.json({ success: false, error: error.message }, { status: 500 });
    }

    return NextResponse.json({
      success: true,
      cancelled_draft_id: existing.id,
      draft: data,
    });
  } catch (err) {
    return NextResponse.json(
      { success: false, error: err instanceof Error ? err.message : "Internal server error" },
      { status: 500 }
    );
  }
}
