import {
  attachLostFoundPhotoUrls,
  getLostFoundErrorMessage,
  getLostFoundErrorStatus,
  getLostFoundItemById,
  getRoomSnapshot,
  mapLostFoundRow,
  requireLostFoundActor,
  resolveLostFoundReservationLink,
} from "@/lib/lost-found";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

export const dynamic = "force-dynamic";
export const fetchCache = "force-no-store";

const paramsSchema = z.object({
  id: z.string().uuid("Invalid item id"),
});

const categorySchema = z.enum(["general", "electronics", "clothing", "documents", "valuables", "other"]);

const patchSchema = z.object({
  room_id: z.string().uuid().optional(),
  reservation_id: z.string().uuid().nullable().optional(),
  description: z.string().trim().min(1).max(1000).optional(),
  category: categorySchema.optional(),
  location_detail: z.string().trim().max(200).nullable().optional(),
  found_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  found_by: z.string().trim().min(1).max(120).optional(),
}).refine((value) => Object.keys(value).length > 0, "At least one field is required.");

export async function GET(request: NextRequest, { params }: { params: { id: string } }) {
  try {
    const parsedParams = paramsSchema.safeParse(params);
    if (!parsedParams.success) {
      return NextResponse.json(
        { success: false, error: parsedParams.error.issues[0]?.message ?? "Invalid item id." },
        { status: 400 },
      );
    }

    const supabase = createServerSupabaseClient();
    await requireLostFoundActor(supabase, request, ["admin", "frontdesk", "supervisor"]);
    const item = await getLostFoundItemById(supabase, parsedParams.data.id);
    const [withPhoto] = await attachLostFoundPhotoUrls(supabase, [item]);

    return NextResponse.json({ success: true, item: withPhoto });
  } catch (error) {
    return NextResponse.json(
      { success: false, error: getLostFoundErrorMessage(error) },
      { status: getLostFoundErrorStatus(error) },
    );
  }
}

export async function PATCH(request: NextRequest, { params }: { params: { id: string } }) {
  try {
    const parsedParams = paramsSchema.safeParse(params);
    if (!parsedParams.success) {
      return NextResponse.json(
        { success: false, error: parsedParams.error.issues[0]?.message ?? "Invalid item id." },
        { status: 400 },
      );
    }

    const json = await request.json().catch(() => null);
    const parsedBody = patchSchema.safeParse(json);
    if (!parsedBody.success) {
      return NextResponse.json(
        { success: false, error: "Invalid payload.", details: parsedBody.error.flatten() },
        { status: 400 },
      );
    }

    const supabase = createServerSupabaseClient();
    await requireLostFoundActor(supabase, request, ["admin", "frontdesk", "supervisor"]);

    const current = await getLostFoundItemById(supabase, parsedParams.data.id);
    if (current.cleared_at) {
      return NextResponse.json({ success: false, error: "Cleared item cannot be edited." }, { status: 409 });
    }
    if (current.status !== "pending") {
      return NextResponse.json({ success: false, error: "Only pending items can be edited." }, { status: 409 });
    }

    const nextRoomId = parsedBody.data.room_id ?? current.room_id;
    const room = nextRoomId !== current.room_id ? await getRoomSnapshot(supabase, nextRoomId) : null;
    const shouldRelink = parsedBody.data.room_id !== undefined || parsedBody.data.reservation_id !== undefined;
    const link = shouldRelink
      ? await resolveLostFoundReservationLink(supabase, nextRoomId, parsedBody.data.reservation_id ?? null)
      : null;

    const updatePayload: Record<string, unknown> = {};
    if (parsedBody.data.description !== undefined) updatePayload.description = parsedBody.data.description;
    if (parsedBody.data.category !== undefined) updatePayload.category = parsedBody.data.category;
    if (parsedBody.data.location_detail !== undefined) updatePayload.location_detail = parsedBody.data.location_detail ?? null;
    if (parsedBody.data.found_date !== undefined) updatePayload.found_date = parsedBody.data.found_date;
    if (parsedBody.data.found_by !== undefined) updatePayload.found_by = parsedBody.data.found_by;
    if (room) {
      updatePayload.room_id = room.id;
      updatePayload.room_number = room.room_number;
    }
    if (link) {
      updatePayload.reservation_id = link.reservation_id;
      updatePayload.guest_profile_id = link.guest_profile_id;
      updatePayload.booking_code = link.booking_code;
      updatePayload.guest_name = link.guest_name;
      updatePayload.checkin_date = link.checkin_date;
      updatePayload.checkout_date = link.checkout_date;
    }

    const { data, error } = await supabase
      .from("lost_found_items")
      .update(updatePayload)
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
