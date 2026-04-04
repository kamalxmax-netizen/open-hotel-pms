import {
  attachLostFoundPhotoUrls,
  getLostFoundErrorMessage,
  getLostFoundErrorStatus,
  listLostFoundItems,
  mapLostFoundRow,
  requireLostFoundActor,
  resolveLostFoundReservationLink,
  getRoomSnapshot,
} from "@/lib/lost-found";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

export const dynamic = "force-dynamic";
export const fetchCache = "force-no-store";

const categorySchema = z.enum(["general", "electronics", "clothing", "documents", "valuables", "other"]);

const querySchema = z.object({
  status: z.enum(["all", "pending", "claimed"]).optional().default("all"),
  date_from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  date_to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  room_number: z.string().trim().max(50).optional(),
  guest_name: z.string().trim().max(120).optional(),
  reported_by: z.string().trim().max(120).optional(),
  guest: z.string().uuid().optional(),
});

const createSchema = z.object({
  room_id: z.string().uuid().nullable().optional(),
  description: z.string().trim().min(1, "description is required").max(1000),
  category: categorySchema.optional().default("general"),
  location_detail: z.string().trim().max(200).nullable().optional(),
  found_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(),
  found_by: z.string().trim().min(1, "found_by is required").max(120),
  reported_by_user_id: z.string().uuid().nullable().optional(),
  reservation_id: z.string().uuid().nullable().optional(),
});

export async function GET(request: NextRequest) {
  try {
    const parsed = querySchema.safeParse({
      status: request.nextUrl.searchParams.get("status") ?? undefined,
      date_from: request.nextUrl.searchParams.get("date_from") ?? undefined,
      date_to: request.nextUrl.searchParams.get("date_to") ?? undefined,
      room_number: request.nextUrl.searchParams.get("room_number") ?? undefined,
      guest_name: request.nextUrl.searchParams.get("guest_name") ?? undefined,
      reported_by: request.nextUrl.searchParams.get("reported_by") ?? undefined,
      guest: request.nextUrl.searchParams.get("guest") ?? undefined,
    });

    if (!parsed.success) {
      return NextResponse.json(
        { success: false, error: "Invalid query.", details: parsed.error.flatten() },
        { status: 400 },
      );
    }

    const supabase = createServerSupabaseClient();
    const actor = await requireLostFoundActor(supabase, request, ["admin", "frontdesk", "supervisor"]);
    const items = await listLostFoundItems(supabase, {
      status: parsed.data.status,
      dateFrom: parsed.data.date_from ?? null,
      dateTo: parsed.data.date_to ?? null,
      roomNumber: parsed.data.room_number ?? null,
      guestName: parsed.data.guest_name ?? null,
      reportedBy: parsed.data.reported_by ?? null,
      guestProfileId: parsed.data.guest ?? null,
    });

    return NextResponse.json({
      success: true,
      items: await attachLostFoundPhotoUrls(supabase, items),
      actor_role: actor.role,
    });
  } catch (error) {
    return NextResponse.json(
      { success: false, error: getLostFoundErrorMessage(error) },
      { status: getLostFoundErrorStatus(error) },
    );
  }
}

export async function POST(request: NextRequest) {
  try {
    const json = await request.json().catch(() => null);
    const parsed = createSchema.safeParse(json);
    if (!parsed.success) {
      return NextResponse.json(
        { success: false, error: "Invalid payload.", details: parsed.error.flatten() },
        { status: 400 },
      );
    }

    const supabase = createServerSupabaseClient();
    const actor = await requireLostFoundActor(supabase, request, ["admin", "frontdesk", "maid", "supervisor"]);
    const hasRoom = Boolean(parsed.data.room_id);
    const room = hasRoom ? await getRoomSnapshot(supabase, String(parsed.data.room_id)) : null;
    const link = hasRoom
      ? await resolveLostFoundReservationLink(
          supabase,
          String(parsed.data.room_id),
          parsed.data.reservation_id ?? null,
        )
      : {
          reservation_id: null,
          guest_profile_id: null,
          booking_code: null,
          guest_name: null,
          checkin_date: null,
          checkout_date: null,
        };

    const { data, error } = await supabase
      .from("lost_found_items")
      .insert({
        room_id: room?.id ?? null,
        room_number: room?.room_number ?? null,
        reservation_id: link.reservation_id,
        guest_profile_id: link.guest_profile_id,
        booking_code: link.booking_code,
        guest_name: link.guest_name,
        checkin_date: link.checkin_date,
        checkout_date: link.checkout_date,
        description: parsed.data.description,
        category: parsed.data.category,
        found_date: parsed.data.found_date ?? undefined,
        found_by: parsed.data.found_by,
        reported_by_user_id: parsed.data.reported_by_user_id ?? actor.userId,
        location_detail: parsed.data.location_detail ?? null,
      })
      .select("*")
      .single();

    if (error) {
      return NextResponse.json({ success: false, error: error.message }, { status: 500 });
    }

    return NextResponse.json({
      success: true,
      item: mapLostFoundRow(data as any),
    }, { status: 201 });
  } catch (error) {
    return NextResponse.json(
      { success: false, error: getLostFoundErrorMessage(error) },
      { status: getLostFoundErrorStatus(error) },
    );
  }
}
