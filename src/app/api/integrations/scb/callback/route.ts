import { NextRequest, NextResponse } from "next/server";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { inquireMaeManeeTransaction } from "@/lib/scb/client";
import { extractScbCallbackIdentifiers, loadScbRequestByReference, mapScbPaymentStatus } from "@/lib/scb/matching";
import { reconcileScbRequestStatuses } from "@/lib/scb/inquiry-runner";
import { processMatchedScbTransaction } from "@/lib/scb/posting";
import { assertScbCallbackSecurity } from "@/lib/scb/security";
import type { ScbNormalizedTransaction } from "@/lib/scb/types";

export const dynamic = "force-dynamic";

function toObject(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function normalizeFromCallbackPayload(payload: unknown, fallbackRef: string | null, fallbackOrderId: string | null): ScbNormalizedTransaction {
  const root = toObject(payload);
  const data = toObject(root.data);
  const transaction = toObject(data.transaction);
  const billPayment = toObject(data.billPayment ?? data.bill_payment);
  const payment = toObject(data.payment);
  const supplementaryData = toObject(transaction.supplementaryData);
  const envelope = toObject(supplementaryData.envelope);
  const additionalData = toObject(envelope.additionalData);
  const amount = Number(
    root.amount
    ?? data.amount
    ?? billPayment.amount
    ?? billPayment.paidLocalAmount
    ?? payment.amount
    ?? transaction.amount
    ?? toObject(toObject(transaction.originalTransactionReference).interbankSettlementAmount).amount
    ?? 0
  );
  const transactionId = String(
    root.transactionId
    ?? root.transaction_id
    ?? root.transRef
    ?? data.transactionId
    ?? data.transRef
    ?? billPayment.transRef
    ?? payment.transRef
    ?? transaction.transactionId
    ?? transaction.transactionDisplayId
    ?? transaction.clearingSystemReference
    ?? fallbackOrderId
    ?? fallbackRef
    ?? ""
  ).trim();
  const statusObject = toObject(root.status);
  const statusValue =
    root.paymentStatus
    ?? data.paymentStatus
    ?? billPayment.paymentStatus
    ?? payment.paymentStatus
    ?? transaction.transactionStatus
    ?? transaction.status
    ?? statusObject.code
    ?? root.status
    ?? data.status
    ?? "pending";
  return {
    found: true,
    transactionId,
    orderId: String(root.orderId ?? data.orderId ?? transaction.orderId ?? additionalData.partnerIdentification ?? fallbackOrderId ?? "").trim() || null,
    partnerReferenceNo: String(
      root.ref3
      ?? root.billReference3
      ?? root.partnerReferenceNo
      ?? root.partner_reference_no
      ?? data.ref3
      ?? data.billReference3
      ?? data.partnerReferenceNo
      ?? billPayment.ref3
      ?? billPayment.billReference3
      ?? payment.ref3
      ?? additionalData.billReference3
      ?? transaction.partnerReferenceNo
      ?? fallbackRef
      ?? ""
    ).trim() || null,
    amount: Number.isFinite(amount) ? amount : 0,
    currency: "THB",
    payerName: String(
      root.payerName
      ?? data.payerName
      ?? billPayment.senderName
      ?? toObject(billPayment.sender).displayName
      ?? toObject(billPayment.sender).name
      ?? additionalData.customerDisplayName
      ?? transaction.payerName
      ?? ""
    ).trim() || null,
    payerAccount: String(
      root.payerAccount
      ?? data.payerAccount
      ?? toObject(toObject(billPayment.sender).account).value
      ?? transaction.payerAccount
      ?? ""
    ).trim() || null,
    paymentChannel: String(root.paymentChannel ?? data.paymentChannel ?? transaction.paymentChannel ?? "T30").trim() || null,
    status: mapScbPaymentStatus(statusValue),
    paidAt: String(
      root.paidAt
      ?? data.paidAt
      ?? billPayment.transDateTime
      ?? additionalData.localTransactionDateTime
      ?? transaction.acceptanceDateTime
      ?? transaction.paidAt
      ?? ""
    ).trim() || null,
    rawPayload: root,
  };
}

export async function POST(request: NextRequest) {
  let identifiers = {
    transactionId: null,
    orderId: null,
    partnerReferenceNo: null,
    ref1: null,
    ref2: null,
    ref3: null,
  } as ReturnType<typeof extractScbCallbackIdentifiers>;
  try {
    const rawBody = await request.text();
    const payload = JSON.parse(rawBody);
    identifiers = extractScbCallbackIdentifiers(payload);
    console.log("[SCB callback route:start]", { identifiers });
    assertScbCallbackSecurity(request, rawBody);
    const supabase = createServerSupabaseClient();

    let normalized = normalizeFromCallbackPayload(
      payload,
      identifiers.ref3 || identifiers.partnerReferenceNo,
      identifiers.orderId
    );
    const matchedRequest = await loadScbRequestByReference(supabase as any, identifiers, normalized.amount);

    if (
      matchedRequest?.partner_reference_no &&
      matchedRequest?.scb_order_id &&
      matchedRequest?.wallet_id
    ) {
      try {
        normalized = await inquireMaeManeeTransaction({
          partnerReferenceNo: matchedRequest.partner_reference_no,
          orderId: matchedRequest.scb_order_id,
          walletId: matchedRequest.wallet_id,
          ref1: matchedRequest.scb_ref_1,
          ref2: matchedRequest.scb_ref_2,
          ref3: matchedRequest.scb_ref_3,
          createdAt: matchedRequest.created_at,
          amount: matchedRequest.request_amount_total,
        });
      } catch (error) {
        console.error("[SCB callback inquiry fallback failed]", {
          message: error instanceof Error ? error.message : String(error),
          identifiers,
        });
        // fall back to callback body normalization
      }
    }

    if (!normalized.transactionId) {
      console.error("[SCB callback missing transactionId]", {
        identifiers,
        rawPayload: normalized.rawPayload,
      });
      throw new Error("SCB callback transactionId is missing.");
    }

    const { data: existing } = await supabase
      .from("scb_payment_transactions")
      .select("id, request_id")
      .eq("transaction_id", normalized.transactionId)
      .maybeSingle();
    if (existing?.id) {
      await supabase.from("scb_recheck_logs").insert({
        request_id: existing.request_id ?? matchedRequest?.id ?? null,
        transaction_id: normalized.transactionId,
        triggered_by: null,
        source: "callback_retry",
        result_status: "duplicate",
        raw_payload: normalized.rawPayload,
      });
      return NextResponse.json({ success: true, duplicate: true });
    }

    const { data: inserted, error: insertError } = await supabase
      .from("scb_payment_transactions")
      .insert({
        request_id: matchedRequest?.id ?? null,
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
      })
      .select("id")
      .single();
    if (insertError || !inserted) {
      throw new Error(insertError?.message || "Failed to store SCB callback.");
    }

    await supabase.from("scb_recheck_logs").insert({
      request_id: matchedRequest?.id ?? null,
      transaction_id: normalized.transactionId,
      triggered_by: null,
      source: "callback_retry",
      result_status: normalized.status,
      raw_payload: normalized.rawPayload,
    });

    if (matchedRequest && normalized.status === "success" && matchedRequest.status === "pending") {
      await processMatchedScbTransaction(supabase as any, matchedRequest, normalized, inserted.id);
      await reconcileScbRequestStatuses(supabase as any, [matchedRequest.id]);
      return NextResponse.json({ success: true, matched: true, request_id: matchedRequest.id });
    }

    if (!matchedRequest) {
      return NextResponse.json({ success: true, matched: false, queue: "unmatched" });
    }

    return NextResponse.json({ success: true, matched: false, request_id: matchedRequest.id });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Internal server error";
    console.error("[SCB callback route:error]", {
      message,
      identifiers,
    });
    const status = /callback .*invalid|callback .*missing|callback .*not allowed|callback signature/i.test(message)
      ? 401
      : 500;
    return NextResponse.json({ success: false, error: message, identifiers }, { status });
  }
}
