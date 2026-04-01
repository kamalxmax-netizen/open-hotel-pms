import type { ScbStoredRequest } from "@/lib/scb/types";

function toObject(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

export function getScbQrImageUrl(request: Pick<ScbStoredRequest, "qr_image_base64" | "provider_raw_response">): string | null {
  const raw = String(request.qr_image_base64 ?? "").trim();
  if (raw) {
    if (raw.startsWith("data:")) return raw;
    if (/^https?:\/\//i.test(raw)) return raw;
    return `data:image/png;base64,${raw}`;
  }

  const provider = toObject(request.provider_raw_response);
  const data = toObject(provider.data);
  const qrCode = toObject(data.qrCode ?? data.qrcode ?? data.qr_code);
  const url = String(qrCode.qrImageUrl ?? qrCode.qrImageURL ?? data.qrImageUrl ?? data.qrImageURL ?? "").trim();
  return url || null;
}

export function serializeScbRequest<T extends ScbStoredRequest>(request: T): T & { qr_image_url: string | null } {
  return {
    ...request,
    qr_image_url: getScbQrImageUrl(request),
  };
}

export function almostEqualMoney(a: number, b: number): boolean {
  return Math.abs(Number(a || 0) - Number(b || 0)) <= 0.009;
}
