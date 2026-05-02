import { resolveRoleAwarePostLoginPath } from "@/lib/auth-routing";
import { AuthSessionError, createSupabaseSessionForUser } from "@/lib/auth-session";
import {
  exchangeLineCodeForAccessToken,
  getLineLoginProfile,
  getLineLoginStateCookieName,
  readLineLoginState,
  revokeLineLoginAccessToken,
} from "@/lib/line-login";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { NextRequest, NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const fetchCache = "force-no-store";

type StaffLineLoginRow = {
  id: string;
  display_name: string | null;
  profiles?: { role: string | null } | null;
};

type LineQrChallengeRow = {
  id: string;
  status: string;
  expires_at: string;
};

export async function GET(request: NextRequest) {
  const loginUrl = new URL("/login", request.url);
  const code = request.nextUrl.searchParams.get("code");
  const state = request.nextUrl.searchParams.get("state");
  const savedState = readLineLoginState(request.cookies.get(getLineLoginStateCookieName())?.value);

  if (!code || !state || !savedState || savedState.state !== state) {
    loginUrl.searchParams.set("line_error", "state");
    return clearStateCookie(NextResponse.redirect(loginUrl));
  }

  try {
    const redirectUri = new URL("/api/auth/line/callback", request.url).toString();
    const accessToken = await exchangeLineCodeForAccessToken({ code, redirectUri });
    const lineProfile = await getLineLoginProfile(accessToken);
    await revokeLineLoginAccessToken(accessToken).catch(() => undefined);

    if (savedState.mode === "qr_mobile") {
      return clearStateCookie(await handleQrMobileCallback(request, savedState, lineProfile));
    }

    const adminSupabase = createServerSupabaseClient();

    const { data: staffRow, error: staffError } = await adminSupabase
      .from("staff")
      .select("id, display_name, profiles:profiles!staff_id_fkey(role)")
      .eq("line_user_id", lineProfile.userId)
      .eq("is_active", true)
      .maybeSingle<StaffLineLoginRow>();

    if (staffError) throw new Error(staffError.message);
    if (!staffRow?.id) {
      loginUrl.searchParams.set("line_error", "not_bound");
      return clearStateCookie(NextResponse.redirect(loginUrl));
    }

    const destination = resolveRoleAwarePostLoginPath(savedState.next, staffRow.profiles?.role);
    const response = clearStateCookie(NextResponse.redirect(new URL(destination, request.url)));
    await createSupabaseSessionForUser({ request, response, userId: staffRow.id });

    await adminSupabase
      .from("staff")
      .update({
        line_display_name: lineProfile.displayName ?? null,
        line_picture_url: lineProfile.pictureUrl ?? null,
        line_bound_at: new Date().toISOString(),
      })
      .eq("id", staffRow.id);

    return response;
  } catch (error) {
    console.error("LINE login callback failed", error);
    loginUrl.searchParams.set("line_error", error instanceof AuthSessionError && error.code === "no_email" ? "no_email" : "callback");
    return clearStateCookie(NextResponse.redirect(loginUrl));
  }
}

async function handleQrMobileCallback(
  request: NextRequest,
  savedState: NonNullable<ReturnType<typeof readLineLoginState>>,
  lineProfile: Awaited<ReturnType<typeof getLineLoginProfile>>
) {
  const adminSupabase = createServerSupabaseClient();
  const nowIso = new Date().toISOString();
  const challengeId = savedState.challenge_id;
  const qrTokenHash = savedState.qr_token_hash;

  if (!challengeId || !qrTokenHash) {
    return mobileHtmlResponse("error", "QR Login ไม่สมบูรณ์", "กรุณากลับไปสร้าง QR ใหม่ที่หน้า Login");
  }

  const { data: challenge, error: challengeError } = await adminSupabase
    .from("line_login_qr_challenges")
    .select("id, status, expires_at")
    .eq("id", challengeId)
    .eq("qr_token_hash", qrTokenHash)
    .maybeSingle<LineQrChallengeRow>();

  if (challengeError) throw new Error(challengeError.message);
  if (!challenge || challenge.status !== "pending" || new Date(challenge.expires_at).getTime() <= Date.now()) {
    if (challenge?.id && challenge.status === "pending") {
      await adminSupabase
        .from("line_login_qr_challenges")
        .update({ status: "expired" })
        .eq("id", challenge.id)
        .eq("status", "pending");
    }
    return mobileHtmlResponse("expired", "QR หมดอายุแล้ว", "กรุณากลับไปที่หน้า Login แล้วสร้าง QR ใหม่");
  }

  const { data: staffRow, error: staffError } = await adminSupabase
    .from("staff")
    .select("id, display_name, profiles:profiles!staff_id_fkey(role)")
    .eq("line_user_id", lineProfile.userId)
    .eq("is_active", true)
    .maybeSingle<StaffLineLoginRow>();

  if (staffError) throw new Error(staffError.message);
  if (!staffRow?.id) {
    await adminSupabase
      .from("line_login_qr_challenges")
      .update({
        status: "failed",
        failure_reason: "not_bound",
        line_user_id: lineProfile.userId,
        line_display_name: lineProfile.displayName ?? null,
        line_picture_url: lineProfile.pictureUrl ?? null,
      })
      .eq("id", challenge.id)
      .eq("status", "pending");
    return mobileHtmlResponse("error", "LINE นี้ยังไม่ได้ผูก Staff", "กรุณาติดต่อ Admin หรือใช้ LINE account ที่ bind ไว้แล้ว");
  }

  const { data: confirmedChallenge, error: confirmError } = await adminSupabase
    .from("line_login_qr_challenges")
    .update({
      status: "confirmed",
      staff_id: staffRow.id,
      line_user_id: lineProfile.userId,
      line_display_name: lineProfile.displayName ?? null,
      line_picture_url: lineProfile.pictureUrl ?? null,
      confirmed_at: nowIso,
      failure_reason: null,
    })
    .eq("id", challenge.id)
    .eq("status", "pending")
    .gt("expires_at", nowIso)
    .select("id")
    .maybeSingle();

  if (confirmError) throw new Error(confirmError.message);
  if (!confirmedChallenge?.id) {
    return mobileHtmlResponse("expired", "QR นี้ถูกใช้หรือหมดอายุแล้ว", "กรุณากลับไปที่หน้า Login แล้วสร้าง QR ใหม่");
  }

  await adminSupabase
    .from("staff")
    .update({
      line_display_name: lineProfile.displayName ?? null,
      line_picture_url: lineProfile.pictureUrl ?? null,
      line_bound_at: nowIso,
    })
    .eq("id", staffRow.id);

  return mobileHtmlResponse("success", "ยืนยันสำเร็จ", "กลับไปที่คอมหน้าเคาน์เตอร์ได้เลย ระบบกำลังเข้าสู่ PMS");
}

function clearStateCookie(response: NextResponse) {
  response.cookies.set(getLineLoginStateCookieName(), "", {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 0,
  });
  return response;
}

function mobileHtmlResponse(status: "success" | "expired" | "error", title: string, body: string) {
  const color = status === "success" ? "#06C755" : status === "expired" ? "#d97706" : "#dc2626";
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
    .mark{width:56px;height:56px;border-radius:999px;background:${color};color:white;display:flex;align-items:center;justify-content:center;margin:0 auto 18px;font-size:28px;font-weight:800}
    h1{font-size:22px;margin:0 0 10px}
    p{font-size:15px;line-height:1.55;color:#475569;margin:0}
  </style>
</head>
<body>
  <main>
    <div class="mark">${status === "success" ? "✓" : "!"}</div>
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
