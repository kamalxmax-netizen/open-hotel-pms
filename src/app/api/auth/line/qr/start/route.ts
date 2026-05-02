import { sanitizePostLoginPath } from "@/lib/auth-routing";
import {
  createLineQrRawToken,
  getLineQrChallengeTtlSeconds,
  getLineQrDesktopCookieName,
  hashLineQrToken,
} from "@/lib/line-login";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { NextRequest, NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const fetchCache = "force-no-store";

export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => null) as { next?: string } | null;
  const next = sanitizePostLoginPath(body?.next);
  const qrToken = createLineQrRawToken();
  const desktopToken = createLineQrRawToken();
  const qrTokenHash = hashLineQrToken(qrToken);
  const desktopTokenHash = hashLineQrToken(desktopToken);
  const expiresAt = new Date(Date.now() + getLineQrChallengeTtlSeconds() * 1000).toISOString();
  const supabase = createServerSupabaseClient();

  const previousDesktopToken = request.cookies.get(getLineQrDesktopCookieName())?.value;
  if (previousDesktopToken) {
    await supabase
      .from("line_login_qr_challenges")
      .update({ status: "cancelled", cancelled_at: new Date().toISOString() })
      .eq("desktop_token_hash", hashLineQrToken(previousDesktopToken))
      .eq("status", "pending");
  }

  const { error } = await supabase.from("line_login_qr_challenges").insert({
    qr_token_hash: qrTokenHash,
    desktop_token_hash: desktopTokenHash,
    next_path: next,
    expires_at: expiresAt,
  });
  if (error) {
    console.error("LINE QR challenge create failed", error);
    return NextResponse.json({ success: false, error: "create_failed" }, { status: 500 });
  }

  const qrUrl = new URL("/api/auth/line/qr/mobile/start", request.url);
  qrUrl.searchParams.set("token", qrToken);

  const response = NextResponse.json({
    success: true,
    qrUrl: qrUrl.toString(),
    expiresAt,
    pollIntervalMs: 2000,
  });
  response.cookies.set(getLineQrDesktopCookieName(), desktopToken, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: getLineQrChallengeTtlSeconds(),
  });
  return response;
}
