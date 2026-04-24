import type { SupabaseClient } from "@supabase/supabase-js";
import type { ScbCallbackIdentifiers, ScbReferenceBundle, ScbStoredRequest, ScbTransactionStatus } from "@/lib/scb/types";

const SCB_PAYMENT_REQUEST_SELECT =
  "id, target_type, target_id, channel, mode, request_amount_total, room_amount, deposit_amount, status, partner_reference_no, scb_order_id, wallet_id, scb_ref_1, scb_ref_2, scb_ref_3, qr_payload, qr_image_base64, request_payload, provider_raw_response, error_message, expires_at, auto_inquiry_after_expiry_at, paid_transaction_id, created_by, created_at, updated_at";

function toPlainObject(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function sanitizeAlphaNum(value: string, maxLength: number): string {
  return String(value ?? "")
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, "")
    .slice(0, maxLength);
}

function bangkokTimestamp(date = new Date()): string {
  const formatter = new Intl.DateTimeFormat("sv-SE", {
    timeZone: "Asia/Bangkok",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  });
  const parts = formatter.formatToParts(date);
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${values.year}${values.month}${values.day}${values.hour}${values.minute}${values.second}`;
}

export function buildScbReferenceBundle(input: {
  targetType: "reservation" | "pos_order";
  targetId: string;
  targetCode?: string | null;
  requestId: string;
  now?: Date;
}): ScbReferenceBundle {
  const prefix = String(process.env.SCB_REFERENCE3_PREFIX ?? "UGY")
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, "")
    .slice(0, 3) || "UGY";
  const typeCode = input.targetType === "reservation" ? "R" : "P";
  const fallbackTarget = `${typeCode}${sanitizeAlphaNum(input.targetId, 19) || "UNKNOWN"}`;
  const ref1 = sanitizeAlphaNum(input.targetCode || "", 20) || fallbackTarget.slice(0, 20);
  const requestSeed = sanitizeAlphaNum(input.requestId, 8) || "00000000";
  const ref2 = `REQ${requestSeed}`.slice(0, 20);
  const uniqueSuffix = requestSeed.slice(-3) || "000";
  const ref3 = `${prefix}${bangkokTimestamp(input.now)}${uniqueSuffix}`.slice(0, 20);
  return {
    ref1,
    ref2,
    ref3,
    partnerReferenceNo: ref3,
  };
}

export async function expireStalePendingRequestsForTarget(
  supabase: SupabaseClient,
  targetType: "reservation" | "pos_order",
  targetId: string
): Promise<void> {
  await supabase
    .from("scb_payment_requests")
    .update({ status: "expired", updated_at: new Date().toISOString() })
    .eq("target_type", targetType)
    .eq("target_id", targetId)
    .eq("status", "pending")
    .lt("expires_at", new Date().toISOString());
}

export async function assertNoActivePendingRequest(
  supabase: SupabaseClient,
  targetType: "reservation" | "pos_order",
  targetId: string
): Promise<void> {
  const data = await getActivePendingRequestForTarget(supabase, targetType, targetId);
  if (data?.id) {
    throw new Error(`Pending SCB QR already exists for this target (${String(data.partner_reference_no)}).`);
  }
}

export async function getActivePendingRequestForTarget(
  supabase: SupabaseClient,
  targetType: "reservation" | "pos_order",
  targetId: string
) {
  const { data, error } = await supabase
    .from("scb_payment_requests")
    .select("id, partner_reference_no, expires_at")
    .eq("target_type", targetType)
    .eq("target_id", targetId)
    .eq("status", "pending")
    .gte("expires_at", new Date().toISOString())
    .maybeSingle();

  if (error) throw new Error(error.message);
  return data;
}

export function extractScbCallbackIdentifiers(payload: unknown): ScbCallbackIdentifiers {
  const root = toPlainObject(payload);
  const data = toPlainObject(root.data);
  const transaction = toPlainObject(data.transaction);
  const billPayment = toPlainObject(data.billPayment ?? data.bill_payment);
  const payment = toPlainObject(data.payment);
  const supplementaryData = toPlainObject(transaction.supplementaryData);
  const envelope = toPlainObject(supplementaryData.envelope);
  const additionalData = toPlainObject(envelope.additionalData);

  const pick = (...values: unknown[]): string | null => {
    for (const value of values) {
      const text = String(value ?? "").trim();
      if (text) return text;
    }
    return null;
  };

  return {
    transactionId: pick(
      root.transactionId,
      root.transaction_id,
      root.transRef,
      data.transactionId,
      data.transaction_id,
      data.transRef,
      billPayment.transRef,
      payment.transRef,
      transaction.transactionDisplayId,
      transaction.transactionRef,
      transaction.clearingSystemReference,
      transaction.orderId
    ),
    orderId: pick(
      root.orderId,
      root.order_id,
      data.orderId,
      data.order_id,
      transaction.orderId
    ),
    partnerReferenceNo: pick(
      root.ref3,
      root.billReference3,
      root.partnerReferenceNo,
      root.partner_reference_no,
      data.ref3,
      data.billReference3,
      data.partnerReferenceNo,
      data.partner_reference_no,
      billPayment.ref3,
      billPayment.billReference3,
      payment.ref3,
      additionalData.billReference3,
      transaction.partnerReferenceNo,
      transaction.partner_reference_no
    ),
    ref1: pick(
      root.ref1,
      root.billReference1,
      data.ref1,
      data.billReference1,
      billPayment.ref1,
      billPayment.billReference1,
      payment.ref1,
      additionalData.billReference1
    ),
    ref2: pick(
      root.ref2,
      root.billReference2,
      data.ref2,
      data.billReference2,
      billPayment.ref2,
      billPayment.billReference2,
      payment.ref2,
      additionalData.billReference2
    ),
    ref3: pick(
      root.ref3,
      root.billReference3,
      data.ref3,
      data.billReference3,
      billPayment.ref3,
      billPayment.billReference3,
      payment.ref3,
      additionalData.billReference3
    ),
  };
}

export async function loadScbRequestByReference(
  supabase: SupabaseClient,
  identifiers: ScbCallbackIdentifiers,
  amount?: number | null
): Promise<ScbStoredRequest | null> {
  const primaryRef = identifiers.ref3 || identifiers.partnerReferenceNo;

  if (primaryRef) {
    const byRef = await supabase
      .from("scb_payment_requests")
      .select(SCB_PAYMENT_REQUEST_SELECT)
      .eq("scb_ref_3", primaryRef)
      .maybeSingle();
    if (byRef.error) throw new Error(byRef.error.message);
    if (byRef.data) return byRef.data as ScbStoredRequest;
  }

  if (identifiers.ref2) {
    const byRef2 = await supabase
      .from("scb_payment_requests")
      .select(SCB_PAYMENT_REQUEST_SELECT)
      .eq("scb_ref_2", identifiers.ref2)
      .maybeSingle();
    if (byRef2.error) throw new Error(byRef2.error.message);
    if (byRef2.data) return byRef2.data as ScbStoredRequest;
  }

  if (identifiers.ref1) {
    let byRef1Query = supabase
      .from("scb_payment_requests")
      .select(SCB_PAYMENT_REQUEST_SELECT)
      .eq("scb_ref_1", identifiers.ref1)
      .eq("status", "pending")
      .order("created_at", { ascending: false });
    if (typeof amount === "number" && Number.isFinite(amount)) {
      byRef1Query = byRef1Query.eq("request_amount_total", Number(amount.toFixed(2)));
    }
    const byRef1 = await byRef1Query.limit(1).maybeSingle();
    if (byRef1.error) throw new Error(byRef1.error.message);
    if (byRef1.data) return byRef1.data as ScbStoredRequest;
  }

  if (identifiers.orderId) {
    const byOrder = await supabase
      .from("scb_payment_requests")
      .select(SCB_PAYMENT_REQUEST_SELECT)
      .eq("scb_order_id", identifiers.orderId)
      .maybeSingle();
    if (byOrder.error) throw new Error(byOrder.error.message);
    if (byOrder.data) return byOrder.data as ScbStoredRequest;
  }

  return null;
}

export function mapScbPaymentStatus(raw: unknown): ScbTransactionStatus {
  const value = String(raw ?? "").trim().toUpperCase();
  if (value === "PAID" || value === "SUCCESS" || value === "ACCC" || value === "ACSC") return "success";
  if (value === "FAILED" || value === "CANCEL") return "failed";
  if (value === "RJCT" || value === "CANC") return "failed";
  if (value === "EXPIRED") return "expired";
  return "pending";
}
