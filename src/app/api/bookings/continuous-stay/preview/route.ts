import { NextRequest, NextResponse } from "next/server";
import {
  continuousStayBookingPayloadSchema,
  ContinuousStayPlanError,
  previewContinuousStayPlan,
} from "@/lib/continuous-stay-plan";
import { requireStaffAuth } from "@/lib/server-auth";
import { createServerSupabaseClient } from "@/lib/supabase/server";

export async function POST(request: NextRequest) {
  try {
    const supabase = createServerSupabaseClient();
    const auth = await requireStaffAuth(supabase, request);
    if (auth.error) return auth.error;

    const json = await request.json().catch(() => null);
    const parsed = continuousStayBookingPayloadSchema.safeParse(json);
    if (!parsed.success) {
      return NextResponse.json(
        { success: false, error: "Invalid payload", details: parsed.error.flatten() },
        { status: 400 }
      );
    }

    const plan = await previewContinuousStayPlan({
      supabase: supabase as any,
      payload: parsed.data,
    });

    return NextResponse.json({ success: true, ...plan });
  } catch (error) {
    if (error instanceof ContinuousStayPlanError) {
      return NextResponse.json({ success: false, error: error.message }, { status: error.status });
    }
    console.error("[continuous-stay-preview] Unhandled error:", error);
    return NextResponse.json({ success: false, error: String(error) }, { status: 500 });
  }
}
