import { buildScbRequestUId, getScbAccessToken, getScbConfig, isScbMockMode } from "@/lib/scb/auth";
import { mapScbPaymentStatus } from "@/lib/scb/matching";
import type { ScbCreateQrResult, ScbNormalizedTransaction } from "@/lib/scb/types";

function toNumber(value: unknown): number {
  const num = typeof value === "number" ? value : Number(value);
  return Number.isFinite(num) ? num : 0;
}

function toObject(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function withScbHeaders(token: string) {
  const config = getScbConfig();
  return {
    authorization: `Bearer ${token}`,
    "content-type": "application/json",
    "accept-language": config.acceptLanguage,
    resourceOwnerId: config.resourceOwnerId,
    requestUId: buildScbRequestUId(),
  };
}

export async function createMaeManeeQrCode(input: {
  partnerReferenceNo: string;
  amount: number;
  partnerMetaData: Record<string, unknown>;
}): Promise<ScbCreateQrResult> {
  const config = getScbConfig();

  if (isScbMockMode()) {
    return {
      orderId: `MOCK-${Date.now()}`,
      partnerReferenceNo: input.partnerReferenceNo,
      walletId: config.walletId || "MOCK-WALLET",
      amount: input.amount,
      qrPayload: `MOCK:${input.partnerReferenceNo}:${input.amount.toFixed(2)}`,
      qrImageBase64: null,
      ref1: "MOCK-REF1",
      ref2: input.partnerReferenceNo,
      ref3: "MOCK-REF3",
      rawResponse: {
        mock: true,
        partnerReferenceNo: input.partnerReferenceNo,
        amount: input.amount,
      },
    };
  }

  if (!config.walletId) {
    throw new Error("SCB Mae Manee wallet id is not configured.");
  }

  const token = await getScbAccessToken();
  console.log("[SCB QR payload]", JSON.stringify({
    walletId: config.walletId,
    amount: Number(input.amount.toFixed(2)),
    partnerReferenceNo: input.partnerReferenceNo,
    paymentType: ["T30"],
  }));
  const response = await fetch(config.qrCreateUrl, {
    method: "POST",
    headers: withScbHeaders(token),
    body: JSON.stringify({
      partnerReferenceNo: input.partnerReferenceNo,
      walletId: config.walletId,
      paymentType: ["T30"],
      amount: Number(input.amount.toFixed(2)),
      partnerOrderDate: new Date().toISOString(),
      partnerMetaData: input.partnerMetaData,
    }),
  });

  const rawText = await response.text();
  const payload = rawText
    ? (() => {
        try {
          return JSON.parse(rawText);
        } catch {
          return null;
        }
      })()
    : null;
  if (!response.ok || !payload) {
    const fallbackMessage = rawText?.trim() || `SCB QR create failed (${response.status}).`;
    throw new Error(`SCB QR create failed (${response.status}): ${fallbackMessage}`);
  }
  if (String(payload?.status?.code ?? "") !== "1000") {
    const scbCode = String(payload?.status?.code ?? "").trim();
    const scbDescription = String(payload?.status?.description ?? "").trim();
    const suffix = [scbCode, scbDescription].filter(Boolean).join(" - ");
    throw new Error(suffix ? `SCB QR create rejected: ${suffix}` : "SCB QR create failed.");
  }

  const data = toObject(payload.data);
  const tag30 = toObject(data.tag30);

  return {
    orderId: String(data.orderId ?? "").trim(),
    partnerReferenceNo: String(data.partnerReferenceNo ?? input.partnerReferenceNo).trim(),
    walletId: String(data.walletId ?? config.walletId).trim(),
    amount: toNumber(data.amount ?? input.amount),
    qrPayload: typeof tag30.result === "string" ? String(tag30.result) : null,
    qrImageBase64: String(tag30.qrImage ?? "").trim() || null,
    ref1: String(tag30.ref1 ?? "").trim() || null,
    ref2: String(tag30.ref2 ?? "").trim() || null,
    ref3: String(tag30.ref3 ?? "").trim() || null,
    rawResponse: payload as Record<string, unknown>,
  };
}

export async function inquireMaeManeeTransaction(input: {
  partnerReferenceNo: string;
  orderId: string;
  walletId: string;
}): Promise<ScbNormalizedTransaction> {
  const config = getScbConfig();

  if (isScbMockMode()) {
    return {
      transactionId: `MOCK-TXN-${input.orderId}`,
      orderId: input.orderId,
      partnerReferenceNo: input.partnerReferenceNo,
      amount: 0,
      currency: "THB",
      payerName: "Mock Payer",
      payerAccount: "014",
      paymentChannel: "T30",
      status: "pending",
      paidAt: null,
      rawPayload: {
        mock: true,
        orderId: input.orderId,
        partnerReferenceNo: input.partnerReferenceNo,
      },
    };
  }

  const token = await getScbAccessToken();
  const response = await fetch(config.inquiryUrl, {
    method: "POST",
    headers: withScbHeaders(token),
    body: JSON.stringify({
      partnerReferenceNo: input.partnerReferenceNo,
      walletId: input.walletId,
      orderId: input.orderId,
    }),
  });

  const payload = await response.json().catch(() => null);
  if (!response.ok || !payload) {
    throw new Error(`SCB inquiry failed (${response.status}).`);
  }
  if (String(payload?.status?.code ?? "") !== "1000") {
    throw new Error(String(payload?.status?.description ?? "SCB inquiry failed."));
  }

  const transaction = toObject(toObject(payload.data).transaction);
  const t30 = toObject(transaction.t30);
  const paymentInfo = Array.isArray(t30.paymentInfo) ? toObject(t30.paymentInfo[0]) : {};
  const pml = toObject(transaction.pml);
  const qrcs = toObject(transaction.qrcs);

  const statusValue =
    paymentInfo.paymentStatus
    ?? pml.paymentStatus
    ?? qrcs.paymentStatus
    ?? "PENDING";

  const payerName =
    String(paymentInfo.paymentBy ?? pml.paymentBy ?? qrcs.paymentBy ?? "").trim() || null;
  const payerAccount =
    String(paymentInfo.buyerBankCode ?? pml.buyerBankCode ?? "").trim() || null;
  const paymentDatetime =
    String(paymentInfo.paymentDatetime ?? pml.paymentDatetime ?? qrcs.paymentDatetime ?? "").trim() || null;
  const transactionId =
    String(paymentInfo.transactionDisplayId ?? pml.transactionDisplayId ?? qrcs.transactionRef ?? transaction.orderId ?? "").trim();

  return {
    transactionId: transactionId || `SCB-${String(transaction.orderId ?? input.orderId)}`,
    orderId: String(transaction.orderId ?? input.orderId).trim() || null,
    partnerReferenceNo: String(transaction.partnerReferenceNo ?? input.partnerReferenceNo).trim() || null,
    amount: toNumber(transaction.amount),
    currency: "THB",
    payerName,
    payerAccount,
    paymentChannel: t30.ref1 ? "T30" : (pml.webPayLink ? "PML" : "UNKNOWN"),
    status: mapScbPaymentStatus(statusValue),
    paidAt: paymentDatetime,
    rawPayload: payload as Record<string, unknown>,
  };
}
