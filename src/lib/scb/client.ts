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

function toArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function formatScbDate(value: string | Date): string {
  const date = typeof value === "string" ? new Date(value) : value;
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Bangkok",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(date);
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
  ref1?: string | null;
  ref2?: string | null;
  ref3?: string | null;
  createdAt?: string | null;
  amount?: number | null;
}): Promise<ScbNormalizedTransaction> {
  const config = getScbConfig();

  if (isScbMockMode()) {
    return {
      found: false,
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
  const transactionDate = formatScbDate(input.createdAt ?? new Date());
  const params = new URLSearchParams({
    eventCode: "00300100",
    transactionDate,
    billerId: input.walletId,
  });
  if (input.ref1) params.set("reference1", input.ref1);
  if (input.ref2) params.set("reference2", input.ref2);
  if (input.amount != null) params.set("amount", Number(input.amount).toFixed(2));
  const inquiryUrl = `${config.inquiryUrl}?${params.toString()}`;

  console.log("[SCB inquiry request]", JSON.stringify({
    inquiryUrl,
    ref1: input.ref1 ?? null,
    ref2: input.ref2 ?? null,
    ref3: input.ref3 ?? input.partnerReferenceNo,
    amount: input.amount ?? null,
  }));

  const response = await fetch(inquiryUrl, {
    method: "GET",
    headers: withScbHeaders(token),
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
    console.error("[SCB inquiry error]", payload ?? rawText);
    throw new Error(`SCB inquiry failed (${response.status}).`);
  }
  if (String(payload?.status?.code ?? "") !== "1000") {
    console.error("[SCB inquiry error]", payload);
    throw new Error(String(payload?.status?.description ?? "SCB inquiry failed."));
  }

  const dataList = toArray(payload.data).map(toObject);
  const requestedRef3 = String(input.ref3 ?? input.partnerReferenceNo ?? "").trim();
  const requestedAmount = input.amount != null ? Number(input.amount) : null;
  const matchedEntry = dataList.find((entry) => {
    const entryRef3 = String(entry.ref3 ?? entry.reference3 ?? "").trim();
    const entryAmount = toNumber(entry.amount ?? entry.paymentAmount ?? entry.transactionAmount);
    if (requestedRef3 && entryRef3 && entryRef3 === requestedRef3) return true;
    if (input.ref1 && String(entry.ref1 ?? entry.reference1 ?? "").trim() !== input.ref1) return false;
    if (input.ref2 && String(entry.ref2 ?? entry.reference2 ?? "").trim() !== input.ref2) return false;
    if (requestedAmount != null && Math.abs(entryAmount - requestedAmount) > 0.0001) return false;
    return Boolean(input.ref1 || input.ref2);
  }) ?? dataList[0] ?? null;

  if (!matchedEntry) {
    console.log("[SCB inquiry result]", JSON.stringify({
      found: false,
      ref1: input.ref1 ?? null,
      ref2: input.ref2 ?? null,
      ref3: requestedRef3 || null,
      amount: requestedAmount,
      count: dataList.length,
    }));
    return {
      found: false,
      transactionId: input.partnerReferenceNo,
      orderId: input.orderId,
      partnerReferenceNo: requestedRef3 || input.partnerReferenceNo,
      amount: requestedAmount ?? 0,
      currency: "THB",
      payerName: null,
      payerAccount: null,
      paymentChannel: "T30",
      status: "pending",
      paidAt: null,
      rawPayload: payload as Record<string, unknown>,
    };
  }

  const statusValue = matchedEntry.statusCode ?? matchedEntry.status ?? matchedEntry.txnStatus ?? "SUCCESS";
  const payerName =
    String(matchedEntry.payerName ?? matchedEntry.customerName ?? matchedEntry.debtorName ?? "").trim() || null;
  const payerAccount =
    String(matchedEntry.payerProxyId ?? matchedEntry.payerAccount ?? matchedEntry.debtorAccount ?? "").trim() || null;
  const paymentDatetime =
    String(
      matchedEntry.transactionDateAndTime
      ?? matchedEntry.transactionDateandTime
      ?? matchedEntry.paymentDateTime
      ?? matchedEntry.transactionDateTime
      ?? ""
    ).trim() || null;
  const transactionId =
    String(matchedEntry.transactionId ?? matchedEntry.transRef ?? matchedEntry.referenceNo ?? input.orderId ?? input.partnerReferenceNo).trim();
  const resolvedAmount = toNumber(matchedEntry.amount ?? matchedEntry.paymentAmount ?? matchedEntry.transactionAmount ?? requestedAmount ?? 0);
  const resolvedRef3 =
    String(matchedEntry.ref3 ?? matchedEntry.reference3 ?? requestedRef3 ?? input.partnerReferenceNo).trim() || null;

  console.log("[SCB inquiry result]", JSON.stringify({
    found: true,
    transactionId,
    ref3: resolvedRef3,
    amount: resolvedAmount,
    status: statusValue,
  }));

  return {
    found: true,
    transactionId: transactionId || `SCB-${String(input.orderId ?? input.partnerReferenceNo)}`,
    orderId: String(input.orderId ?? "").trim() || null,
    partnerReferenceNo: resolvedRef3,
    amount: resolvedAmount,
    currency: "THB",
    payerName,
    payerAccount,
    paymentChannel: "T30",
    status: mapScbPaymentStatus(statusValue),
    paidAt: paymentDatetime,
    rawPayload: payload as Record<string, unknown>,
  };
}
