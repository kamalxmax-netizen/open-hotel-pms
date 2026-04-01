import type { ScbStoredRequest } from "@/lib/scb/types";

export function getScbQrImageUrl(request: Pick<ScbStoredRequest, "qr_image_base64">): string | null {
  const raw = String(request.qr_image_base64 ?? "").trim();
  if (!raw) return null;
  if (raw.startsWith("data:")) return raw;
  return `data:image/png;base64,${raw}`;
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
