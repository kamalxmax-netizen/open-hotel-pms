import { NextRequest, NextResponse } from "next/server";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { inquireMaeManeeTransaction } from "@/lib/scb/client";
import { extractScbCallbackIdentifiers, loadScbRequestByReference, mapScbPaymentStatus } from "@/lib/scb/matching";
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
  const amount = Number(root.amount ?? data.amount ?? transaction.amount ?? 0);
  const transactionId = String(
    root.transactionId
    ?? root.transaction_id
    ?? data.transactionId
    ?? transaction.transactionId
    ?? transaction.transactionDisplayId
    ?? fallbackOrderId
    ?? fallbackRef
    ?? `SCB-${Date.now()}`
  ).trim();
  const statusValue = root.status ?? data.status ?? transaction.status ?? "pending";
  return {
    transactionId,
    orderId: String(root.orderId ?? data.orderId ?? transaction.orderId ?? fallbackOrderId ?? "").trim() || null,
    partnerReferenceNo: String(root.partnerReferenceNo ?? root.partner_reference_no ?? data.partnerReferenceNo ?? transaction.partnerReferenceNo ?? fallbackRef ?? "").trim() || null,
    amount: Number.isFinite(amount) ? amount : 0,
    currency: "THB",
    payerName: String(root.payerName ?? data.payerName ?? transaction.payerName ?? "").trim() || null,
    payerAccount: String(root.payerAccount ?? data.payerAccount ?? transaction.payerAccount ?? "").trim() || null,
    paymentChannel: String(root.paymentChannel ?? data.paymentChannel ?? transaction.paymentChannel ?? "").trim() || null,
    status: mapScbPaymentStatus(typeof statusValue === "object" ? toObject(statusValue).code : statusValue),
    paidAt: String(root.paidAt ?? data.paidAt ?? transaction.paidAt ?? "").trim() || null,
    rawPayload: root,
  };
}

export async function POST(request: NextRequest) {
  try {
    const rawBody = await request.text();
    assertScbCallbackSecurity(request, rawBody);

    const payload = JSON.parse(rawBody);
    const identifiers = extractScbCallbackIdentifiers(payload);
    const supabase = createServerSupabaseClient();
    const matchedRequest = await loadScbRequestByReference(supabase as any, identifiers);

    let normalized = normalizeFromCallbackPayload(
      payload,
      identifiers.partnerReferenceNo,
      identifiers.orderId
    );

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
        });
      } catch {
        // fall back to callback body normalization
      }
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
      return NextResponse.json({ success: true, matched: true, request_id: matchedRequest.id });
    }

    if (!matchedRequest) {
      return NextResponse.json({ success: true, matched: false, queue: "unmatched" });
    }

    return NextResponse.json({ success: true, matched: false, request_id: matchedRequest.id });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Internal server error";
    return NextResponse.json({ success: false, error: message }, { status: 401 });
  }
}
