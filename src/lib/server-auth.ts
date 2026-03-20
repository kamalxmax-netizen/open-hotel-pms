import { createServerSupabaseClient } from "@/lib/supabase/server";
import { createServerClient } from "@supabase/ssr";
import { NextRequest } from "next/server";

export type AuthUser = { id: string };

type SupabaseServerClient = ReturnType<typeof createServerSupabaseClient>;

function createCookieAuthClient(request: NextRequest) {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !anonKey) {
    return null;
  }

  return createServerClient(url, anonKey, {
    cookies: {
      getAll() {
        return request.cookies.getAll();
      },
      // Route handlers do not need to persist refreshed cookies for this read-only auth check.
      setAll() {
        // no-op
      },
    },
  });
}

export async function getAuthenticatedUser(
  supabase: SupabaseServerClient,
  request: NextRequest
): Promise<AuthUser | null> {
  const authHeader = request.headers.get("authorization");
  const bearerToken = authHeader?.match(/^Bearer\s+(.+)$/i)?.[1] ?? null;

  if (bearerToken) {
    const { data, error } = await supabase.auth.getUser(bearerToken);
    if (!error && data.user) {
      return { id: data.user.id };
    }
  }

  const cookieAuthClient = createCookieAuthClient(request);
  if (cookieAuthClient) {
    const { data, error } = await cookieAuthClient.auth.getUser();
    if (!error && data.user) {
      return { id: data.user.id };
    }
  }

  const { data, error } = await supabase.auth.getUser();
  if (error || !data.user) return null;
  return { id: data.user.id };
}

export async function getUserRole(
  supabase: SupabaseServerClient,
  userId: string
): Promise<string | null> {
  const { data, error } = await supabase
    .from("profiles")
    .select("role")
    .eq("user_id", userId)
    .maybeSingle();

  if (error) throw new Error(error.message);
  if (!data?.role) return null;
  return String(data.role).trim().toLowerCase();
}

export async function assertAdminOrSupervisor(
  supabase: SupabaseServerClient,
  userId: string
): Promise<void> {
  const role = await getUserRole(supabase, userId);
  if (role !== "admin" && role !== "supervisor") {
    throw new Error("Forbidden");
  }
}
