import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { commitOtaExtendOrchestrator, isKnownOtaOrchestratorError } from "@/lib/ota-extend-orchestrator";

const paramsSchema = z.object({
  id: z.string().uuid("Invalid reservation id."),
});

const bodySchema = z.object({
  new_checkout_date: z.string(),
  strategy: z.enum(["same_room", "different_room"]),
  move_mode: z.enum(["move_now", "plan_move"]).optional().nullable(),
  ota_modification_option: z.enum(["option_a_keep_ota", "option_b_shorten_ota"]).optional().nullable(),
  ota_shorten_checkout_date: z.string().optional().nullable(),
  target_room_id: z.string().uuid().optional().nullable(),
  target_room_type_id: z.coerce.number().int().positive().optional().nullable(),
  plan_start_date: z.string().optional().nullable(),
  pricing_policy: z.enum(["keep_rtc", "reprice_grid", "reprice_grid_discount"]).optional(),
  discount_type: z.enum(["percent", "fixed"]).optional(),
  discount_value: z.coerce.number().optional(),
  discount_reason: z.string().optional(),
  selected_blocker_reservation_id: z.string().uuid().optional().nullable(),
  selected_blocker_target_room_id: z.string().uuid().optional().nullable(),
  note: z.string().optional(),
  copy_accompanying: z.coerce.boolean().optional(),
  copy_preferences: z.coerce.boolean().optional(),
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
    const result = await commitOtaExtendOrchestrator({
      supabase: supabase as any,
      input: {
        reservationId: parsedParams.data.id,
        newCheckoutDate: parsedBody.data.new_checkout_date,
        strategy: parsedBody.data.strategy,
        moveMode: parsedBody.data.move_mode ?? null,
        otaModificationOption: parsedBody.data.ota_modification_option ?? null,
        otaShortenCheckoutDate: parsedBody.data.ota_shorten_checkout_date ?? null,
        targetRoomId: parsedBody.data.target_room_id ?? null,
        targetRoomTypeId: parsedBody.data.target_room_type_id ?? null,
        planStartDate: parsedBody.data.plan_start_date ?? null,
        pricingPolicy: parsedBody.data.pricing_policy,
        discountType: parsedBody.data.discount_type,
        discountValue: parsedBody.data.discount_value,
        discountReason: parsedBody.data.discount_reason,
        selectedBlockerReservationId: parsedBody.data.selected_blocker_reservation_id ?? null,
        selectedBlockerTargetRoomId: parsedBody.data.selected_blocker_target_room_id ?? null,
        note: parsedBody.data.note ?? null,
        copyAccompanying: parsedBody.data.copy_accompanying ?? true,
        copyPreferences: parsedBody.data.copy_preferences ?? true,
      },
    });

    return NextResponse.json(result);
  } catch (error) {
    if (isKnownOtaOrchestratorError(error)) {
      return NextResponse.json({ success: false, error: error.message }, { status: error.status });
    }
    return NextResponse.json({ success: false, error: String(error) }, { status: 500 });
  }
}
