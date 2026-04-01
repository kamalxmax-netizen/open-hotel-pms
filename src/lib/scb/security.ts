import crypto from "crypto";
import { NextRequest } from "next/server";
import { getScbConfig } from "@/lib/scb/auth";

const callbackRateWindowMs = 60_000;
const callbackRateLimit = 60;
const callbackHits = new Map<string, { count: number; resetAt: number }>();

function timingSafeCompare(left: string, right: string): boolean {
  const leftBuffer = Buffer.from(left);
  const rightBuffer = Buffer.from(right);
  if (leftBuffer.length !== rightBuffer.length) return false;
  return crypto.timingSafeEqual(leftBuffer, rightBuffer);
}

function isIpAllowed(ip: string | null, allowlist: string[]): boolean {
  if (!ip) return false;
  if (allowlist.length === 0) return true;
  return allowlist.includes(ip);
}

function assertRateLimit(key: string): void {
  const now = Date.now();
  const hit = callbackHits.get(key);
  if (!hit || hit.resetAt <= now) {
    callbackHits.set(key, { count: 1, resetAt: now + callbackRateWindowMs });
    return;
  }
  if (hit.count >= callbackRateLimit) {
    throw new Error("SCB callback rate limit exceeded.");
  }
  hit.count += 1;
}

function readHeaderSignature(request: NextRequest, headerNames: string[]): string | null {
  for (const name of headerNames) {
    const value = request.headers.get(name);
    if (value && value.trim().length > 0) return value.trim();
  }
  return null;
}

export function assertScbCallbackSecurity(request: NextRequest, rawBody: string): void {
  const config = getScbConfig();
  const ip = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim()
    ?? request.headers.get("x-real-ip")
    ?? null;

  if (!isIpAllowed(ip, config.callbackAllowedIps)) {
    throw new Error("SCB callback IP not allowed.");
  }

  assertRateLimit(`${ip ?? "unknown"}:${new Date().toISOString().slice(0, 16)}`);

  if (!config.callbackHmacSecret) {
    if (config.callbackAllowInsecureSandbox) return;
    throw new Error("SCB callback signature secret is not configured.");
  }

  const receivedSignature = readHeaderSignature(request, config.callbackSignatureHeaders);
  if (!receivedSignature) {
    throw new Error("SCB callback signature header is missing.");
  }

  const digest = crypto
    .createHmac("sha256", config.callbackHmacSecret)
    .update(rawBody, "utf8")
    .digest();
  const candidates = [
    digest.toString("hex"),
    digest.toString("base64"),
  ];

  const normalizedReceived = receivedSignature.replace(/^sha256=/i, "");
  const valid = candidates.some((candidate) => timingSafeCompare(candidate, normalizedReceived));
  if (!valid) {
    throw new Error("SCB callback signature is invalid.");
  }
}
