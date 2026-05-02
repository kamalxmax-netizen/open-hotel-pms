import { createServerSupabaseClient } from "@/lib/supabase/server";
import { createServerClient } from "@supabase/ssr";
import { NextRequest, NextResponse } from "next/server";

export class AuthSessionError extends Error {
  constructor(
    public code: "missing_env" | "no_email" | "magiclink" | "verify" | "user_mismatch",
    message: string
  ) {
    super(message);
    this.name = "AuthSessionError";
  }
}

export async function createSupabaseSessionForUser(params: {
  request: NextRequest;
  response: NextResponse;
  userId: string;
}) {
  const adminSupabase = createServerSupabaseClient();
  const { data: authUser, error: authUserError } = await adminSupabase.auth.admin.getUserById(params.userId);
  if (authUserError) throw new AuthSessionError("magiclink", authUserError.message);

  const email = authUser.user?.email;
  if (!email) {
    throw new AuthSessionError("no_email", "Staff account has no auth email.");
  }

  const { data: linkData, error: linkError } = await adminSupabase.auth.admin.generateLink({
    type: "magiclink",
    email,
  });
  if (linkError) throw new AuthSessionError("magiclink", linkError.message);

  const tokenHash = linkData.properties?.hashed_token;
  if (!tokenHash) throw new AuthSessionError("magiclink", "Magiclink token was not generated.");

  const cookieSupabase = createCookieSupabaseClient(params.request, params.response);
  const { data: sessionData, error: verifyError } = await cookieSupabase.auth.verifyOtp({
    type: "magiclink",
    token_hash: tokenHash,
  });
  if (verifyError) throw new AuthSessionError("verify", verifyError.message);
  if (sessionData.user?.id !== params.userId) {
    throw new AuthSessionError("user_mismatch", "Created session user does not match requested staff.");
  }
}

function createCookieSupabaseClient(request: NextRequest, response: NextResponse) {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !anonKey) {
    throw new AuthSessionError("missing_env", "Missing NEXT_PUBLIC_SUPABASE_URL or NEXT_PUBLIC_SUPABASE_ANON_KEY.");
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
