import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import {
  PlannedRoomMoveError,
  appendReservationNoteLine,
  assertNoOverlapWithinReservation,
  assertRoomAvailableForDateRange,
  buildDoNotMoveNoteLine,
  clampDiscountValue,
  floatPlanImpactAssignments,
  listReservationPlannedMoves,
  listPlanImpactAssignments,
  normalizeDiscountType,
  normalizePricingPolicy,
  rebuildReservationFutureRoomPath,
  resolvePlannedMoveSourceSnapshotId,
  validatePlannedMoveDateRange,
} from "@/lib/planned-room-moves";
import { assertAssignedRoomUnlockedOrOverride, clearAssignedRoomLock, AssignedRoomLockError } from "@/lib/assigned-room-lock";

const paramsSchema = z.object({
  id: z.string().uuid("Invalid reservation id."),
  planId: z.string().uuid("Invalid plan id."),
});

const patchSchema = z.object({
  start_date: z.string(),
  end_date: z.string(),
  to_room_type_id: z.coerce.number().int().positive(),
  to_room_id: z.string().uuid("to_room_id must be uuid"),
  move_reason: z.string().min(1),
  pricing_policy: z.enum(["keep_rtc", "reprice_grid", "reprice_grid_discount"]).default("keep_rtc"),
  discount_type: z.enum(["percent", "fixed"]).optional(),
  discount_value: z.coerce.number().optional(),
  discount_reason: z.string().optional(),
  do_not_move: z.coerce.boolean().optional().default(false),
  do_not_move_note: z.string().optional(),
  override_note: z.string().optional(),
  override_assigned_note: z.string().optional(),
  confirm_float_conflicts: z.coerce.boolean().optional().default(false),
});

async function resolveRoomMeta(supabase: any, roomId: string) {
  const { data, error } = await supabase
    .from("rooms")
    .select("id, room_number, room_type_id, is_sellable, is_dayuse")
    .eq("id", roomId)
    .maybeSingle();
  if (error) throw new PlannedRoomMoveError(error.message ?? "Failed to load target room.", 500);
  if (!data) throw new PlannedRoomMoveError("Target room not found.", 404);
  if (!data.is_sellable || data.is_dayuse) {
    throw new PlannedRoomMoveError(`Room ${String(data.room_number)} cannot be used for planned move.`, 400);
  }
  return data;
}

export async function PATCH(request: NextRequest, { params }: { params: { id: string; planId: string } }) {
  try {
    const parsedParams = paramsSchema.safeParse(params);
    if (!parsedParams.success) {
      return NextResponse.json({ success: false, error: parsedParams.error.issues[0]?.message ?? "Invalid ids." }, { status: 400 });
    }

    const json = await request.json().catch(() => null);
    const parsedBody = patchSchema.safeParse(json);
    if (!parsedBody.success) {
      return NextResponse.json({ success: false, error: "Invalid payload.", details: parsedBody.error.flatten() }, { status: 400 });
    }

    const { id: reservationId, planId } = parsedParams.data;
    const payload = parsedBody.data;
    const supabase = createServerSupabaseClient();
    const today = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Bangkok" }).format(new Date());

    const { data: reservation, error: reservationError } = await supabase
      .from("reservations")
      .select("id, status, checkin_date, checkout_date")
      .eq("id", reservationId)
      .maybeSingle();
    if (reservationError) {
      return NextResponse.json({ success: false, error: reservationError.message }, { status: 500 });
    }
    if (!reservation) {
      return NextResponse.json({ success: false, error: "Reservation not found." }, { status: 404 });
    }

    const existingMoves = await listReservationPlannedMoves(supabase as any, reservationId);
    const targetMove = existingMoves.find((row) => row.id === planId);
    if (!targetMove) {
      return NextResponse.json({ success: false, error: "Planned move not found." }, { status: 404 });
    }
    if (targetMove.status !== "planned") {
      return NextResponse.json({ success: false, error: "Only planned moves can be edited." }, { status: 400 });
    }

    const overrideNote = String(payload.override_note ?? "").trim();
    const overrideAssignedNote = String(payload.override_assigned_note ?? "").trim();
    if (targetMove.do_not_move && !overrideNote) {
      return NextResponse.json({ success: false, error: "Locked planned move requires override note before editing." }, { status: 409 });
    }
    const assignedLockContext = await assertAssignedRoomUnlockedOrOverride({
      supabase: supabase as any,
      reservationId,
      action: "planned_move",
      overrideNote: overrideAssignedNote,
    });

    const impactedAssignments = await listPlanImpactAssignments(supabase as any, {
      planId,
      sourceRoomId: targetMove.from_room_id_snapshot ?? null,
      startDate: targetMove.start_date,
      endDate: targetMove.end_date,
      excludeReservationId: reservationId,
    });
    if (impactedAssignments.length > 0 && !payload.confirm_float_conflicts) {
      return NextResponse.json(
        {
          success: false,
          error: "Changing this planned move will float reservations that depend on its released room.",
          requires_confirmation: true,
          conflicts: impactedAssignments,
        },
        { status: 409 }
      );
    }

    validatePlannedMoveDateRange({
      startDate: payload.start_date,
      endDate: payload.end_date,
      today,
      reservationCheckinDate: String(reservation.checkin_date),
      reservationCheckoutDate: String(reservation.checkout_date),
    });
    assertNoOverlapWithinReservation(existingMoves, {
      startDate: payload.start_date,
      endDate: payload.end_date,
      excludePlanId: planId,
    });

    const targetRoom = await resolveRoomMeta(supabase, payload.to_room_id);
    if (Number(targetRoom.room_type_id ?? 0) !== payload.to_room_type_id) {
      return NextResponse.json({ success: false, error: "Selected room does not match selected room type." }, { status: 400 });
    }

    await assertRoomAvailableForDateRange(supabase as any, {
      roomId: payload.to_room_id,
      checkinDate: payload.start_date,
      checkoutDate: payload.end_date,
      excludeReservationId: reservationId,
      excludePlanId: planId,
    });

    const doNotMove = Boolean(payload.do_not_move);
    const doNotMoveNote = String(payload.do_not_move_note ?? "").trim() || null;
    const pricingPolicy = normalizePricingPolicy(payload.pricing_policy);
    const discountType = normalizeDiscountType(payload.discount_type);
    const discountValue = clampDiscountValue(payload.discount_value);
    const discountReason = String(payload.discount_reason ?? "").trim() || null;
    const earliestAffectedStart =
      payload.start_date < targetMove.start_date ? payload.start_date : targetMove.start_date;
    const rebuildSourceRoomId = await resolvePlannedMoveSourceSnapshotId(supabase as any, {
      reservationId,
      startDate: earliestAffectedStart,
      reservationCheckinDate: String(reservation.checkin_date),
    });
    const nextFromRoomIdSnapshot = await resolvePlannedMoveSourceSnapshotId(supabase as any, {
      reservationId,
      startDate: payload.start_date,
      reservationCheckinDate: String(reservation.checkin_date),
    });

    const { data: updated, error: updateError } = await supabase
      .from("reservation_room_plans")
      .update({
        start_date: payload.start_date,
        end_date: payload.end_date,
        from_room_id_snapshot: nextFromRoomIdSnapshot,
        to_room_type_id: payload.to_room_type_id,
        to_room_id: payload.to_room_id,
        move_reason: payload.move_reason.trim(),
        pricing_policy: pricingPolicy,
        discount_type: pricingPolicy === "reprice_grid_discount" ? discountType : null,
        discount_value: pricingPolicy === "reprice_grid_discount" ? discountValue : null,
        discount_reason: pricingPolicy === "reprice_grid_discount" ? discountReason : null,
        do_not_move: doNotMove,
        do_not_move_note: doNotMove ? doNotMoveNote : null,
        updated_by: null,
      })
      .eq("id", planId)
      .eq("reservation_id", reservationId)
      .select("*")
      .maybeSingle();

    if (updateError) {
      return NextResponse.json({ success: false, error: updateError.message }, { status: 500 });
    }

    if (impactedAssignments.length > 0) {
      await floatPlanImpactAssignments(supabase as any, {
        planId,
        sourceRoomId: targetMove.from_room_id_snapshot ?? null,
        startDate: targetMove.start_date,
        endDate: targetMove.end_date,
        excludeReservationId: reservationId,
        auditSource: "system",
      });
    }

    if (overrideNote) {
      const overrideLine = buildDoNotMoveNoteLine({
        action: "override",
        startDate: payload.start_date,
        endDate: payload.end_date,
        roomNumber: String(targetRoom.room_number),
        note: overrideNote,
      });
      await appendReservationNoteLine(supabase as any, reservationId, overrideLine);
    } else if (doNotMove && doNotMoveNote) {
      const noteLine = buildDoNotMoveNoteLine({
        action: "update",
        startDate: payload.start_date,
        endDate: payload.end_date,
        roomNumber: String(targetRoom.room_number),
        note: doNotMoveNote,
      });
      await appendReservationNoteLine(supabase as any, reservationId, noteLine);
    }

    if (assignedLockContext?.isLocked) {
      await clearAssignedRoomLock({
        supabase: supabase as any,
        reservationId,
        actor: "FO",
        reason: overrideAssignedNote,
        clearReason: "override_planned_move",
        appendNote: true,
      });
    }

    await rebuildReservationFutureRoomPath(supabase as any, {
      reservationId,
      startDateOverride: earliestAffectedStart,
      fallbackSourceRoomId: rebuildSourceRoomId,
    });

    return NextResponse.json({
      success: true,
      move: {
        ...updated,
        to_room_number: String(targetRoom.room_number),
      },
      floated_conflicts: impactedAssignments.length,
    });
  } catch (error) {
    if (error instanceof AssignedRoomLockError) {
      return NextResponse.json({ success: false, error: error.message, reason_code: error.code }, { status: error.status });
    }
    if (error instanceof PlannedRoomMoveError) {
      return NextResponse.json({ success: false, error: error.message }, { status: error.status });
    }
    return NextResponse.json({ success: false, error: String(error) }, { status: 500 });
  }
}
