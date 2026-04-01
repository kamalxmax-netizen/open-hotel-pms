import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getAuthenticatedUser } from "@/lib/server-auth";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { createScbPaymentRequest } from "@/lib/scb/requests";
import { serializeScbRequest } from "@/lib/scb/presenters";
import { getActivePendingRequestForTarget } from "@/lib/scb/matching";

export const dynamic = "force-dynamic";

const bodySchema = z.object({
  target_type: z.enum(["reservation", "pos_order"]),
  target_id: z.string().uuid(),
  channel: z.enum(["booking_folio", "mobile_checkin", "pos"]),
  mode: z.enum(["outstanding", "custom"]).optional(),
  room_amount: z.coerce.number().min(0),
  deposit_amount: z.coerce.number().min(0).default(0),
  expires_minutes: z.coerce.number().int().min(1).max(240).optional(),
  partner_metadata: z.record(z.any()).optional(),
});

const querySchema = z.object({
  target_id: z.string().uuid().optional(),
  status: z.string().trim().optional(),
});

async function markExpiredIfNeeded(supabase: ReturnType<typeof createServerSupabaseClient>, requestId: string) {
  const now = new Date().toISOString();
  await supabase
    .from("scb_payment_requests")
    .update({
      status: "expired",
      updated_at: now,
    })
    .eq("id", requestId)
    .eq("status", "pending")
    .lt("expires_at", now);
}

export async function GET(request: NextRequest) {
  try {
    const supabase = createServerSupabaseClient();
    const user = await getAuthenticatedUser(supabase, request);
    if (!user) {
      return NextResponse.json({ success: false, error: "Unauthorized" }, { status: 401 });
    }

    const parsed = querySchema.safeParse({
      target_id: request.nextUrl.searchParams.get("target_id") ?? undefined,
      status: request.nextUrl.searchParams.get("status") ?? undefined,
    });
    if (!parsed.success || !parsed.data.target_id) {
      return NextResponse.json({ success: false, error: "target_id is required." }, { status: 400 });
    }

    let query = supabase
      .from("scb_payment_requests")
      .select("*")
      .eq("target_id", parsed.data.target_id)
      .order("created_at", { ascending: false })
      .limit(1);

    if (parsed.data.status) {
      query = query.eq("status", parsed.data.status);
    }

    const { data, error } = await query.maybeSingle();
    if (error) {
      return NextResponse.json({ success: false, error: error.message }, { status: 500 });
    }
    if (!data) {
      return NextResponse.json({ success: true, data: null });
    }

    await markExpiredIfNeeded(supabase, data.id);
    const { data: refreshed, error: refreshError } = await supabase
      .from("scb_payment_requests")
      .select("*")
      .eq("id", data.id)
      .maybeSingle();
    if (refreshError) {
      return NextResponse.json({ success: false, error: refreshError.message }, { status: 500 });
    }

    const serialized = refreshed ? serializeScbRequest(refreshed as any) : null;
    return NextResponse.json({ success: true, data: serialized, request: serialized });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Internal server error";
    return NextResponse.json({ success: false, error: message }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const supabase = createServerSupabaseClient();
    const user = await getAuthenticatedUser(supabase, request);
    if (!user) {
      return NextResponse.json({ success: false, error: "Unauthorized" }, { status: 401 });
    }

    const body = await request.json().catch(() => null);
    const parsed = bodySchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { success: false, error: "Invalid payload.", details: parsed.error.flatten() },
        { status: 400 }
      );
    }

    const existingPending = await getActivePendingRequestForTarget(
      supabase as any,
      parsed.data.target_type,
      parsed.data.target_id
    );
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
      targetType: parsed.data.target_type,
      targetId: parsed.data.target_id,
      channel: parsed.data.channel,
      mode: parsed.data.mode ?? "custom",
      roomAmount: parsed.data.room_amount,
      depositAmount: parsed.data.deposit_amount,
      expiresMinutes: parsed.data.expires_minutes,
      createdBy: user.id,
      partnerMetaData: parsed.data.partner_metadata,
    });

    const serialized = serializeScbRequest(created as any);
    return NextResponse.json({ success: true, request: serialized, data: serialized }, { status: 201 });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Internal server error";
    return NextResponse.json({ success: false, error: message }, { status: 500 });
  }
}
