import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { getAuthenticatedUser } from "@/lib/server-auth";
import { createScbPaymentRequest } from "@/lib/scb/requests";
import { serializeScbRequest } from "@/lib/scb/presenters";
import { getActivePendingRequestForTarget } from "@/lib/scb/matching";

export const dynamic = "force-dynamic";

const bodySchema = z.object({
  mode: z.enum(["outstanding", "custom"]),
  channel: z.literal("pos").default("pos"),
  room_amount: z.coerce.number().min(0).optional(),
  expires_minutes: z.coerce.number().int().min(1).max(240).optional(),
});

export async function POST(request: NextRequest, { params }: { params: { id: string } }) {
  try {
    const supabase = createServerSupabaseClient();
    const user = await getAuthenticatedUser(supabase, request);
    if (!user) {
      return NextResponse.json({ success: false, error: "Unauthorized" }, { status: 401 });
    }

    const parsed = bodySchema.safeParse(await request.json().catch(() => null));
    if (!parsed.success) {
      return NextResponse.json({ success: false, error: "Invalid payload.", details: parsed.error.flatten() }, { status: 400 });
    }

    const { data: order, error: orderError } = await supabase
      .from("pos_orders")
      .select("id, order_number, guest_name, status, total")
      .eq("id", params.id)
      .maybeSingle();
    if (orderError) return NextResponse.json({ success: false, error: orderError.message }, { status: 500 });
    if (!order) return NextResponse.json({ success: false, error: "POS order not found." }, { status: 404 });
    if (String(order.status ?? "").toLowerCase() === "voided") {
      return NextResponse.json({ success: false, error: "Cannot create SCB QR for voided order." }, { status: 409 });
    }

    const total = Number(order.total ?? 0);
    const roomAmount = parsed.data.mode === "outstanding" ? total : Number(parsed.data.room_amount ?? 0);
    if (roomAmount <= 0) {
      return NextResponse.json({ success: false, error: "SCB QR amount must be greater than 0." }, { status: 400 });
    }

    const existingPending = await getActivePendingRequestForTarget(supabase as any, "pos_order", params.id);
    if (existingPending?.id) {
      const serializedExisting = serializeScbRequest(existingPending as any);
      return NextResponse.json({
        success: false,
        error: "Pending SCB QR already exists for this target.",
        existing_request_id: existingPending.id,
        existing_request: serializedExisting,
      }, { status: 409 });
    }

    const created = await createScbPaymentRequest(supabase as any, {
      targetType: "pos_order",
      targetId: params.id,
      channel: "pos",
      mode: parsed.data.mode,
      roomAmount,
      depositAmount: 0,
      expiresMinutes: parsed.data.expires_minutes,
      createdBy: user.id,
      partnerMetaData: {
        orderNumber: order.order_number,
        guestName: order.guest_name,
        orderStatus: order.status,
      },
    });

    const serialized = serializeScbRequest(created as any);
    return NextResponse.json({
      success: true,
      request: serialized,
      data: serialized,
      computed: {
        outstanding_amount: total,
        room_amount: roomAmount,
      },
    }, { status: 201 });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Internal server error";
    return NextResponse.json({ success: false, error: message }, { status: 500 });
  }
}
