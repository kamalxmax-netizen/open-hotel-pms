import { NextRequest, NextResponse } from "next/server";
import {
  commitContinuousStayBooking,
  continuousStayBookingPayloadSchema,
  ContinuousStayPlanError,
} from "@/lib/continuous-stay-plan";
import { loadReservationSheetSyncGroups, pushToGoogleSheet } from "@/lib/google-sheet-sync";
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

    const result = await commitContinuousStayBooking({
      supabase: supabase as any,
      payload: parsed.data,
      actorUserId: auth.user?.id ?? null,
    });

    const syncApiKey = String(process.env.GOOGLE_SYNC_API_KEY ?? "").trim();
    const reservationIdForSync = String(result.reservation?.id ?? "");
    if (syncApiKey && reservationIdForSync) {
      loadReservationSheetSyncGroups({
        supabase: supabase as any,
        reservationId: reservationIdForSync,
        action: "upsert",
        includeCancelledNights: false,
      })
        .then((grouped) =>
          Promise.allSettled(
            grouped.map((group) =>
              pushToGoogleSheet({
                action: "upsert",
                room_number: group.room_number,
                dates: group.dates,
                api_key: syncApiKey,
              })
            )
          )
        )
        .catch((error) => {
          console.error("[GoogleSheetSync] continuous stay create sync failed:", error);
        });
    }

    return NextResponse.json(
      {
        success: true,
        reservation: {
          ...result.reservation,
          room_path: result.plan.segments,
          continuous_stay_total_after_discount: result.plan.totals.total,
        },
        continuous_stay_plan: result.plan,
      },
      { status: 201 }
    );
  } catch (error) {
    if (error instanceof ContinuousStayPlanError) {
      return NextResponse.json({ success: false, error: error.message }, { status: error.status });
    }
    console.error("[continuous-stay-commit] Unhandled error:", error);
    return NextResponse.json({ success: false, error: String(error) }, { status: 500 });
  }
}
