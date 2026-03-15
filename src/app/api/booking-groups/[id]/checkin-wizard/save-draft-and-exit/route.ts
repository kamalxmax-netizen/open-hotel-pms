import {
  ensureWizardStep,
  mergeDraftJson,
  pickBusinessDate,
} from "@/lib/group-checkin-wizard";
import {
  getBusinessDate,
  getWizardDraft,
  upsertWizardDraft,
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

    const currentDraft = await getWizardDraft(supabase, groupId, businessDate);
    const patchDraftJson =
      body?.draft_json && typeof body.draft_json === "object"
        ? (body.draft_json as Record<string, unknown>)
        : body?.patch && typeof body.patch === "object"
          ? (body.patch as Record<string, unknown>)
          : {};

    const mergedDraftJson = mergeDraftJson(
      (currentDraft?.draft_json as Record<string, unknown>) ?? {},
      patchDraftJson
    );

    const draft = await upsertWizardDraft({
      supabase,
      groupId,
      businessDate,
      status: "draft",
      currentStep: ensureWizardStep(body?.current_step, currentDraft?.current_step ?? 1),
      draftJson: mergedDraftJson,
      touchCommittedAt: true,
    });

    return NextResponse.json({
      success: true,
      draft,
      redirect_to: `/pms/bookings/groups/${groupId}`,
    });
  } catch (err) {
    return NextResponse.json(
      { success: false, error: err instanceof Error ? err.message : "Internal server error" },
      { status: 500 }
    );
  }
}
