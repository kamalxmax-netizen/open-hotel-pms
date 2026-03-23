import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import {
  PlannedRoomMoveError,
  appendReservationNoteLine,
  assertNoOverlapWithinReservation,
  assertRoomAvailableForDateRange,
  listReservationPlannedMoves,
  normalizePricingPolicy,
  rebuildReservationFutureRoomPath,
  resolvePlannedMoveSourceSnapshotId,
  projectReservationPlannedMovePricing,
  validatePlannedMoveDateRange,
} from "@/lib/planned-room-moves";
import { normalizeAuditSource } from "@/lib/audit-utils";

const paramsSchema = z.object({
  id: z.string().uuid("Invalid reservation id."),
});

const moveItemSchema = z.object({
  start_date: z.string(),
  end_date: z.string(),
  to_room_type_id: z.coerce.number().int().positive(),
  to_room_id: z.string().uuid("to_room_id must be uuid"),
  move_reason: z.string().min(1),
  pricing_policy: z.enum(["keep_rtc", "reprice_grid", "reprice_grid_discount"]).default("keep_rtc"),
});

const batchSchema = z.object({
  moves: z.array(moveItemSchema).min(1).max(30),
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

/**
 * POST /api/bookings/[id]/planned-room-moves/batch
 *
 * Creates multiple planned room moves for a reservation in one request.
 * All plans are inserted first, then rebuildReservationFutureRoomPath
 * is called ONCE at the end to avoid path corruption.
 */
export async function POST(request: NextRequest, { params }: { params: { id: string } }) {
  try {
    const parsedParams = paramsSchema.safeParse(params);
    if (!parsedParams.success) {
      return NextResponse.json({ success: false, error: parsedParams.error.issues[0]?.message ?? "Invalid reservation id." }, { status: 400 });
    }

    const json = await request.json().catch(() => null);
    const parsedBody = batchSchema.safeParse(json);
    if (!parsedBody.success) {
      return NextResponse.json({ success: false, error: "Invalid payload.", details: parsedBody.error.flatten() }, { status: 400 });
    }

    const reservationId = parsedParams.data.id;
    const supabase = createServerSupabaseClient();
    const today = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Bangkok" }).format(new Date());

    // Load reservation
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

    // Sort moves by start_date to process in order
    const moves = [...parsedBody.data.moves].sort((a, b) => a.start_date.localeCompare(b.start_date));

    // Validate all moves first (before inserting any)
    let existingPlans = await listReservationPlannedMoves(supabase as any, reservationId);
    const insertedIds: string[] = [];
    let earliestStartDate: string | null = null;

    for (const move of moves) {
      // Validate date range
      validatePlannedMoveDateRange({
        startDate: move.start_date,
        endDate: move.end_date,
        today,
        reservationCheckinDate: String(reservation.checkin_date),
        reservationCheckoutDate: String(reservation.checkout_date),
      });

      // Check overlap with existing + previously inserted plans
      assertNoOverlapWithinReservation(existingPlans, {
        startDate: move.start_date,
        endDate: move.end_date,
      });

      // Validate target room
      const targetRoom = await resolveRoomMeta(supabase, move.to_room_id);
      if (Number(targetRoom.room_type_id ?? 0) !== move.to_room_type_id) {
        return NextResponse.json({ success: false, error: `Room ${String(targetRoom.room_number)} does not match room type.` }, { status: 400 });
      }

      // Check room availability
      await assertRoomAvailableForDateRange(supabase as any, {
        roomId: move.to_room_id,
        checkinDate: move.start_date,
        checkoutDate: move.end_date,
        excludeReservationId: reservationId,
      });

      // Resolve source room
      const fromRoomIdSnapshot = await resolvePlannedMoveSourceSnapshotId(supabase as any, {
        reservationId,
        startDate: move.start_date,
        reservationCheckinDate: String(reservation.checkin_date),
      });

      const pricingPolicy = normalizePricingPolicy(move.pricing_policy);

      // Insert the plan (WITHOUT rebuilding path yet)
      const { data: inserted, error: insertError } = await supabase
        .from("reservation_room_plans")
        .insert({
          reservation_id: reservationId,
          start_date: move.start_date,
          end_date: move.end_date,
          from_room_id_snapshot: fromRoomIdSnapshot,
          to_room_type_id: move.to_room_type_id,
          to_room_id: move.to_room_id,
          move_reason: move.move_reason.trim(),
          pricing_policy: pricingPolicy,
          discount_type: null,
          discount_value: null,
          discount_reason: null,
          do_not_move: false,
          do_not_move_note: null,
          status: "planned",
          created_by: null,
          updated_by: null,
        })
        .select("id")
        .maybeSingle();

      if (insertError) {
        return NextResponse.json({ success: false, error: insertError.message }, { status: 500 });
      }
      if (inserted) insertedIds.push(inserted.id);

      // Track earliest start for rebuild
      if (!earliestStartDate || move.start_date < earliestStartDate) {
        earliestStartDate = move.start_date;
      }

      // Add to existing plans list for overlap check of next move
      existingPlans = [...existingPlans, {
        id: inserted?.id ?? "",
        reservation_id: reservationId,
        start_date: move.start_date,
        end_date: move.end_date,
        from_room_id_snapshot: fromRoomIdSnapshot,
        to_room_id: move.to_room_id,
        to_room_type_id: move.to_room_type_id,
        move_reason: move.move_reason,
        pricing_policy: pricingPolicy,
        discount_type: null,
        discount_value: null,
        discount_reason: null,
        do_not_move: false,
        do_not_move_note: null,
        status: "planned" as const,
        executed_at: null,
        cancelled_at: null,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      }];

      // Append note
      const planCreatedNote = `[PLANNED MOVE CREATE ${today}] per-night-plan | DATES: ${move.start_date} -> ${move.end_date} | POLICY: Keep RTC`;
      await appendReservationNoteLine(supabase as any, reservationId, planCreatedNote);
    }

    // ─── REBUILD ONCE ───
    // After ALL plans are inserted, rebuild the room path once
    if (earliestStartDate) {
      await rebuildReservationFutureRoomPath(supabase as any, {
        reservationId,
        startDateOverride: earliestStartDate,
      });
      await projectReservationPlannedMovePricing(supabase as any, {
        reservationId,
        startDateOverride: earliestStartDate,
      });
    }

    // Audit log
    await supabase.from("audit_logs").insert({
      action: "planned_room_moves_batch_created",
      entity_type: "reservation",
      entity_id: reservationId,
      before_json: null,
      after_json: {
        plan_ids: insertedIds,
        moves_count: moves.length,
        earliest_start: earliestStartDate,
      },
      business_date: today,
      source: normalizeAuditSource("manual"),
    });

    return NextResponse.json({
      success: true,
      created: insertedIds.length,
      plan_ids: insertedIds,
    });
  } catch (error) {
    if (error instanceof PlannedRoomMoveError) {
      return NextResponse.json({ success: false, error: error.message }, { status: error.status });
    }
    console.error("[batch planned-room-moves] Unhandled error:", error);
    return NextResponse.json({ success: false, error: String(error) }, { status: 500 });
  }
}
