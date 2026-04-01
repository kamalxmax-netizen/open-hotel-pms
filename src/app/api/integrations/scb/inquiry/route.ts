import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { getAuthenticatedUser } from "@/lib/server-auth";
import { inquireMaeManeeTransaction } from "@/lib/scb/client";
import { processMatchedScbTransaction } from "@/lib/scb/posting";

export const dynamic = "force-dynamic";

const bodySchema = z.object({
  request_id: z.string().uuid().optional(),
  source: z.enum(["manual", "scheduled", "callback_retry"]).default("manual"),
});

export async function POST(request: NextRequest) {
  try {
    const supabase = createServerSupabaseClient();
    const user = await getAuthenticatedUser(supabase, request);
    if (!user) {
      return NextResponse.json({ success: false, error: "Unauthorized" }, { status: 401 });
    }

    const parsed = bodySchema.safeParse(await request.json().catch(() => null));
    if (!parsed.success || !parsed.data.request_id) {
      return NextResponse.json({ success: false, error: "request_id is required." }, { status: 400 });
    }

    const { data: scbRequest, error: requestError } = await supabase
      .from("scb_payment_requests")
      .select("*")
      .eq("id", parsed.data.request_id)
      .maybeSingle();
    if (requestError) return NextResponse.json({ success: false, error: requestError.message }, { status: 500 });
    if (!scbRequest) return NextResponse.json({ success: false, error: "SCB request not found." }, { status: 404 });
    if (!scbRequest.partner_reference_no || !scbRequest.scb_order_id || !scbRequest.wallet_id) {
      return NextResponse.json({ success: false, error: "SCB request is missing partner reference / order id / wallet id." }, { status: 409 });
    }

    const normalized = await inquireMaeManeeTransaction({
      partnerReferenceNo: scbRequest.partner_reference_no,
      orderId: scbRequest.scb_order_id,
      walletId: scbRequest.wallet_id,
      ref1: scbRequest.scb_ref_1,
      ref2: scbRequest.scb_ref_2,
      ref3: scbRequest.scb_ref_3,
      createdAt: scbRequest.created_at,
      amount: scbRequest.request_amount_total,
    });

    const { data: transactionRow, error: txError } = await supabase
      .from("scb_payment_transactions")
      .upsert({
        request_id: scbRequest.id,
        transaction_id: normalized.transactionId,
        order_id: normalized.orderId,
        partner_reference_no: normalized.partnerReferenceNo,
        amount: normalized.amount,
        currency: normalized.currency,
        payer_name: normalized.payerName,
        payer_account: normalized.payerAccount,
        payment_channel: normalized.paymentChannel,
        paid_at: normalized.paidAt,
        status: normalized.status,
        match_status: "unmatched",
        raw_payload: normalized.rawPayload,
      }, { onConflict: "transaction_id" })
      .select("id")
      .single();
    if (txError || !transactionRow) throw new Error(txError?.message || "Failed to upsert inquiry transaction.");

    await supabase.from("scb_recheck_logs").insert({
      request_id: scbRequest.id,
      transaction_id: normalized.transactionId,
      triggered_by: user.id,
      source: parsed.data.source,
      result_status: normalized.status,
      raw_payload: normalized.rawPayload,
    });

    if (normalized.status === "success" && scbRequest.status === "pending") {
      await processMatchedScbTransaction(supabase as any, scbRequest, normalized, transactionRow.id);
    }

    return NextResponse.json({ success: true, request: scbRequest, inquiry: normalized });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Internal server error";
    return NextResponse.json({ success: false, error: message }, { status: 500 });
  }
}
