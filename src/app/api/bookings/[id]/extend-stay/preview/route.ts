import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { getAuthenticatedUser } from "@/lib/server-auth";
import {
  isKnownExtendStayOrchestratorError,
  previewExtendStay,
} from "@/lib/extend-stay-orchestrator";
import {
  isKnownOtaOrchestratorError,
  previewOtaExtendOrchestrator,
} from "@/lib/ota-extend-orchestrator";

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
});

export async function POST(request: NextRequest, { params }: { params: { id: string } }) {
  try {
    const parsedParams = paramsSchema.safeParse(params);
    if (!parsedParams.success) {
      return NextResponse.json(
        { success: false, error: parsedParams.error.issues[0]?.message ?? "Invalid reservation id." },
        { status: 400 }
      );
    }

    const json = await request.json().catch(() => null);
    const parsedBody = bodySchema.safeParse(json);
    if (!parsedBody.success) {
      return NextResponse.json(
        { success: false, error: "Invalid payload.", details: parsedBody.error.flatten() },
        { status: 400 }
      );
    }

    const supabase = createServerSupabaseClient();
    const user = await getAuthenticatedUser(supabase, request);
    if (!user) {
      return NextResponse.json({ success: false, error: "Unauthorized" }, { status: 401 });
    }

    const reservationId = parsedParams.data.id;
    const { data: reservation, error: reservationError } = await supabase
      .from("reservations")
      .select("id, source")
      .eq("id", reservationId)
      .maybeSingle();
    if (reservationError) {
      return NextResponse.json({ success: false, error: reservationError.message }, { status: 500 });
    }
    if (!reservation) {
      return NextResponse.json({ success: false, error: "Reservation not found." }, { status: 404 });
    }

    const source = String(reservation.source ?? "");
    if (source === "ota") {
      const result = await previewOtaExtendOrchestrator({
        supabase: supabase as any,
        input: {
          reservationId,
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
        },
      });

      return NextResponse.json({
        success: true,
        source,
        mode: "linked_extension",
        ...result,
      });
    }

    const result = await previewExtendStay({
      supabase: supabase as any,
      input: {
        reservationId,
        newCheckoutDate: parsedBody.data.new_checkout_date,
        strategy: parsedBody.data.strategy,
        moveMode: parsedBody.data.move_mode ?? null,
        targetRoomId: parsedBody.data.target_room_id ?? null,
        targetRoomTypeId: parsedBody.data.target_room_type_id ?? null,
        planStartDate: parsedBody.data.plan_start_date ?? null,
        pricingPolicy: parsedBody.data.pricing_policy,
        discountType: parsedBody.data.discount_type,
        discountValue: parsedBody.data.discount_value,
        discountReason: parsedBody.data.discount_reason,
      },
    });

    return NextResponse.json({
      success: true,
      ...result,
    });
  } catch (error) {
    if (isKnownOtaOrchestratorError(error) || isKnownExtendStayOrchestratorError(error)) {
      return NextResponse.json({ success: false, error: error.message }, { status: error.status });
    }
    return NextResponse.json({ success: false, error: String(error) }, { status: 500 });
  }
}
