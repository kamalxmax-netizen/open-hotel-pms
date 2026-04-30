import { createHmac, randomBytes, timingSafeEqual } from "crypto";

const STATE_COOKIE_NAME = "pms_line_login_state";
const STATE_TTL_SECONDS = 10 * 60;

type LineLoginStatePayload = {
  state: string;
  next: string;
  created_at: number;
};

export type LineLoginProfile = {
  userId: string;
  displayName?: string;
  pictureUrl?: string;
};

export function getLineLoginConfig() {
  const channelId = process.env.LINE_LOGIN_CHANNEL_ID ?? "";
  const channelSecret = process.env.LINE_LOGIN_CHANNEL_SECRET ?? "";
  return {
    channelId,
    channelSecret,
    configured: Boolean(channelId && channelSecret),
  };
}

export function getLineLoginStateCookieName() {
  return STATE_COOKIE_NAME;
}

export function getLineLoginStateTtlSeconds() {
  return STATE_TTL_SECONDS;
}

export function createLineLoginState(next: string) {
  const payload: LineLoginStatePayload = {
    state: randomBytes(24).toString("base64url"),
    next,
    created_at: Date.now(),
  };
  return {
    state: payload.state,
    cookieValue: signLineLoginState(payload),
  };
}

export function readLineLoginState(cookieValue: string | undefined): LineLoginStatePayload | null {
  if (!cookieValue) return null;
  const [encodedPayload, signature] = cookieValue.split(".");
  if (!encodedPayload || !signature) return null;

  const expectedSignature = signValue(encodedPayload);
  if (!safeEqual(signature, expectedSignature)) return null;

  try {
    const payload = JSON.parse(Buffer.from(encodedPayload, "base64url").toString("utf8")) as LineLoginStatePayload;
    if (!payload.state || typeof payload.next !== "string" || typeof payload.created_at !== "number") return null;
    if (Date.now() - payload.created_at > STATE_TTL_SECONDS * 1000) return null;
    return payload;
  } catch {
    return null;
  }
}

export async function exchangeLineCodeForAccessToken(params: {
  code: string;
  redirectUri: string;
}): Promise<string> {
  const config = getLineLoginConfig();
  if (!config.configured) {
    throw new Error("LINE Login is not configured.");
  }

  const response = await fetch("https://api.line.me/oauth2/v2.1/token", {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: new URLSearchParams({
      grant_type: "authorization_code",
      code: params.code,
      redirect_uri: params.redirectUri,
      client_id: config.channelId,
      client_secret: config.channelSecret,
    }),
    cache: "no-store",
  });

  const data = await response.json().catch(() => null) as { access_token?: string; error_description?: string } | null;
  if (!response.ok || !data?.access_token) {
    throw new Error(data?.error_description || "LINE token exchange failed.");
  }
  return data.access_token;
}

export async function getLineLoginProfile(accessToken: string): Promise<LineLoginProfile> {
  const response = await fetch("https://api.line.me/v2/profile", {
    headers: {
      Authorization: `Bearer ${accessToken}`,
    },
    cache: "no-store",
  });

  const data = await response.json().catch(() => null) as LineLoginProfile | null;
  if (!response.ok || !data?.userId) {
    throw new Error("LINE profile lookup failed.");
  }
  return data;
}

function signLineLoginState(payload: LineLoginStatePayload): string {
  const encodedPayload = Buffer.from(JSON.stringify(payload), "utf8").toString("base64url");
  return `${encodedPayload}.${signValue(encodedPayload)}`;
}

function signValue(value: string): string {
  return createHmac("sha256", getStateSecret()).update(value).digest("base64url");
}

function getStateSecret(): string {
  const secret =
    process.env.LINE_LOGIN_STATE_SECRET ||
    process.env.SUPABASE_SERVICE_ROLE_KEY ||
    process.env.LINE_LOGIN_CHANNEL_SECRET ||
    "";
  if (!secret) {
    throw new Error("Missing LINE_LOGIN_STATE_SECRET or a server-side fallback secret.");
  }
  return secret;
}

function safeEqual(a: string, b: string): boolean {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  if (left.length !== right.length) return false;
  return timingSafeEqual(left, right);
}
