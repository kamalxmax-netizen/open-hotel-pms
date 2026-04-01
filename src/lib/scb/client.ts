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
  ref1: string;
  ref2: string;
  ref3: string;
  amount: number;
  partnerMetaData: Record<string, unknown>;
}): Promise<ScbCreateQrResult> {
  const config = getScbConfig();

  if (isScbMockMode()) {
    return {
      orderId: `MOCK-${Date.now()}`,
      partnerReferenceNo: input.partnerReferenceNo,
      walletId: config.merchantId || config.walletId || "MOCK-BILLER",
      amount: input.amount,
      qrPayload: `MOCK:${input.partnerReferenceNo}:${input.amount.toFixed(2)}`,
      qrImageBase64: null,
      qrImageUrl: null,
      ref1: input.ref1,
      ref2: input.ref2,
      ref3: input.ref3,
      rawResponse: {
        mock: true,
        partnerReferenceNo: input.partnerReferenceNo,
        amount: input.amount,
      },
    };
  }

  if (!config.merchantId) {
    throw new Error("SCB merchant id is not configured.");
  }

  const token = await getScbAccessToken();
  console.log("[SCB QR payload]", JSON.stringify({
    qrType: "PP",
    ppType: "BILLERID",
    ppId: config.merchantId,
    amount: input.amount.toFixed(2),
    ref1: input.ref1,
    ref2: input.ref2,
    ref3: input.ref3,
  }));
  const response = await fetch(config.qrCreateUrl, {
    method: "POST",
    headers: withScbHeaders(token),
    body: JSON.stringify({
      qrType: "PP",
      ppType: "BILLERID",
      ppId: config.merchantId,
      amount: input.amount.toFixed(2),
      ref1: input.ref1,
      ref2: input.ref2,
      ref3: input.ref3,
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
    console.error("[SCB error response]", payload ?? rawText);
    const fallbackMessage = rawText?.trim() || `SCB QR create failed (${response.status}).`;
    throw new Error(`SCB QR create failed (${response.status}): ${fallbackMessage}`);
  }
  if (String(payload?.status?.code ?? "") !== "1000") {
    console.error("[SCB error response]", payload);
    const scbCode = String(payload?.status?.code ?? "").trim();
    const scbDescription = String(payload?.status?.description ?? "").trim();
    const suffix = [scbCode, scbDescription].filter(Boolean).join(" - ");
    throw new Error(suffix ? `SCB QR create rejected: ${suffix}` : "SCB QR create failed.");
  }

  const data = toObject(payload.data);
  const qrCode = toObject(data.qrCode ?? data.qrcode ?? data.qr_code);
  const billPayment = toObject(data.billPayment ?? data.bill_payment);
  const payment = toObject(data.payment);
  const qrImageUrl =
    String(qrCode.qrImageUrl ?? qrCode.qrImageURL ?? data.qrImageUrl ?? data.qrImageURL ?? "").trim() || null;
  const qrImageBase64 =
    String(qrCode.qrImage ?? data.qrImage ?? "").trim() || null;
  const qrPayload =
    String(qrCode.qrRawData ?? qrCode.qrData ?? billPayment.qrRawData ?? payment.qrRawData ?? data.qrRawData ?? "").trim() || null;
  const orderId =
    String(data.qrId ?? data.orderId ?? data.transactionId ?? input.partnerReferenceNo).trim();
  const settledMerchantId =
    String(data.ppId ?? data.billerId ?? config.merchantId).trim();

  return {
    orderId,
    partnerReferenceNo: String(data.ref3 ?? data.partnerReferenceNo ?? input.partnerReferenceNo).trim(),
    walletId: settledMerchantId,
    amount: toNumber(data.amount ?? input.amount),
    qrPayload,
    qrImageBase64,
    qrImageUrl,
    ref1: String(data.ref1 ?? input.ref1).trim() || null,
    ref2: String(data.ref2 ?? input.ref2).trim() || null,
    ref3: String(data.ref3 ?? input.ref3).trim() || null,
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
