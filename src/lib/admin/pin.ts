import { createHmac, timingSafeEqual } from "node:crypto";

const RATE_OVERRIDE_SCOPE = "rate_floor_override";
const DEFAULT_OVERRIDE_TTL_SECONDS = 60;

function toBase64Url(input: Buffer | string) {
  return Buffer.from(input)
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/g, "");
}

function fromBase64Url(input: string) {
  const normalized = input.replace(/-/g, "+").replace(/_/g, "/");
  const padding = normalized.length % 4 === 0 ? "" : "=".repeat(4 - (normalized.length % 4));
  return Buffer.from(`${normalized}${padding}`, "base64");
}

function safeEqual(left: string, right: string) {
  const leftBuffer = Buffer.from(left, "utf8");
  const rightBuffer = Buffer.from(right, "utf8");
  if (leftBuffer.length !== rightBuffer.length) return false;
  return timingSafeEqual(leftBuffer, rightBuffer);
}

function getOverridePinSecret() {
  const secret = String(process.env.ADMIN_RATE_OVERRIDE_PIN ?? "").trim();
  if (!secret) {
    throw new Error("ADMIN_RATE_OVERRIDE_PIN is not configured.");
  }
  return secret;
}

function getTokenSigningSecret() {
  const secret =
    String(process.env.SUPABASE_SERVICE_ROLE_KEY ?? "").trim() ||
    String(process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? "").trim() ||
    getOverridePinSecret();
  if (!secret) {
    throw new Error("Missing token signing secret for override token.");
  }
  return secret;
}

export function verifyAdminOverridePin(pin: string) {
  const expected = getOverridePinSecret();
  const provided = String(pin ?? "").trim();
  if (!provided) return false;
  return safeEqual(provided, expected);
}

export function issueRateOverrideToken(userId: string, ttlSeconds = DEFAULT_OVERRIDE_TTL_SECONDS) {
  const payload = {
    sub: String(userId),
    scope: RATE_OVERRIDE_SCOPE,
    exp: Math.floor(Date.now() / 1000) + ttlSeconds,
  };
  const encodedPayload = toBase64Url(JSON.stringify(payload));
  const signature = createHmac("sha256", getTokenSigningSecret()).update(encodedPayload).digest();
  return `${encodedPayload}.${toBase64Url(signature)}`;
}

export function verifyRateOverrideToken(token: string | null | undefined, userId: string | null | undefined) {
  if (!token || !userId) return false;

  const [encodedPayload, encodedSignature] = String(token).split(".");
  if (!encodedPayload || !encodedSignature) return false;

  const expectedSignature = createHmac("sha256", getTokenSigningSecret()).update(encodedPayload).digest();
  const providedSignature = fromBase64Url(encodedSignature);
  if (providedSignature.length !== expectedSignature.length) return false;
  if (!timingSafeEqual(providedSignature, expectedSignature)) return false;

  const payload = JSON.parse(fromBase64Url(encodedPayload).toString("utf8")) as {
    sub?: string;
    scope?: string;
    exp?: number;
  };

  return (
    payload.scope === RATE_OVERRIDE_SCOPE &&
    payload.sub === String(userId) &&
    typeof payload.exp === "number" &&
    payload.exp >= Math.floor(Date.now() / 1000)
  );
}

export const RATE_OVERRIDE_TOKEN_TTL_SECONDS = DEFAULT_OVERRIDE_TTL_SECONDS;
