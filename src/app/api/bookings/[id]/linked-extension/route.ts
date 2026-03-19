import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { createLinkedExtensionReservation, isKnownLinkedExtensionError } from "@/lib/linked-extension";

const paramsSchema = z.object({
  id: z.string().uuid("Invalid reservation id."),
});

const bodySchema = z.object({
  checkin_date: z.string(),
  checkout_date: z.string(),
  source: z.enum(["walkin", "ota", "direct", "agent"]).default("walkin"),
  room_type_id: z.coerce.number().int().positive().optional().nullable(),
  room_id: z.string().uuid().optional().nullable(),
  rate_plan_id: z.string().uuid().optional().nullable(),
  note: z.string().optional(),
  copy_accompanying: z.coerce.boolean().optional().default(true),
  copy_preferences: z.coerce.boolean().optional().default(true),
});

export async function POST(request: NextRequest, { params }: { params: { id: string } }) {
  try {
    const parsedParams = paramsSchema.safeParse(params);
    if (!parsedParams.success) {
      return NextResponse.json({ success: false, error: parsedParams.error.issues[0]?.message ?? "Invalid reservation id." }, { status: 400 });
    }

    const json = await request.json().catch(() => null);
    const parsedBody = bodySchema.safeParse(json);
    if (!parsedBody.success) {
      return NextResponse.json({ success: false, error: "Invalid payload.", details: parsedBody.error.flatten() }, { status: 400 });
    }

    const supabase = createServerSupabaseClient();
    const result = await createLinkedExtensionReservation({
      supabase: supabase as any,
      originalReservationId: parsedParams.data.id,
      payload: {
        checkin_date: parsedBody.data.checkin_date,
        checkout_date: parsedBody.data.checkout_date,
        source: parsedBody.data.source,
        room_type_id: parsedBody.data.room_type_id ?? null,
        room_id: parsedBody.data.room_id ?? null,
        rate_plan_id: parsedBody.data.rate_plan_id ?? null,
        note: parsedBody.data.note ?? null,
        copy_accompanying: Boolean(parsedBody.data.copy_accompanying),
        copy_preferences: Boolean(parsedBody.data.copy_preferences),
      },
    });

    return NextResponse.json(result);
  } catch (error) {
    if (isKnownLinkedExtensionError(error)) {
      return NextResponse.json({ success: false, error: error.message }, { status: error.status });
    }
    return NextResponse.json({ success: false, error: String(error) }, { status: 500 });
  }
}
