import { NextResponse } from "next/server";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { executeWholeStayRoomSwap, loadReservationSwapContext, RoomSwapError } from "@/lib/room-swap";
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
    const sourceSwapContext = await loadReservationSwapContext(supabase as any, sourceReservationId);
    const targetSwapContext = await loadReservationSwapContext(supabase as any, targetReservationId);
    const sourceMemberIds = sourceSwapContext?.member_reservation_ids ?? [sourceReservationId];
    const targetMemberIds = targetSwapContext?.member_reservation_ids ?? [targetReservationId];
    const reservationIdsToCheck = Array.from(new Set([...sourceMemberIds, ...targetMemberIds]));

    const lockContexts = [];
    for (const reservationId of reservationIdsToCheck) {
      const lockContext = await assertAssignedRoomUnlockedOrOverride({
        supabase: supabase as any,
        reservationId,
        action: "swap_room",
        overrideNote: overrideAssignedNote,
      });
      lockContexts.push({ reservationId, lockContext });
    }

    const result = await executeWholeStayRoomSwap(supabase as any, sourceReservationId, targetReservationId);

    for (const { reservationId, lockContext } of lockContexts) {
      if (!lockContext?.isLocked) continue;
      await clearAssignedRoomLock({
        supabase: supabase as any,
        reservationId,
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
