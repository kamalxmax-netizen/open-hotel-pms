import {
  getLostFoundErrorMessage,
  getLostFoundErrorStatus,
  listLostFoundReportRooms,
  requireLostFoundActor,
} from "@/lib/lost-found";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { NextRequest, NextResponse } from "next/server";

export const dynamic = "force-dynamic";
export const fetchCache = "force-no-store";

export async function GET(request: NextRequest) {
  try {
    const supabase = createServerSupabaseClient();
    await requireLostFoundActor(supabase, request, ["admin", "frontdesk", "maid", "supervisor"]);
    return NextResponse.json({
      success: true,
      rooms: await listLostFoundReportRooms(supabase),
    });
  } catch (error) {
    return NextResponse.json(
      { success: false, error: getLostFoundErrorMessage(error) },
      { status: getLostFoundErrorStatus(error) },
    );
  }
}
