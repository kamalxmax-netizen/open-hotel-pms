import { requireMaidRead, maidAuthErrorResponse } from "@/lib/maid-auth";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { NextRequest, NextResponse } from "next/server";

export const dynamic = "force-dynamic";
export const fetchCache = "force-no-store";

export async function GET(request: NextRequest) {
  try {
    const supabase = createServerSupabaseClient();
    const selectedMaidName = request.nextUrl.searchParams.get("maid_name");
    const context = await requireMaidRead(supabase, request, selectedMaidName);

    return NextResponse.json({
      success: true,
      role: context.role,
      mode: context.mode,
      can_read: context.canRead,
      can_select_maid: context.canSelectMaid,
      can_operate_selected: context.canOperate,
      selected_maid_name: context.selectedMaidName,
      effective_maid_name: context.effectiveMaidName,
      staff_lane_name: context.staffLaneName,
      staff_nickname: context.staffNickname,
      department_code: context.departmentCode,
      user_email: context.user.email ?? null,
      reason: context.reason,
    });
  } catch (error) {
    const authResponse = maidAuthErrorResponse(error);
    if (authResponse) return authResponse;
    const message = error instanceof Error ? error.message : "Internal server error";
    return NextResponse.json({ success: false, error: message }, { status: 500 });
  }
}
