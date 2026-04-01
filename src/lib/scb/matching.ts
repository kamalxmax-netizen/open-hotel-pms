import type { SupabaseClient } from "@supabase/supabase-js";
import type { ScbCallbackIdentifiers, ScbReferenceBundle, ScbStoredRequest, ScbTransactionStatus } from "@/lib/scb/types";

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
      data.transactionId,
      data.transaction_id,
      transaction.transactionDisplayId,
      transaction.transactionRef,
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
      root.partnerReferenceNo,
      root.partner_reference_no,
      data.partnerReferenceNo,
      data.partner_reference_no,
      transaction.partnerReferenceNo,
      transaction.partner_reference_no
    ),
  };
}

export async function loadScbRequestByReference(
  supabase: SupabaseClient,
  identifiers: ScbCallbackIdentifiers
): Promise<ScbStoredRequest | null> {
  if (identifiers.partnerReferenceNo) {
    const byRef = await supabase
      .from("scb_payment_requests")
      .select("*")
      .eq("partner_reference_no", identifiers.partnerReferenceNo)
      .maybeSingle();
    if (byRef.error) throw new Error(byRef.error.message);
    if (byRef.data) return byRef.data as ScbStoredRequest;
  }

  if (identifiers.orderId) {
    const byOrder = await supabase
      .from("scb_payment_requests")
      .select("*")
      .eq("scb_order_id", identifiers.orderId)
      .maybeSingle();
    if (byOrder.error) throw new Error(byOrder.error.message);
    if (byOrder.data) return byOrder.data as ScbStoredRequest;
  }

  return null;
}

export function mapScbPaymentStatus(raw: unknown): ScbTransactionStatus {
  const value = String(raw ?? "").trim().toUpperCase();
  if (value === "PAID" || value === "SUCCESS") return "success";
  if (value === "FAILED" || value === "CANCEL") return "failed";
  if (value === "EXPIRED") return "expired";
  return "pending";
}
