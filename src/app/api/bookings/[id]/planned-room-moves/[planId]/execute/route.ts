import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { addDays } from "@/lib/dates";
import { findPlannedMoveEffectiveOnDate, listReservationPlannedMoves, PlannedRoomMoveError } from "@/lib/planned-room-moves";
import { executeRoomMove, RoomMoveError } from "@/lib/room-move";

async function resolveRoomNumber(supabase: any, roomId: string | null | undefined) {
  if (!roomId) return null;
  const { data, error } = await supabase
    .from("rooms")
    .select("room_number")
    .eq("id", roomId)
    .maybeSingle();
  if (error) throw new PlannedRoomMoveError(error.message ?? "Failed to resolve source room number.", 500);
  return data?.room_number ? String(data.room_number) : null;
}

const paramsSchema = z.object({
  id: z.string().uuid("Invalid reservation id."),
  planId: z.string().uuid("Invalid plan id."),
});

export async function POST(_request: NextRequest, { params }: { params: { id: string; planId: string } }) {
  try {
    const parsedParams = paramsSchema.safeParse(params);
    if (!parsedParams.success) {
      return NextResponse.json({ success: false, error: parsedParams.error.issues[0]?.message ?? "Invalid ids." }, { status: 400 });
    }

    const { id: reservationId, planId } = parsedParams.data;
    const supabase = createServerSupabaseClient();
    const today = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Bangkok" }).format(new Date());

    const move = (await listReservationPlannedMoves(supabase as any, reservationId)).find((row) => row.id === planId);
    if (!move) {
      return NextResponse.json({ success: false, error: "Planned move not found." }, { status: 404 });
    }
    if (move.status !== "planned") {
      return NextResponse.json({ success: false, error: "Only planned moves can be executed." }, { status: 400 });
    }
    if (today < move.start_date) {
      return NextResponse.json({ success: false, error: `Planned move becomes active on ${move.start_date}.` }, { status: 409 });
    }
    if (today >= move.end_date) {
      return NextResponse.json({ success: false, error: "Planned move window already passed. Cancel it and create a new move if needed." }, { status: 409 });
    }

    const effectiveToday = await findPlannedMoveEffectiveOnDate(supabase as any, reservationId, today);
    if (!effectiveToday || effectiveToday.id !== planId) {
      return NextResponse.json({ success: false, error: "Another planned move is effective today. Resolve that move first." }, { status: 409 });
    }

    const effectivePricingPolicy =
      move.pricing_policy === "reprice_grid" || move.pricing_policy === "reprice_grid_discount"
        ? move.pricing_policy
        : "keep_rtc";
    const effectiveDiscountType = move.discount_type === "fixed" ? "fixed" : "percent";
    const rawDiscountValue = Number(move.discount_value ?? 0);
    const effectiveDiscountValue = Number.isFinite(rawDiscountValue) ? rawDiscountValue : 0;
    const effectiveDiscountReason = move.discount_reason ?? null;

    const executeFrom = today > move.start_date ? today : move.start_date;
    const lateNote = today > move.start_date ? `Executed late from ${today}` : null;
    const sourceRoomNumber = await resolveRoomNumber(supabase, move.from_room_id_snapshot);

    const result = await executeRoomMove({
      supabase: supabase as any,
      reservationId,
      newRoomId: move.to_room_id,
      reason: move.move_reason,
      pricingPolicy: effectivePricingPolicy,
      discountType: effectiveDiscountType,
      discountValue: effectiveDiscountValue,
      discountReason: effectiveDiscountReason,
      startDate: executeFrom,
      endDate: addDays(move.end_date, -1),
      notePrefix: "Planned Room Move",
      noteSuffix: lateNote || null,
      auditAction: "planned_room_move_executed",
      appendNoteLine: true,
      markOldRoomDirty: true,
      sourceRoomIdOverride: move.from_room_id_snapshot,
      sourceRoomNumberOverride: sourceRoomNumber,
    });

    const { error: updateError } = await supabase
      .from("reservation_room_plans")
      .update({
        status: "executed",
        executed_at: new Date().toISOString(),
        updated_by: null,
      })
      .eq("id", planId)
      .eq("reservation_id", reservationId);
    if (updateError) {
      return NextResponse.json({ success: false, error: updateError.message }, { status: 500 });
    }

    return NextResponse.json({
      success: true,
      move_result: result,
      plan_id: planId,
      executed_from: executeFrom,
      effective_pricing_policy: effectivePricingPolicy,
    });
  } catch (error) {
    if (error instanceof PlannedRoomMoveError || error instanceof RoomMoveError) {
      return NextResponse.json({ success: false, error: error.message }, { status: error.status });
    }
    return NextResponse.json({ success: false, error: String(error) }, { status: 500 });
  }
}
