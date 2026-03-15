import { NextResponse } from "next/server";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { executeWholeStayRoomSwap, RoomSwapError } from "@/lib/room-swap";
import { assertAssignedRoomUnlockedOrOverride, clearAssignedRoomLock, AssignedRoomLockError } from "@/lib/assigned-room-lock";

export async function POST(
  request: Request,
  { params }: { params: { id: string } }
) {
  const sourceReservationId = params.id;
  if (!sourceReservationId) {
    return NextResponse.json({ error: "Missing reservation id." }, { status: 400 });
  }

  try {
    const body = await request.json().catch(() => null);
    const targetReservationId = typeof body?.target_reservation_id === "string" ? body.target_reservation_id : "";
    const overrideAssignedNote = String(body?.override_assigned_note ?? "").trim();

    if (!targetReservationId) {
      return NextResponse.json({ error: "Missing target_reservation_id." }, { status: 400 });
    }

    const supabase = createServerSupabaseClient();
    const sourceLockContext = await assertAssignedRoomUnlockedOrOverride({
      supabase: supabase as any,
      reservationId: sourceReservationId,
      action: "swap_room",
      overrideNote: overrideAssignedNote,
    });
    const targetLockContext = await assertAssignedRoomUnlockedOrOverride({
      supabase: supabase as any,
      reservationId: targetReservationId,
      action: "swap_room",
      overrideNote: overrideAssignedNote,
    });
    const result = await executeWholeStayRoomSwap(supabase as any, sourceReservationId, targetReservationId);

    if (sourceLockContext?.isLocked) {
      await clearAssignedRoomLock({
        supabase: supabase as any,
        reservationId: sourceReservationId,
        actor: "FO",
        reason: overrideAssignedNote,
        clearReason: "override_swap",
        appendNote: true,
      });
    }
    if (targetLockContext?.isLocked) {
      await clearAssignedRoomLock({
        supabase: supabase as any,
        reservationId: targetReservationId,
        actor: "FO",
        reason: overrideAssignedNote,
        clearReason: "override_swap",
        appendNote: true,
      });
    }

    return NextResponse.json(result);
  } catch (error) {
    if (error instanceof AssignedRoomLockError) {
      return NextResponse.json(
        {
          error: error.message,
          reason_code: error.code,
        },
        { status: error.status }
      );
    }
    if (error instanceof RoomSwapError) {
      return NextResponse.json(
        {
          error: error.message,
          reason_code: error.reasonCode,
        },
        { status: error.status }
      );
    }
    return NextResponse.json({ error: String(error) }, { status: 500 });
  }
}
