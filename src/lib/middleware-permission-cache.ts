import { NextRequest, NextResponse } from "next/server";

const PERMISSION_CACHE_COOKIE = "pms_perm_v1";
const PERMISSION_CACHE_TTL_SECONDS = 10 * 60;

export type MiddlewareAccessProfile = {
  role: string | null;
  allowedPages: string[];
};

type PermissionCachePayload = {
  uid: string;
  role?: string | null;
  allowedPages: string[];
  exp: number;
};

function getSigningSecret(): string | null {
  return process.env.SUPABASE_SERVICE_ROLE_KEY ?? null;
}

function encodeBase64Url(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function decodeBase64Url(value: string): Uint8Array | null {
  const normalized = value.replace(/-/g, "+").replace(/_/g, "/");
  const padding = normalized.length % 4 === 0 ? "" : "=".repeat(4 - (normalized.length % 4));
  try {
    const binary = atob(normalized + padding);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i += 1) {
      bytes[i] = binary.charCodeAt(i);
    }
    return bytes;
  } catch {
    return null;
  }
}

function toArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
}

async function signPayload(payload: string, secret: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  const signature = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(payload));
  return encodeBase64Url(new Uint8Array(signature));
}

async function verifyPayload(payload: string, signature: string, secret: string): Promise<boolean> {
  const signatureBytes = decodeBase64Url(signature);
  if (!signatureBytes) return false;
  const payloadBytes = new TextEncoder().encode(payload);
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["verify"]
  );
  return crypto.subtle.verify("HMAC", key, toArrayBuffer(signatureBytes), toArrayBuffer(payloadBytes));
}

function normalizeAllowedPages(value: unknown): string[] {
  if (!Array.isArray(value)) return ["*"];
  const pages = value
    .map((entry) => String(entry ?? "").trim())
    .filter(Boolean);
  return pages.length > 0 ? Array.from(new Set(pages)) : ["*"];
}

function normalizeRole(value: unknown): string | null {
  const role = String(value ?? "").trim().toLowerCase();
  return role || null;
}

async function readPermissionCachePayload(
  request: NextRequest,
  userId: string
): Promise<PermissionCachePayload | null> {
  const secret = getSigningSecret();
  if (!secret) return null;

  const cookieValue = request.cookies.get(PERMISSION_CACHE_COOKIE)?.value ?? "";
  if (!cookieValue) return null;

  const separatorIndex = cookieValue.lastIndexOf(".");
  if (separatorIndex <= 0) return null;

  const payloadPart = cookieValue.slice(0, separatorIndex);
  const signaturePart = cookieValue.slice(separatorIndex + 1);
  const payloadBytes = decodeBase64Url(payloadPart);
  if (!payloadBytes) return null;

  const payloadJson = new TextDecoder().decode(payloadBytes);
  const isValidSignature = await verifyPayload(payloadJson, signaturePart, secret);
  if (!isValidSignature) return null;

  try {
    const parsed = JSON.parse(payloadJson) as Partial<PermissionCachePayload>;
    if (String(parsed.uid ?? "") !== userId) return null;
    if (!Number.isFinite(parsed.exp) || Number(parsed.exp) <= Date.now()) return null;
    const roleWasCached = Object.prototype.hasOwnProperty.call(parsed, "role");
    return {
      uid: userId,
      role: roleWasCached ? normalizeRole(parsed.role) : undefined,
      allowedPages: normalizeAllowedPages(parsed.allowedPages),
      exp: Number(parsed.exp),
    };
  } catch {
    return null;
  }
}

export async function readCachedAccessProfile(
  request: NextRequest,
  userId: string
): Promise<MiddlewareAccessProfile | null> {
  const payload = await readPermissionCachePayload(request, userId);
  if (!payload) return null;
  if (payload.role === undefined) return null;
  return {
    role: normalizeRole(payload.role),
    allowedPages: normalizeAllowedPages(payload.allowedPages),
  };
}

export async function readPermissionCache(
  request: NextRequest,
  userId: string
): Promise<string[] | null> {
  const payload = await readPermissionCachePayload(request, userId);
  return payload ? normalizeAllowedPages(payload.allowedPages) : null;
}

export async function writeCachedAccessProfile(
  response: NextResponse,
  userId: string,
  profile: MiddlewareAccessProfile
): Promise<void> {
  const secret = getSigningSecret();
  if (!secret) return;

  const normalizedPages = normalizeAllowedPages(profile.allowedPages);
  const payload: PermissionCachePayload = {
    uid: userId,
    role: normalizeRole(profile.role),
    allowedPages: normalizedPages,
    exp: Date.now() + PERMISSION_CACHE_TTL_SECONDS * 1000,
  };
  const payloadJson = JSON.stringify(payload);
  const payloadPart = encodeBase64Url(new TextEncoder().encode(payloadJson));
  const signaturePart = await signPayload(payloadJson, secret);

  response.cookies.set(PERMISSION_CACHE_COOKIE, `${payloadPart}.${signaturePart}`, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: PERMISSION_CACHE_TTL_SECONDS,
  });
}

export async function writePermissionCache(
  response: NextResponse,
  userId: string,
  allowedPages: string[]
): Promise<void> {
  await writeCachedAccessProfile(response, userId, {
    role: null,
    allowedPages,
  });
}

export function clearPermissionCache(response: NextResponse): void {
  response.cookies.set(PERMISSION_CACHE_COOKIE, "", {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 0,
  });
}
