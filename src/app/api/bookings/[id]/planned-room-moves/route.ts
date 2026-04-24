import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { requireStaffAuth } from "@/lib/server-auth";
import {
  PlannedRoomMoveError,
  appendReservationNoteLine,
  assertNoOverlapWithinReservation,
  assertRoomAvailableForDateRange,
  buildDoNotMoveNoteLine,
  clampDiscountValue,
  listReservationPlannedMoves,
  normalizeDiscountType,
  normalizePricingPolicy,
  projectReservationPlannedMovePricing,
  rebuildReservationFutureRoomPath,
  resolvePlannedMoveSourceSnapshotId,
  validatePlannedMoveDateRange,
} from "@/lib/planned-room-moves";
import { assertAssignedRoomUnlockedOrOverride, clearAssignedRoomLock, AssignedRoomLockError } from "@/lib/assigned-room-lock";
import { normalizeAuditSource } from "@/lib/audit-utils";
import { resolveBusinessDate, toLocalDate } from "@/lib/folio-fees";

const paramsSchema = z.object({
  id: z.string().uuid("Invalid reservation id."),
});

const planSchema = z.object({
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
  override_assigned_note: z.string().optional(),
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

async function resolveRoomNumber(supabase: any, roomId: string | null | undefined) {
  if (!roomId) return "unknown";
  const { data, error } = await supabase
    .from("rooms")
    .select("room_number")
    .eq("id", roomId)
    .maybeSingle();
  if (error) throw new PlannedRoomMoveError(error.message ?? "Failed to load room number.", 500);
  return String(data?.room_number ?? "unknown");
}

function formatPricingPolicyLabel(params: {
  pricingPolicy: "keep_rtc" | "reprice_grid" | "reprice_grid_discount";
  discountType: "percent" | "fixed";
  discountValue: number;
  discountReason: string | null;
}) {
  const { pricingPolicy, discountType, discountValue, discountReason } = params;
  if (pricingPolicy === "keep_rtc") return "POLICY: Keep RTC";
  if (pricingPolicy === "reprice_grid") return "POLICY: Reprice Grid";
  return `POLICY: Reprice Grid + Discount (${discountType}:${discountValue})${discountReason ? ` [${discountReason}]` : ""}`;
}

export async function GET(request: NextRequest, { params }: { params: { id: string } }) {
  try {
    const parsed = paramsSchema.safeParse(params);
    if (!parsed.success) {
      return NextResponse.json({ success: false, error: parsed.error.issues[0]?.message ?? "Invalid reservation id." }, { status: 400 });
    }

    const supabase = createServerSupabaseClient();
    const auth = await requireStaffAuth(supabase, request);
    if (auth.error) return auth.error;
    const reservationId = parsed.data.id;
    const moves = await listReservationPlannedMoves(supabase as any, reservationId);

    const roomIds = Array.from(
      new Set(
        moves
          .flatMap((row) => [row.to_room_id, row.from_room_id_snapshot])
          .filter(Boolean)
      )
    );
    const roomMap = new Map<string, { room_number: string; room_type_id: number }>();
    if (roomIds.length > 0) {
      const { data: rooms, error: roomsError } = await supabase
        .from("rooms")
        .select("id, room_number, room_type_id")
        .in("id", roomIds);
      if (roomsError) {
        return NextResponse.json({ success: false, error: roomsError.message }, { status: 500 });
      }
      for (const row of rooms ?? []) {
        roomMap.set(String(row.id), {
          room_number: String(row.room_number),
          room_type_id: Number(row.room_type_id ?? 0),
        });
      }
    }

    return NextResponse.json({
      success: true,
      moves: moves.map((row) => ({
        ...row,
        from_room_number: row.from_room_id_snapshot ? roomMap.get(String(row.from_room_id_snapshot))?.room_number ?? null : null,
        to_room_number: roomMap.get(String(row.to_room_id))?.room_number ?? null,
      })),
    });
  } catch (error) {
    if (error instanceof PlannedRoomMoveError) {
      return NextResponse.json({ success: false, error: error.message }, { status: error.status });
    }
    return NextResponse.json({ success: false, error: String(error) }, { status: 500 });
  }
}

export async function POST(request: NextRequest, { params }: { params: { id: string } }) {
  try {
    const parsedParams = paramsSchema.safeParse(params);
    if (!parsedParams.success) {
      return NextResponse.json({ success: false, error: parsedParams.error.issues[0]?.message ?? "Invalid reservation id." }, { status: 400 });
    }
    const json = await request.json().catch(() => null);
    const parsedBody = planSchema.safeParse(json);
    if (!parsedBody.success) {
      return NextResponse.json({ success: false, error: "Invalid payload.", details: parsedBody.error.flatten() }, { status: 400 });
    }

    const reservationId = parsedParams.data.id;
    const supabase = createServerSupabaseClient();
    const today = await resolveBusinessDate(supabase as any, toLocalDate(new Date(), "Asia/Bangkok"));

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
    if (reservation.status !== "active") {
      return NextResponse.json({ success: false, error: "Only active reservations can be planned for room moves." }, { status: 400 });
    }

    const payload = parsedBody.data;
    validatePlannedMoveDateRange({
      startDate: payload.start_date,
      endDate: payload.end_date,
      today,
      reservationCheckinDate: String(reservation.checkin_date),
      reservationCheckoutDate: String(reservation.checkout_date),
    });

    const existingPlans = await listReservationPlannedMoves(supabase as any, reservationId);
    assertNoOverlapWithinReservation(existingPlans, {
      startDate: payload.start_date,
      endDate: payload.end_date,
    });

    const overrideAssignedNote = String(payload.override_assigned_note ?? "").trim();
    const assignedLockContext = await assertAssignedRoomUnlockedOrOverride({
      supabase: supabase as any,
      reservationId,
      action: "planned_move",
      overrideNote: overrideAssignedNote,
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
    });

    const doNotMove = Boolean(payload.do_not_move);
    const doNotMoveNote = String(payload.do_not_move_note ?? "").trim() || null;
    const discountValue = clampDiscountValue(payload.discount_value);
    const discountType = normalizeDiscountType(payload.discount_type);
    const pricingPolicy = normalizePricingPolicy(payload.pricing_policy);
    const discountReason = String(payload.discount_reason ?? "").trim() || null;
    const fromRoomIdSnapshot = await resolvePlannedMoveSourceSnapshotId(supabase as any, {
      reservationId,
      startDate: payload.start_date,
      reservationCheckinDate: String(reservation.checkin_date),
    });

    const { data: inserted, error: insertError } = await supabase
      .from("reservation_room_plans")
      .insert({
        reservation_id: reservationId,
        start_date: payload.start_date,
        end_date: payload.end_date,
        from_room_id_snapshot: fromRoomIdSnapshot,
        to_room_type_id: payload.to_room_type_id,
        to_room_id: payload.to_room_id,
        move_reason: payload.move_reason.trim(),
        pricing_policy: pricingPolicy,
        discount_type: pricingPolicy === "reprice_grid_discount" ? discountType : null,
        discount_value: pricingPolicy === "reprice_grid_discount" ? discountValue : null,
        discount_reason: pricingPolicy === "reprice_grid_discount" ? discountReason : null,
        do_not_move: doNotMove,
        do_not_move_note: doNotMove ? doNotMoveNote : null,
        status: "planned",
        created_by: null,
        updated_by: null,
      })
      .select("*")
      .maybeSingle();

    if (insertError) {
      return NextResponse.json({ success: false, error: insertError.message }, { status: 500 });
    }

    const sourceRoomNumber = await resolveRoomNumber(supabase, fromRoomIdSnapshot);
    const planCreatedNote =
      `[PLANNED MOVE CREATE ${today}] ${sourceRoomNumber} -> ${String(targetRoom.room_number)} | ` +
      `DATES: ${payload.start_date} -> ${payload.end_date} | ` +
      `REASON: ${payload.move_reason.trim()} | ` +
      `${formatPricingPolicyLabel({
        pricingPolicy,
        discountType,
        discountValue,
        discountReason,
      })}`;
    await appendReservationNoteLine(supabase as any, reservationId, planCreatedNote);

    if (doNotMove && doNotMoveNote) {
      const noteLine = buildDoNotMoveNoteLine({
        action: "create",
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

    await rebuildReservationFutureRoomPath(supabase as any, { reservationId });
    await projectReservationPlannedMovePricing(supabase as any, {
      reservationId,
      startDateOverride: payload.start_date,
    });

    await supabase.from("audit_logs").insert({
      action: "planned_room_move_created",
      entity_type: "reservation",
      entity_id: reservationId,
      before_json: null,
      after_json: {
        plan_id: inserted?.id ?? null,
        start_date: payload.start_date,
        end_date: payload.end_date,
        to_room_id: payload.to_room_id,
        to_room_number: String(targetRoom.room_number),
        pricing_policy: pricingPolicy,
        do_not_move: doNotMove,
      },
      business_date: today,
      source: normalizeAuditSource("manual"),
    });

    return NextResponse.json({
      success: true,
      move: {
        ...inserted,
        to_room_number: String(targetRoom.room_number),
      },
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
