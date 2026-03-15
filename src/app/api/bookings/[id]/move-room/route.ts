import { createServerSupabaseClient } from "@/lib/supabase/server";
import { findPlannedMoveEffectiveOnDate, listReservationPlannedMoves, normalizeDiscountType, normalizePricingPolicy, clampDiscountValue } from "@/lib/planned-room-moves";
import { executeRoomMove, RoomMoveError } from "@/lib/room-move";
import { assertAssignedRoomUnlockedOrOverride, clearAssignedRoomLock, AssignedRoomLockError } from "@/lib/assigned-room-lock";
import { NextRequest, NextResponse } from "next/server";

function toBangkokDate(date = new Date()) {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Bangkok" }).format(date);
}

/**
 * POST /api/bookings/[id]/move-room
 * Body: {
 *   new_room_id: string,
 *   reason: string,
 *   pricing_policy?: "keep_rtc" | "reprice_grid" | "reprice_grid_discount",
 *   discount_type?: "percent" | "fixed",
 *   discount_value?: number,
 *   discount_reason?: string,
 *   override_planned_note?: string,
 *   override_assigned_note?: string
 * }
 */
export async function POST(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const supabase = createServerSupabaseClient();
    const reservationId = params.id;
    const body = await request.json().catch(() => ({}));

    const newRoomId: string = body.new_room_id;
    const reason: string = String(body.reason ?? "").trim();
    const pricingPolicy = normalizePricingPolicy(body.pricing_policy);
    const discountType = normalizeDiscountType(body.discount_type);
    const discountValue = clampDiscountValue(body.discount_value);
    const discountReason = String(body.discount_reason ?? "").trim();
    const overridePlannedNote = String(body.override_planned_note ?? "").trim();
    const overrideAssignedNote = String(body.override_assigned_note ?? "").trim();

    const today = toBangkokDate();

    const effectiveTodayPlan = await findPlannedMoveEffectiveOnDate(supabase as any, reservationId, today);
    if (effectiveTodayPlan) {
      return NextResponse.json(
        { error: "Planned move already exists for today. Please execute the planned move instead.", plan_id: effectiveTodayPlan.id },
        { status: 409 }
      );
    }

    const futurePlans = (await listReservationPlannedMoves(supabase as any, reservationId)).filter(
      (row) => row.status === "planned" && row.start_date >= today
    );
    const lockedFuturePlans = futurePlans.filter((row) => row.do_not_move);
    if (futurePlans.length > 0 && !overridePlannedNote) {
      return NextResponse.json(
        {
          error: lockedFuturePlans.length > 0
            ? "Future planned room moves are locked. Provide override note to proceed."
            : "Future planned room moves exist. Provide override note before moving now.",
          planned_count: futurePlans.length,
          locked_count: lockedFuturePlans.length,
        },
        { status: 409 }
      );
    }

    const assignedLockContext = await assertAssignedRoomUnlockedOrOverride({
      supabase: supabase as any,
      reservationId,
      action: "move_room",
      overrideNote: overrideAssignedNote,
    });

    const result = await executeRoomMove({
      supabase: supabase as any,
      reservationId,
      newRoomId,
      reason,
      pricingPolicy,
      discountType,
      discountValue,
      discountReason,
      startDate: today,
      endDate: null,
      notePrefix: "Room Move",
      noteSuffix: [overridePlannedNote ? `PLANNED OVERRIDE: ${overridePlannedNote}` : null, overrideAssignedNote ? `ASSIGNED LOCK OVERRIDE: ${overrideAssignedNote}` : null]
        .filter(Boolean)
        .join(" | ") || null,
      auditAction: "room_moved",
      appendNoteLine: true,
      markOldRoomDirty: true,
    });

    if (futurePlans.length > 0) {
      await supabase
        .from("reservation_room_plans")
        .update({
          status: "cancelled",
          cancelled_at: new Date().toISOString(),
          updated_by: null,
        })
        .eq("reservation_id", reservationId)
        .eq("status", "planned")
        .gte("start_date", today);
    }

    if (assignedLockContext?.isLocked) {
      await clearAssignedRoomLock({
        supabase: supabase as any,
        reservationId,
        actor: "FO",
        reason: overrideAssignedNote,
        clearReason: "override_move",
        appendNote: true,
      });
    }

    return NextResponse.json({
      ...result,
      message: `Moved to Room ${result.to_room}`,
      cancelled_future_plans: futurePlans.length,
    });
  } catch (error) {
    if (error instanceof AssignedRoomLockError) {
      return NextResponse.json({ error: error.message, reason_code: error.code }, { status: error.status });
    }
    if (error instanceof RoomMoveError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    return NextResponse.json({ error: String(error) }, { status: 500 });
  }
}
