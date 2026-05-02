import { resolveRoleAwarePostLoginPath } from "@/lib/auth-routing";
import { AuthSessionError, createSupabaseSessionForUser } from "@/lib/auth-session";
import { getLineQrDesktopCookieName, hashLineQrToken } from "@/lib/line-login";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { NextRequest, NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const fetchCache = "force-no-store";

type ChallengeRow = {
  id: string;
  status: string;
  next_path: string;
  staff_id: string | null;
  failure_reason: string | null;
  expires_at: string;
};

type StaffRoleRow = {
  id: string;
  profiles?: { role: string | null } | null;
};

export async function GET(request: NextRequest) {
  const desktopToken = request.cookies.get(getLineQrDesktopCookieName())?.value;
  if (!desktopToken) {
    return NextResponse.json({ success: true, status: "expired" });
  }

  const supabase = createServerSupabaseClient();
  const desktopTokenHash = hashLineQrToken(desktopToken);
  const { data: challenge, error } = await supabase
    .from("line_login_qr_challenges")
    .select("id, status, next_path, staff_id, failure_reason, expires_at")
    .eq("desktop_token_hash", desktopTokenHash)
    .maybeSingle<ChallengeRow>();

  if (error) {
    console.error("LINE QR status lookup failed", error);
    return NextResponse.json({ success: false, error: "lookup_failed" }, { status: 500 });
  }
  if (!challenge) {
    return clearDesktopCookie(NextResponse.json({ success: true, status: "expired" }));
  }

  if (challenge.status === "pending" && new Date(challenge.expires_at).getTime() <= Date.now()) {
    await supabase
      .from("line_login_qr_challenges")
      .update({ status: "expired" })
      .eq("id", challenge.id)
      .eq("status", "pending");
    return clearDesktopCookie(NextResponse.json({ success: true, status: "expired" }));
  }

  if (challenge.status === "pending") {
    return NextResponse.json({ success: true, status: "pending", expiresAt: challenge.expires_at });
  }

  if (challenge.status === "failed") {
    return clearDesktopCookie(NextResponse.json({
      success: true,
      status: "failed",
      error: challenge.failure_reason ?? "failed",
    }));
  }

  if (challenge.status !== "confirmed" || !challenge.staff_id) {
    return clearDesktopCookie(NextResponse.json({ success: true, status: challenge.status }));
  }

  const { data: staffRow, error: staffError } = await supabase
    .from("staff")
    .select("id, profiles:profiles!staff_id_fkey(role)")
    .eq("id", challenge.staff_id)
    .eq("is_active", true)
    .maybeSingle<StaffRoleRow>();

  if (staffError) {
    console.error("LINE QR staff lookup failed", staffError);
    return NextResponse.json({ success: false, error: "staff_lookup_failed" }, { status: 500 });
  }
  if (!staffRow?.id) {
    await supabase
      .from("line_login_qr_challenges")
      .update({ status: "failed", failure_reason: "inactive_staff" })
      .eq("id", challenge.id)
      .eq("status", "confirmed");
    return clearDesktopCookie(NextResponse.json({ success: true, status: "failed", error: "inactive_staff" }));
  }

  const redirectTo = resolveRoleAwarePostLoginPath(challenge.next_path, staffRow.profiles?.role);
  const response = NextResponse.json({ success: true, status: "authenticated", redirectTo });

  try {
    await createSupabaseSessionForUser({ request, response, userId: staffRow.id });
  } catch (sessionError) {
    console.error("LINE QR session create failed", sessionError);
    const reason = sessionError instanceof AuthSessionError ? sessionError.code : "session_failed";
    await supabase
      .from("line_login_qr_challenges")
      .update({ status: "failed", failure_reason: reason })
      .eq("id", challenge.id)
      .eq("status", "confirmed");
    return clearDesktopCookie(NextResponse.json({ success: true, status: "failed", error: reason }));
  }

  await supabase
    .from("line_login_qr_challenges")
    .update({ status: "consumed", consumed_at: new Date().toISOString() })
    .eq("id", challenge.id)
    .eq("status", "confirmed");

  return clearDesktopCookie(response);
}

function clearDesktopCookie(response: NextResponse) {
  response.cookies.set(getLineQrDesktopCookieName(), "", {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 0,
  });
  return response;
}
