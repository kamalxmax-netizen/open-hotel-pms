import {
  getLostFoundErrorMessage,
  getLostFoundErrorStatus,
  getLostFoundGuestAlert,
  requireLostFoundActor,
} from "@/lib/lost-found";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

export const dynamic = "force-dynamic";
export const fetchCache = "force-no-store";

const querySchema = z.object({
  guest_profile_id: z.string().uuid("guest_profile_id is required"),
});

export async function GET(request: NextRequest) {
  try {
    const parsed = querySchema.safeParse({
      guest_profile_id: request.nextUrl.searchParams.get("guest_profile_id") ?? undefined,
    });

    if (!parsed.success) {
      return NextResponse.json(
        { success: false, error: parsed.error.issues[0]?.message ?? "Invalid guest_profile_id." },
        { status: 400 },
      );
    }

    const supabase = createServerSupabaseClient();
    await requireLostFoundActor(supabase, request, ["admin", "frontdesk", "supervisor"]);
    const alert = await getLostFoundGuestAlert(supabase, parsed.data.guest_profile_id);

    return NextResponse.json({ success: true, alert });
  } catch (error) {
    return NextResponse.json(
      { success: false, error: getLostFoundErrorMessage(error) },
      { status: getLostFoundErrorStatus(error) },
    );
  }
}
