import type { SupabaseClient } from "@supabase/supabase-js";
import { inquireMaeManeeTransaction } from "@/lib/scb/client";
import { processMatchedScbTransaction } from "@/lib/scb/posting";
import type { ScbStoredRequest } from "@/lib/scb/types";

type InquirySource = "manual" | "scheduled" | "callback_retry";

type ExistingTransactionRow = {
  id: string;
  match_status: string;
  request_id: string | null;
};

type ReconcileCandidate = {
  id: string;
  request_id: string | null;
  status: string;
  match_status: string | null;
  created_at: string;
};

function isPendingRequestEligibleForAutoInquiry(request: ScbStoredRequest, now = new Date()): boolean {
  if (request.status !== "pending") return false;
  const createdAt = new Date(request.created_at);
  const expiresAt = new Date(request.expires_at);
  const ageMs = now.getTime() - createdAt.getTime();
  if (Number.isNaN(createdAt.getTime()) || Number.isNaN(expiresAt.getTime())) return false;
  if (ageMs < 2 * 60_000) return false;
  if (ageMs > 30 * 60_000) return false;
  if (expiresAt.getTime() <= now.getTime()) return false;
  if (!request.partner_reference_no || !request.scb_order_id || !request.wallet_id) return false;
  return true;
}

function toIso(value: string | Date | null | undefined): string | null {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return date.toISOString();
}

function deriveRequestStatusFromTransactions(
  request: Pick<ScbStoredRequest, "status" | "expires_at">,
  transactions: ReconcileCandidate[]
): { status: string; paidTransactionId: string | null; errorMessage: string | null } {
  const matchedSuccess = transactions.find(
    (row) => row.match_status === "matched" && row.status === "success"
  );
  if (matchedSuccess) {
    return {
      status: "paid",
      paidTransactionId: matchedSuccess.id,
      errorMessage: null,
    };
  }

  const unmatched = transactions.find((row) => row.match_status === "unmatched");
  if (unmatched) {
    return {
      status: "unmatched",
      paidTransactionId: null,
      errorMessage: null,
    };
  }

  const expiresAt = toIso(request.expires_at);
  if (request.status === "pending" && expiresAt && expiresAt < new Date().toISOString()) {
    return {
      status: "expired",
      paidTransactionId: null,
      errorMessage: "SCB request expired before payment confirmation.",
    };
  }

  return {
    status: request.status,
    paidTransactionId: null,
    errorMessage: null,
  };
}

export async function reconcileScbRequestStatuses(
  supabase: SupabaseClient,
  requestIds: string[]
): Promise<void> {
  const ids = Array.from(new Set(requestIds.map((id) => String(id)).filter(Boolean)));
  if (ids.length === 0) return;

  const [{ data: requests, error: requestsError }, { data: transactions, error: transactionsError }] = await Promise.all([
    supabase
      .from("scb_payment_requests")
      .select("id, status, expires_at, paid_transaction_id, error_message")
      .in("id", ids),
    supabase
      .from("scb_payment_transactions")
      .select("id, request_id, status, match_status, created_at")
      .in("request_id", ids)
      .order("created_at", { ascending: false }),
  ]);

  if (requestsError) throw new Error(requestsError.message);
  if (transactionsError) throw new Error(transactionsError.message);

  const txMap = new Map<string, ReconcileCandidate[]>();
  for (const row of (transactions ?? []) as ReconcileCandidate[]) {
    const key = String(row.request_id ?? "");
    if (!key) continue;
    const list = txMap.get(key) ?? [];
    list.push(row);
    txMap.set(key, list);
  }

  const updates = (requests ?? [])
    .map((requestRow: any) => {
      const currentStatus = String(requestRow.status ?? "");
      const currentPaidTransactionId = requestRow.paid_transaction_id ? String(requestRow.paid_transaction_id) : null;
      const next = deriveRequestStatusFromTransactions(
        {
          status: currentStatus as ScbStoredRequest["status"],
          expires_at: String(requestRow.expires_at ?? ""),
        },
        txMap.get(String(requestRow.id)) ?? []
      );

      const nextPaidId = next.paidTransactionId ?? currentPaidTransactionId;
      const nextError = next.status === "paid" ? null : next.errorMessage ?? requestRow.error_message ?? null;

      if (next.status === currentStatus && nextPaidId === currentPaidTransactionId && nextError === (requestRow.error_message ?? null)) {
        return null;
      }

      return supabase
        .from("scb_payment_requests")
        .update({
          status: next.status,
          paid_transaction_id: nextPaidId,
          error_message: nextError,
          updated_at: new Date().toISOString(),
        })
        .eq("id", requestRow.id);
    })
    .filter(Boolean);

  await Promise.all(updates);
}

export async function runScbInquiryForRequest(params: {
  supabase: SupabaseClient;
  scbRequest: ScbStoredRequest;
  source: InquirySource;
  triggeredBy?: string | null;
}) {
  const { supabase, scbRequest, source, triggeredBy = null } = params;

  console.log("[SCB inquiry route:start]", JSON.stringify({
    requestId: scbRequest.id,
    partnerReferenceNo: scbRequest.partner_reference_no,
    orderId: scbRequest.scb_order_id,
    walletId: scbRequest.wallet_id,
    ref1: scbRequest.scb_ref_1,
    ref2: scbRequest.scb_ref_2,
    ref3: scbRequest.scb_ref_3,
    amount: scbRequest.request_amount_total,
    source,
  }));

  const normalized = await inquireMaeManeeTransaction({
    partnerReferenceNo: scbRequest.partner_reference_no,
    orderId: scbRequest.scb_order_id ?? "",
    walletId: scbRequest.wallet_id ?? "",
    ref1: scbRequest.scb_ref_1,
    ref2: scbRequest.scb_ref_2,
    ref3: scbRequest.scb_ref_3,
    createdAt: scbRequest.created_at,
    amount: scbRequest.request_amount_total,
  });

  const { data: existingTransaction } = await supabase
    .from("scb_payment_transactions")
    .select("id, match_status, request_id")
    .eq("transaction_id", normalized.transactionId)
    .maybeSingle();

  if (!normalized.found) {
    await supabase.from("scb_recheck_logs").insert({
      request_id: scbRequest.id,
      transaction_id: null,
      triggered_by: triggeredBy,
      source,
      result_status: normalized.status,
      raw_payload: normalized.rawPayload,
    });

    console.log("[SCB inquiry route:pending]", JSON.stringify({
      requestId: scbRequest.id,
      partnerReferenceNo: scbRequest.partner_reference_no,
    }));

    return { request: scbRequest, inquiry: normalized };
  }

  const nextMatchStatus =
    existingTransaction?.match_status === "ignored"
      ? "ignored"
      : scbRequest.status === "paid" && normalized.status === "success"
        ? "matched"
        : normalized.status === "success"
          ? "matching"
          : existingTransaction?.match_status ?? "unmatched";

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
      match_status: nextMatchStatus,
      raw_payload: normalized.rawPayload,
    }, { onConflict: "transaction_id" })
    .select("id")
    .single();
  if (txError || !transactionRow) throw new Error(txError?.message || "Failed to upsert inquiry transaction.");

  await supabase.from("scb_recheck_logs").insert({
    request_id: scbRequest.id,
    transaction_id: normalized.transactionId,
    triggered_by: triggeredBy,
    source,
    result_status: normalized.status,
    raw_payload: normalized.rawPayload,
  });

  if (normalized.status === "success" && nextMatchStatus !== "ignored") {
    await processMatchedScbTransaction(supabase as any, scbRequest, normalized, transactionRow.id);
  }

  await reconcileScbRequestStatuses(supabase, [scbRequest.id]);

  console.log("[SCB inquiry route:done]", JSON.stringify({
    requestId: scbRequest.id,
    transactionId: normalized.transactionId,
    status: normalized.status,
    found: normalized.found,
  }));

  return { request: scbRequest, inquiry: normalized };
}

export async function runAutoInquiryForPendingRequests(
  supabase: SupabaseClient,
  requests: ScbStoredRequest[]
): Promise<string[]> {
  const candidates = requests.filter((request) => isPendingRequestEligibleForAutoInquiry(request));
  if (candidates.length === 0) return [];

  const requestIds = candidates.map((request) => request.id);
  const { data: logs, error } = await supabase
    .from("scb_recheck_logs")
    .select("request_id, created_at, source")
    .in("request_id", requestIds)
    .eq("source", "scheduled")
    .order("created_at", { ascending: false });
  if (error) throw new Error(error.message);

  const latestScheduledMap = new Map<string, string>();
  for (const row of logs ?? []) {
    const key = String((row as any).request_id ?? "");
    if (!key || latestScheduledMap.has(key)) continue;
    latestScheduledMap.set(key, String((row as any).created_at ?? ""));
  }

  const now = Date.now();
  const due = candidates.filter((request) => {
    const last = latestScheduledMap.get(request.id);
    if (!last) return true;
    const lastMs = new Date(last).getTime();
    if (Number.isNaN(lastMs)) return true;
    return now - lastMs >= 60_000;
  }).slice(0, 10);

  for (const request of due) {
    try {
      await runScbInquiryForRequest({
        supabase,
        scbRequest: request,
        source: "scheduled",
        triggeredBy: null,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.error("[SCB auto-inquiry inline:error]", {
        requestId: request.id,
        message,
      });
      await supabase.from("scb_recheck_logs").insert({
        request_id: request.id,
        transaction_id: null,
        triggered_by: null,
        source: "scheduled",
        result_status: "failed",
        raw_payload: { error: message },
      });
    }
  }

  return due.map((request) => request.id);
}
