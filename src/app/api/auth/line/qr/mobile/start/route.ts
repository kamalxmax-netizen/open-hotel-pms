import { createLineLoginState, getLineLoginConfig, getLineLoginStateCookieName, getLineLoginStateTtlSeconds, hashLineQrToken } from "@/lib/line-login";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { NextRequest, NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const fetchCache = "force-no-store";

type ChallengeRow = {
  id: string;
  status: string;
  next_path: string;
  expires_at: string;
};

export async function GET(request: NextRequest) {
  const config = getLineLoginConfig();
  if (!config.configured) {
    return mobileHtmlResponse("LINE Login ยังไม่ได้ตั้งค่า", "กรุณาติดต่อ Admin");
  }

  const token = request.nextUrl.searchParams.get("token");
  if (!token) {
    return mobileHtmlResponse("QR Login ไม่สมบูรณ์", "กรุณากลับไปสร้าง QR ใหม่ที่หน้า Login");
  }

  const qrTokenHash = hashLineQrToken(token);
  const supabase = createServerSupabaseClient();
  const { data: challenge, error } = await supabase
    .from("line_login_qr_challenges")
    .select("id, status, next_path, expires_at")
    .eq("qr_token_hash", qrTokenHash)
    .maybeSingle<ChallengeRow>();

  if (error) throw new Error(error.message);
  if (!challenge || challenge.status !== "pending" || new Date(challenge.expires_at).getTime() <= Date.now()) {
    if (challenge?.id && challenge.status === "pending") {
      await supabase
        .from("line_login_qr_challenges")
        .update({ status: "expired" })
        .eq("id", challenge.id)
        .eq("status", "pending");
    }
    return mobileHtmlResponse("QR หมดอายุแล้ว", "กรุณากลับไปที่หน้า Login แล้วสร้าง QR ใหม่");
  }

  const { state, cookieValue } = createLineLoginState(challenge.next_path, {
    mode: "qr_mobile",
    challenge_id: challenge.id,
    qr_token_hash: qrTokenHash,
  });
  const redirectUri = new URL("/api/auth/line/callback", request.url).toString();
  const authorizationUrl = new URL("https://access.line.me/oauth2/v2.1/authorize");

  authorizationUrl.searchParams.set("response_type", "code");
  authorizationUrl.searchParams.set("client_id", config.channelId);
  authorizationUrl.searchParams.set("redirect_uri", redirectUri);
  authorizationUrl.searchParams.set("state", state);
  authorizationUrl.searchParams.set("scope", "profile");
  authorizationUrl.searchParams.set("prompt", "login");

  const response = NextResponse.redirect(authorizationUrl);
  response.cookies.set(getLineLoginStateCookieName(), cookieValue, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: getLineLoginStateTtlSeconds(),
  });
  return response;
}

function mobileHtmlResponse(title: string, body: string) {
  return new NextResponse(
    `<!doctype html>
<html lang="th">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>${escapeHtml(title)}</title>
  <style>
    body{margin:0;min-height:100vh;display:flex;align-items:center;justify-content:center;background:#1B4038;color:#0f172a;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;padding:24px}
    main{width:100%;max-width:360px;background:white;border-radius:20px;padding:28px 24px;text-align:center;box-shadow:0 24px 70px rgba(0,0,0,.28)}
    h1{font-size:22px;margin:0 0 10px}
    p{font-size:15px;line-height:1.55;color:#475569;margin:0}
  </style>
</head>
<body>
  <main>
    <h1>${escapeHtml(title)}</h1>
    <p>${escapeHtml(body)}</p>
  </main>
</body>
</html>`,
    { headers: { "Content-Type": "text/html; charset=utf-8" } }
  );
}

function escapeHtml(value: string) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}
