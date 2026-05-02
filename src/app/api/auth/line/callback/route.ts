import { resolveRoleAwarePostLoginPath } from "@/lib/auth-routing";
import {
  exchangeLineCodeForAccessToken,
  getLineLoginProfile,
  getLineLoginStateCookieName,
  readLineLoginState,
} from "@/lib/line-login";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { createServerClient } from "@supabase/ssr";
import { NextRequest, NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const fetchCache = "force-no-store";

type StaffLineLoginRow = {
  id: string;
  display_name: string | null;
  profiles?: { role: string | null } | null;
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

    const { data: authUser, error: authUserError } = await adminSupabase.auth.admin.getUserById(staffRow.id);
    if (authUserError) throw new Error(authUserError.message);
    const email = authUser.user?.email;
    if (!email) {
      loginUrl.searchParams.set("line_error", "no_email");
      return clearStateCookie(NextResponse.redirect(loginUrl));
    }

    const { data: linkData, error: linkError } = await adminSupabase.auth.admin.generateLink({
      type: "magiclink",
      email,
    });
    if (linkError) throw new Error(linkError.message);
    const tokenHash = linkData.properties?.hashed_token;
    if (!tokenHash) throw new Error("Magiclink token was not generated.");

    const destination = resolveRoleAwarePostLoginPath(savedState.next, staffRow.profiles?.role);
    const response = clearStateCookie(NextResponse.redirect(new URL(destination, request.url)));
    const cookieSupabase = createCookieSupabaseClient(request, response);
    const { data: sessionData, error: verifyError } = await cookieSupabase.auth.verifyOtp({
      type: "magiclink",
      token_hash: tokenHash,
    });
    if (verifyError) throw new Error(verifyError.message);
    if (sessionData.user?.id !== staffRow.id) throw new Error("LINE login session user mismatch.");

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
    loginUrl.searchParams.set("line_error", "callback");
    return clearStateCookie(NextResponse.redirect(loginUrl));
  }
}

function createCookieSupabaseClient(request: NextRequest, response: NextResponse) {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !anonKey) {
    throw new Error("Missing NEXT_PUBLIC_SUPABASE_URL or NEXT_PUBLIC_SUPABASE_ANON_KEY.");
  }

  return createServerClient(url, anonKey, {
    cookies: {
      getAll() {
        return request.cookies.getAll();
      },
      setAll(cookiesToSet) {
        cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value));
        cookiesToSet.forEach(({ name, value, options }) => response.cookies.set(name, value, options));
      },
    },
  });
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
