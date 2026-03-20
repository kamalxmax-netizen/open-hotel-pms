import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import {
  PlannedRoomMoveError,
  appendReservationNoteLine,
  buildDoNotMoveNoteLine,
  floatPlanImpactAssignments,
  listPlanImpactAssignments,
  listReservationPlannedMoves,
  rebuildReservationFutureRoomPath,
} from "@/lib/planned-room-moves";

const paramsSchema = z.object({
  id: z.string().uuid("Invalid reservation id."),
  planId: z.string().uuid("Invalid plan id."),
});

const bodySchema = z.object({
  override_note: z.string().optional(),
  confirm_float_conflicts: z.coerce.boolean().optional().default(false),
});

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

export async function POST(request: NextRequest, { params }: { params: { id: string; planId: string } }) {
  try {
    const parsedParams = paramsSchema.safeParse(params);
    if (!parsedParams.success) {
      return NextResponse.json({ success: false, error: parsedParams.error.issues[0]?.message ?? "Invalid ids." }, { status: 400 });
    }
    const json = await request.json().catch(() => ({}));
    const parsedBody = bodySchema.safeParse(json);
    if (!parsedBody.success) {
      return NextResponse.json({ success: false, error: "Invalid payload.", details: parsedBody.error.flatten() }, { status: 400 });
    }

    const { id: reservationId, planId } = parsedParams.data;
    const supabase = createServerSupabaseClient();
    const move = (await listReservationPlannedMoves(supabase as any, reservationId)).find((row) => row.id === planId);
    if (!move) {
      return NextResponse.json({ success: false, error: "Planned move not found." }, { status: 404 });
    }
    if (move.status !== "planned") {
      return NextResponse.json({ success: false, error: "Only planned moves can be cancelled." }, { status: 400 });
    }

    const overrideNote = String(parsedBody.data.override_note ?? "").trim();
    if (move.do_not_move && !overrideNote) {
      return NextResponse.json({ success: false, error: "Locked planned move requires override note before cancellation." }, { status: 409 });
    }

    const impactedAssignments = await listPlanImpactAssignments(supabase as any, {
      planId,
      sourceRoomId: move.from_room_id_snapshot ?? null,
      startDate: move.start_date,
      endDate: move.end_date,
      excludeReservationId: reservationId,
    });
    if (impactedAssignments.length > 0 && !parsedBody.data.confirm_float_conflicts) {
      return NextResponse.json(
        {
          success: false,
          error: "Cancelling this planned move will float reservations that depend on its released room.",
          requires_confirmation: true,
          conflicts: impactedAssignments,
        },
        { status: 409 }
      );
    }

    const { error: updateError } = await supabase
      .from("reservation_room_plans")
      .update({
        status: "cancelled",
        cancelled_at: new Date().toISOString(),
        updated_by: null,
      })
      .eq("id", planId)
      .eq("reservation_id", reservationId);
    if (updateError) {
      return NextResponse.json({ success: false, error: updateError.message }, { status: 500 });
    }

    if (move.do_not_move) {
      const roomNumber = await resolveRoomNumber(supabase, move.to_room_id);
      const noteLine = buildDoNotMoveNoteLine({
        action: overrideNote ? "override" : "cancel",
        startDate: move.start_date,
        endDate: move.end_date,
        roomNumber,
        note: overrideNote || move.do_not_move_note || "Cancelled planned move",
      });
      await appendReservationNoteLine(supabase as any, reservationId, noteLine);
    }

    if (impactedAssignments.length > 0) {
      await floatPlanImpactAssignments(supabase as any, {
        planId,
        sourceRoomId: move.from_room_id_snapshot ?? null,
        startDate: move.start_date,
        endDate: move.end_date,
        excludeReservationId: reservationId,
        auditSource: "system",
      });
    }

    await rebuildReservationFutureRoomPath(supabase as any, {
      reservationId,
      startDateOverride: move.start_date,
      fallbackSourceRoomId: move.from_room_id_snapshot ?? null,
    });

    return NextResponse.json({ success: true, floated_conflicts: impactedAssignments.length });
  } catch (error) {
    if (error instanceof PlannedRoomMoveError) {
      return NextResponse.json({ success: false, error: error.message }, { status: error.status });
    }
    return NextResponse.json({ success: false, error: String(error) }, { status: 500 });
  }
}
