import {
  assertCanManageLogbookNote,
  getNextLogbookZIndex,
  HttpError,
  LOGBOOK_BOARD_MODES,
} from "@/lib/logbook-api";
import { requireStaffAuth } from "@/lib/server-auth";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

export const dynamic = "force-dynamic";
export const fetchCache = "force-no-store";

const paramsSchema = z.object({
  id: z.string().uuid(),
});

const bodySchema = z
  .object({
    x: z.coerce.number().int().min(-10000).max(10000).optional(),
    y: z.coerce.number().int().min(-10000).max(10000).optional(),
    width: z.coerce.number().int().min(300).max(560).optional(),
    height: z.coerce.number().int().min(170).max(420).optional(),
    z_index: z.coerce.number().int().min(1).max(2000000000).optional(),
    is_minimized: z.boolean().optional(),
    board_mode: z.enum(LOGBOOK_BOARD_MODES).optional(),
    bring_to_front: z.boolean().optional().default(false),
  })
  .refine(
    (value) =>
      value.bring_to_front === true ||
      value.x !== undefined ||
      value.y !== undefined ||
      value.width !== undefined ||
      value.height !== undefined ||
      value.z_index !== undefined ||
      value.is_minimized !== undefined ||
      value.board_mode !== undefined,
    "At least one position field is required."
  );

export async function PATCH(request: NextRequest, context: { params: { id: string } }) {
  try {
    const supabase = createServerSupabaseClient();
    const auth = await requireStaffAuth(supabase, request);
    if (auth.error) return auth.error;

    const params = paramsSchema.safeParse(context.params);
    if (!params.success) {
      return NextResponse.json(
        { success: false, error: "Invalid note id.", details: params.error.flatten() },
        { status: 400 }
      );
    }
    const noteId = params.data.id;

    await assertCanManageLogbookNote(supabase, auth.user.id, noteId);

    const json = await request.json().catch(() => null);
    const parsed = bodySchema.safeParse(json);
    if (!parsed.success) {
      return NextResponse.json(
        { success: false, error: "Invalid payload.", details: parsed.error.flatten() },
        { status: 400 }
      );
    }

    const payload = parsed.data;
    const updates: Record<string, unknown> = {};
    if (payload.x !== undefined) updates.x = payload.x;
    if (payload.y !== undefined) updates.y = payload.y;
    const boardMode =
      payload.board_mode ?? (payload.is_minimized !== undefined ? (payload.is_minimized ? "minimized" : "middle") : undefined);
    if (boardMode !== undefined) {
      updates.board_mode = boardMode;
      updates.is_minimized = boardMode === "minimized";
    }
    if (boardMode === "minimized") {
      updates.width = 300;
      updates.height = 44;
    } else {
      if (payload.width !== undefined) updates.width = payload.width;
      if (payload.height !== undefined) updates.height = payload.height;
    }

    if (payload.bring_to_front) {
      updates.z_index = await getNextLogbookZIndex(supabase);
    } else if (payload.z_index !== undefined) {
      updates.z_index = payload.z_index;
    }

    const { data, error } = await supabase
      .from("logbook_notes")
      .update(updates)
      .eq("id", noteId)
      .select("id, x, y, width, height, z_index, is_minimized, board_mode, updated_at")
      .maybeSingle();

    if (error) throw new HttpError(500, error.message);
    if (!data) throw new HttpError(404, "Logbook note not found.");

    return NextResponse.json({ success: true, data });
  } catch (err) {
    if (err instanceof HttpError) {
      return NextResponse.json({ success: false, error: err.message }, { status: err.status });
    }
    console.error("api/logbook/notes/[id]/position PATCH failed", err);
    const message = err instanceof Error ? err.message : "Internal server error";
    return NextResponse.json({ success: false, error: message }, { status: 500 });
  }
}
