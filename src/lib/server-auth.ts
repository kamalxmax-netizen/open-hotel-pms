import { createServerSupabaseClient } from "@/lib/supabase/server";
import { NextRequest } from "next/server";

export type AuthUser = { id: string };

type SupabaseServerClient = ReturnType<typeof createServerSupabaseClient>;

export async function getAuthenticatedUser(
  supabase: SupabaseServerClient,
  request: NextRequest
): Promise<AuthUser | null> {
  const authHeader = request.headers.get("authorization");
  const bearerToken = authHeader?.match(/^Bearer\s+(.+)$/i)?.[1] ?? null;

  const { data, error } = bearerToken
    ? await supabase.auth.getUser(bearerToken)
    : await supabase.auth.getUser();

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
  return data?.role ? String(data.role) : null;
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
