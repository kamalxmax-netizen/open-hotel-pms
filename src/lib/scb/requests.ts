import crypto from "crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createMaeManeeQrCode } from "@/lib/scb/client";
import { assertNoActivePendingRequest, buildScbReferenceBundle, expireStalePendingRequestsForTarget } from "@/lib/scb/matching";
import { loadPosMetaMap, loadReservationMetaMap } from "@/lib/scb/targets";
import type { ScbCreateRequestInput, ScbStoredRequest } from "@/lib/scb/types";

function toIsoWithOffset(date = new Date()): string {
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
  return `${values.year}-${values.month}-${values.day}T${values.hour}:${values.minute}:${values.second}.000+07:00`;
}

function addMinutes(date: Date, minutes: number): Date {
  return new Date(date.getTime() + minutes * 60_000);
}

export async function createScbPaymentRequest(
  supabase: SupabaseClient,
  input: ScbCreateRequestInput
): Promise<ScbStoredRequest> {
  const roomAmount = Number(input.roomAmount ?? 0);
  const depositAmount = Number(input.depositAmount ?? 0);
  const total = Number((roomAmount + depositAmount).toFixed(2));
  if (!Number.isFinite(total) || total <= 0) {
    throw new Error("SCB request total must be greater than 0.");
  }

  const expiresMinutes = Number.isFinite(input.expiresMinutes) ? Math.max(1, Math.min(240, Number(input.expiresMinutes))) : 30;
  const now = new Date();
  const requestId = crypto.randomUUID();
  const expiresAt = addMinutes(now, expiresMinutes).toISOString();
  const autoInquiryAfterExpiryAt = addMinutes(new Date(expiresAt), 5).toISOString();

  await expireStalePendingRequestsForTarget(supabase, input.targetType, input.targetId);
  await assertNoActivePendingRequest(supabase, input.targetType, input.targetId);

  const targetCode =
    input.targetType === "reservation"
      ? (await loadReservationMetaMap(supabase, [input.targetId])).get(String(input.targetId))?.code
      : (await loadPosMetaMap(supabase, [input.targetId])).get(String(input.targetId))?.code;
  const refs = buildScbReferenceBundle({
    targetType: input.targetType,
    targetId: input.targetId,
    targetCode,
    requestId,
    now,
  });

  const requestPayload = {
    targetType: input.targetType,
    targetId: input.targetId,
    channel: input.channel,
    mode: input.mode,
    roomAmount,
    depositAmount,
    total,
    expiresMinutes,
    ref1: refs.ref1,
    ref2: refs.ref2,
    ref3: refs.ref3,
    partnerMetaData: input.partnerMetaData ?? {},
  };

  const { data: inserted, error: insertError } = await supabase
    .from("scb_payment_requests")
    .insert({
      id: requestId,
      target_type: input.targetType,
      target_id: input.targetId,
      channel: input.channel,
      mode: input.mode,
      request_amount_total: total,
      room_amount: roomAmount,
      deposit_amount: depositAmount,
      status: "pending",
      partner_reference_no: refs.partnerReferenceNo,
      scb_ref_1: refs.ref1,
      scb_ref_2: refs.ref2,
      scb_ref_3: refs.ref3,
      request_payload: requestPayload,
      expires_at: expiresAt,
      auto_inquiry_after_expiry_at: autoInquiryAfterExpiryAt,
      created_by: input.createdBy ?? null,
    })
    .select("*")
    .single();

  if (insertError || !inserted) {
    throw new Error(insertError?.message || "Failed to create SCB payment request.");
  }

  try {
    const qr = await createMaeManeeQrCode({
      partnerReferenceNo: refs.partnerReferenceNo,
      ref1: refs.ref1,
      ref2: refs.ref2,
      ref3: refs.ref3,
      amount: total,
      partnerMetaData: {
        targetType: input.targetType,
        targetId: input.targetId,
        channel: input.channel,
        mode: input.mode,
        roomAmount,
        depositAmount,
        expiresAt,
        ...requestPayload.partnerMetaData,
      },
    });

    const { data: updated, error: updateError } = await supabase
      .from("scb_payment_requests")
      .update({
        scb_order_id: qr.orderId,
        wallet_id: qr.walletId,
        scb_ref_1: qr.ref1,
        scb_ref_2: qr.ref2,
        scb_ref_3: qr.ref3,
        qr_payload: qr.qrPayload,
        qr_image_base64: qr.qrImageBase64,
        provider_raw_response: qr.rawResponse,
        updated_at: new Date().toISOString(),
      })
      .eq("id", inserted.id)
      .select("*")
      .single();

    if (updateError || !updated) {
      throw new Error(updateError?.message || "Failed to update SCB request after QR creation.");
    }

    return updated as ScbStoredRequest;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await supabase
      .from("scb_payment_requests")
      .update({
        status: "failed",
        error_message: message,
        updated_at: new Date().toISOString(),
      })
      .eq("id", inserted.id);
    throw error;
  }
}
