import crypto from "crypto";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { getAuthenticatedUser, getUserRole } from "@/lib/server-auth";
import { buildScbReferenceBundle } from "@/lib/scb/matching";
import { processMatchedScbTransaction } from "@/lib/scb/posting";
import { almostEqualMoney } from "@/lib/scb/presenters";
import type { ScbNormalizedTransaction, ScbStoredRequest } from "@/lib/scb/types";

export const dynamic = "force-dynamic";

const bodySchema = z.object({
  target_type: z.enum(["reservation", "pos_order"]),
  target_id: z.string().uuid(),
  room_amount: z.coerce.number().min(0),
  deposit_amount: z.coerce.number().min(0).default(0),
  note: z.string().trim().optional(),
});

function toNormalizedTransaction(row: any): ScbNormalizedTransaction {
  return {
    found: true,
    transactionId: String(row.transaction_id),
    orderId: row.order_id ? String(row.order_id) : null,
    partnerReferenceNo: row.partner_reference_no ? String(row.partner_reference_no) : null,
    amount: Number(row.amount ?? 0),
    currency: String(row.currency ?? "THB"),
    payerName: row.payer_name ? String(row.payer_name) : null,
    payerAccount: row.payer_account ? String(row.payer_account) : null,
    paymentChannel: row.payment_channel ? String(row.payment_channel) : null,
    status: row.status,
    paidAt: row.paid_at ? String(row.paid_at) : null,
    rawPayload: row.raw_payload ?? {},
  };
}

function addMinutes(minutes: number) {
  return new Date(Date.now() + minutes * 60_000).toISOString();
}

export async function POST(request: NextRequest, { params }: { params: { id: string } }) {
  let lockedTransactionId: string | null = null;
  try {
    const supabase = createServerSupabaseClient();
    const user = await getAuthenticatedUser(supabase, request);
    if (!user) {
      return NextResponse.json({ success: false, error: "Unauthorized" }, { status: 401 });
    }
    const role = await getUserRole(supabase, user.id);
    if (role !== "admin") {
      return NextResponse.json({ success: false, error: "Forbidden" }, { status: 403 });
    }

    const parsed = bodySchema.safeParse(await request.json().catch(() => null));
    if (!parsed.success) {
      return NextResponse.json({ success: false, error: "Invalid payload.", details: parsed.error.flatten() }, { status: 400 });
    }

    const { data: transactionRow, error: transactionError } = await supabase
      .from("scb_payment_transactions")
      .select("*")
      .eq("id", params.id)
      .maybeSingle();
    if (transactionError) {
      return NextResponse.json({ success: false, error: transactionError.message }, { status: 500 });
    }
    if (!transactionRow) {
      return NextResponse.json({ success: false, error: "Transaction not found." }, { status: 404 });
    }
    if (String(transactionRow.match_status) !== "unmatched") {
      return NextResponse.json({ success: false, error: "Only unmatched transactions can be assigned." }, { status: 409 });
    }

    const total = Number(parsed.data.room_amount ?? 0) + Number(parsed.data.deposit_amount ?? 0);
    if (!almostEqualMoney(total, Number(transactionRow.amount ?? 0))) {
      return NextResponse.json({ success: false, error: "Amount split must exactly match transfer amount." }, { status: 409 });
    }
    if (parsed.data.target_type === "pos_order" && Number(parsed.data.deposit_amount ?? 0) > 0) {
      return NextResponse.json({ success: false, error: "POS target cannot receive deposit amount." }, { status: 409 });
    }

    const { data: lockedRow, error: lockError } = await supabase
      .from("scb_payment_transactions")
      .update({
        match_status: "matching",
        processed_at: new Date().toISOString(),
      })
      .eq("id", params.id)
      .eq("match_status", "unmatched")
      .select("*")
      .maybeSingle();
    if (lockError) {
      return NextResponse.json({ success: false, error: lockError.message }, { status: 500 });
    }
    if (!lockedRow) {
      return NextResponse.json({ success: false, error: "Transaction is already being matched by another user." }, { status: 409 });
    }
    lockedTransactionId = String(lockedRow.id);

    const requestId = crypto.randomUUID();
    const refs = buildScbReferenceBundle({
      targetType: parsed.data.target_type,
      targetId: parsed.data.target_id,
      requestId,
    });

    if (transactionRow.request_id) {
      await supabase
        .from("scb_payment_requests")
        .update({
          status: "cancelled",
          updated_at: new Date().toISOString(),
          error_message: "Superseded by manual match.",
        })
        .eq("id", transactionRow.request_id)
        .eq("status", "unmatched");
    }

    await supabase
      .from("scb_payment_requests")
      .update({
        status: "cancelled",
        updated_at: new Date().toISOString(),
        error_message: "Superseded by manual SCB match.",
      })
      .eq("target_type", parsed.data.target_type)
      .eq("target_id", parsed.data.target_id)
      .eq("status", "pending");

    const requestPayload = {
      manual_match_note: parsed.data.note ?? null,
      partnerMetaData: {},
    };

    const { data: insertedRequest, error: insertError } = await supabase
      .from("scb_payment_requests")
      .insert({
        id: requestId,
        target_type: parsed.data.target_type,
        target_id: parsed.data.target_id,
        channel: parsed.data.target_type === "reservation" ? "booking_folio" : "pos",
        mode: "custom",
        request_amount_total: Number(transactionRow.amount ?? 0),
        room_amount: Number(parsed.data.room_amount ?? 0),
        deposit_amount: Number(parsed.data.deposit_amount ?? 0),
        status: "pending",
        partner_reference_no: refs.partnerReferenceNo,
        scb_ref_1: refs.ref1,
        scb_ref_2: refs.ref2,
        scb_ref_3: refs.ref3,
        request_payload: requestPayload,
        expires_at: addMinutes(30),
        auto_inquiry_after_expiry_at: addMinutes(35),
        created_by: user.id,
      })
      .select("*")
      .single();
    if (insertError || !insertedRequest) {
      return NextResponse.json({ success: false, error: insertError?.message || "Failed to create manual match request." }, { status: 500 });
    }

    const normalized = toNormalizedTransaction(lockedRow);
    await processMatchedScbTransaction(supabase as any, insertedRequest as ScbStoredRequest, normalized, String(transactionRow.id));

    return NextResponse.json({ success: true, request_id: insertedRequest.id });
  } catch (error) {
    if (lockedTransactionId) {
      await createServerSupabaseClient()
        .from("scb_payment_transactions")
        .update({
          match_status: "unmatched",
          processed_at: null,
        })
        .eq("id", lockedTransactionId)
        .eq("match_status", "matching");
    }
    const message = error instanceof Error ? error.message : "Internal server error";
    return NextResponse.json({ success: false, error: message }, { status: 500 });
  }
}
