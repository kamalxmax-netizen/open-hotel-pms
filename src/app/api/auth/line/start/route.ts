import { createLineLoginState, getLineLoginConfig, getLineLoginStateCookieName, getLineLoginStateTtlSeconds } from "@/lib/line-login";
import { sanitizePostLoginPath } from "@/lib/auth-routing";
import { NextRequest, NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const fetchCache = "force-no-store";

export async function GET(request: NextRequest) {
  const config = getLineLoginConfig();
  if (!config.configured) {
    return NextResponse.redirect(new URL("/login?line_error=config", request.url));
  }

  const next = sanitizePostLoginPath(request.nextUrl.searchParams.get("next"));
  const { state, cookieValue } = createLineLoginState(next);
  const redirectUri = new URL("/api/auth/line/callback", request.url).toString();
  const authorizationUrl = new URL("https://access.line.me/oauth2/v2.1/authorize");

  authorizationUrl.searchParams.set("response_type", "code");
  authorizationUrl.searchParams.set("client_id", config.channelId);
  authorizationUrl.searchParams.set("redirect_uri", redirectUri);
  authorizationUrl.searchParams.set("state", state);
  authorizationUrl.searchParams.set("scope", "profile");
  authorizationUrl.searchParams.set("prompt", "login");
  authorizationUrl.searchParams.set("disable_auto_login", "true");
  authorizationUrl.searchParams.set("initial_amr_display", "lineqr");
  authorizationUrl.searchParams.set("switch_amr", "false");
  authorizationUrl.searchParams.set("max_age", "0");

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
