import {
  deleteLostFoundPhoto,
  getLostFoundErrorMessage,
  getLostFoundErrorStatus,
  getLostFoundItemById,
  mapLostFoundRow,
  requireLostFoundActor,
} from "@/lib/lost-found";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

export const dynamic = "force-dynamic";
export const fetchCache = "force-no-store";

const paramsSchema = z.object({
  id: z.string().uuid("Invalid item id"),
});

const bodySchema = z.object({
  note: z.string().trim().min(1).max(1000).optional(),
  claim_note: z.string().trim().min(1).max(1000).optional(),
  claimed_by: z.string().trim().min(1).max(120).optional(),
}).refine((value) => Boolean(value.note ?? value.claim_note), {
  message: "note is required",
  path: ["note"],
});

export async function POST(request: NextRequest, { params }: { params: { id: string } }) {
  try {
    const parsedParams = paramsSchema.safeParse(params);
    if (!parsedParams.success) {
      return NextResponse.json(
        { success: false, error: parsedParams.error.issues[0]?.message ?? "Invalid item id." },
        { status: 400 },
      );
    }

    const json = await request.json().catch(() => null);
    const parsedBody = bodySchema.safeParse(json);
    if (!parsedBody.success) {
      return NextResponse.json(
        { success: false, error: "Invalid payload.", details: parsedBody.error.flatten() },
        { status: 400 },
      );
    }

    const supabase = createServerSupabaseClient();
    const actor = await requireLostFoundActor(supabase, request, ["admin", "frontdesk", "supervisor"]);
    const current = await getLostFoundItemById(supabase, parsedParams.data.id);

    if (current.cleared_at) {
      return NextResponse.json({ success: false, error: "Cleared item cannot be claimed." }, { status: 409 });
    }
    if (current.status !== "pending") {
      return NextResponse.json({ success: false, error: "Item has already been claimed." }, { status: 409 });
    }

    await deleteLostFoundPhoto(supabase, current.photo_path);

    const { data, error } = await supabase
      .from("lost_found_items")
      .update({
        status: "claimed",
        claim_note: parsedBody.data.note ?? parsedBody.data.claim_note,
        claimed_at: new Date().toISOString(),
        claimed_by: parsedBody.data.claimed_by ?? actor.displayName,
        photo_path: null,
      })
      .eq("id", parsedParams.data.id)
      .select("*")
      .single();

    if (error) {
      return NextResponse.json({ success: false, error: error.message }, { status: 500 });
    }

    return NextResponse.json({ success: true, item: mapLostFoundRow(data as any) });
  } catch (error) {
    return NextResponse.json(
      { success: false, error: getLostFoundErrorMessage(error) },
      { status: getLostFoundErrorStatus(error) },
    );
  }
}
