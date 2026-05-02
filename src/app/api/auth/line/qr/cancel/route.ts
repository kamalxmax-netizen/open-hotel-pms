import { getLineQrDesktopCookieName, hashLineQrToken } from "@/lib/line-login";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { NextRequest, NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const fetchCache = "force-no-store";

export async function POST(request: NextRequest) {
  const desktopToken = request.cookies.get(getLineQrDesktopCookieName())?.value;
  if (desktopToken) {
    await createServerSupabaseClient()
      .from("line_login_qr_challenges")
      .update({ status: "cancelled", cancelled_at: new Date().toISOString() })
      .eq("desktop_token_hash", hashLineQrToken(desktopToken))
      .eq("status", "pending");
  }

  const response = NextResponse.json({ success: true });
  response.cookies.set(getLineQrDesktopCookieName(), "", {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 0,
  });
  return response;
}
