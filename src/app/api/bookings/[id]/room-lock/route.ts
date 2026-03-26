import { NextRequest, NextResponse } from "next/server";
import { clearAssignedRoomLock, AssignedRoomLockError, setAssignedRoomLock } from "@/lib/assigned-room-lock";
import { createServerSupabaseClient } from "@/lib/supabase/server";

export async function POST(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  const reservationId = params.id;
  if (!reservationId) {
    return NextResponse.json({ success: false, error: "Missing reservation id." }, { status: 400 });
  }

  try {
    const body = await request.json().catch(() => ({}));
    const enabled = Boolean(body.enabled);
    const reason = String(body.reason ?? "").trim();
    const actor = "FO";
    const supabase = createServerSupabaseClient();

    if (enabled) {
      const result = await setAssignedRoomLock({
        supabase: supabase as any,
        reservationId,
        reason,
        actor,
      });
      return NextResponse.json(result);
    }

    if (!reason) {
      return NextResponse.json(
        { success: false, error: "Unlock reason is required." },
        { status: 400 }
      );
    }

    const result = await clearAssignedRoomLock({
      supabase: supabase as any,
      reservationId,
      actor,
      reason,
      clearReason: "manual_unlock",
      appendNote: true,
    });
    return NextResponse.json(result);
  } catch (error) {
    if (error instanceof AssignedRoomLockError) {
      return NextResponse.json(
        { success: false, error: error.message, reason_code: error.code },
        { status: error.status }
      );
    }
    return NextResponse.json({ success: false, error: String(error) }, { status: 500 });
  }
}
