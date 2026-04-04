import {
  attachLostFoundPhotoUrls,
  getLostFoundErrorMessage,
  getLostFoundErrorStatus,
  listExpiredLostFoundItems,
  requireLostFoundActor,
} from "@/lib/lost-found";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

export const dynamic = "force-dynamic";
export const fetchCache = "force-no-store";

const querySchema = z.object({
  show_cleared: z
    .enum(["true", "false"])
    .optional()
    .transform((value) => value === "true"),
});

export async function GET(request: NextRequest) {
  try {
    const parsed = querySchema.safeParse({
      show_cleared: request.nextUrl.searchParams.get("show_cleared") ?? undefined,
    });

    if (!parsed.success) {
      return NextResponse.json(
        { success: false, error: "Invalid query.", details: parsed.error.flatten() },
        { status: 400 },
      );
    }

    const supabase = createServerSupabaseClient();
    const actor = await requireLostFoundActor(supabase, request, ["admin", "frontdesk", "supervisor"]);
    const showCleared = actor.role === "admin" ? parsed.data.show_cleared : false;
    const items = await listExpiredLostFoundItems(supabase, Boolean(showCleared));

    return NextResponse.json({
      success: true,
      items: await attachLostFoundPhotoUrls(supabase, items),
      can_view_cleared: actor.role === "admin",
    });
  } catch (error) {
    return NextResponse.json(
      { success: false, error: getLostFoundErrorMessage(error) },
      { status: getLostFoundErrorStatus(error) },
    );
  }
}
