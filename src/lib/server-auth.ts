import { createServerSupabaseClient } from "@/lib/supabase/server";
import { createServerClient } from "@supabase/ssr";
import { NextRequest, NextResponse } from "next/server";
import {
  DEFAULT_DENY_ROLES,
  type RequireStaffAuthOptions,
  type StaffAuthResult,
} from "@/lib/phase75/types";
import type { UserRole } from "@/lib/types";

export type AuthUser = { id: string; email?: string | null };

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
      return { id: data.user.id, email: data.user.email ?? null };
    }
  }

  const cookieAuthClient = createCookieAuthClient(request);
  if (cookieAuthClient) {
    const { data, error } = await cookieAuthClient.auth.getUser();
    if (!error && data.user) {
      return { id: data.user.id, email: data.user.email ?? null };
    }
  }

  const { data, error } = await supabase.auth.getUser();
  if (error || !data.user) return null;
  return { id: data.user.id, email: data.user.email ?? null };
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

// ─── Phase 75 Batch 2.1 — unified staff auth gate ─────────────────
// Consumed by: API route handlers in Batch 1.3 + Batch 2 (50 routes).
// L0 contract: src/lib/phase75/types.ts (Lead-owned, do not modify).



export async function requireStaffAuth(
  supabase: SupabaseServerClient,
  request: NextRequest,
  options: RequireStaffAuthOptions = {}
): Promise<StaffAuthResult> {
  const user = await getAuthenticatedUser(supabase, request);
  if (!user) {
    return {
      user: null,
      role: null,
      error: NextResponse.json({ error: "unauthorized" }, { status: 401 }),
    };
  }
  if (options.skipRoleCheck) {
    return { user, role: "frontdesk" as UserRole, error: null };
  }
  const rawRole = await getUserRole(supabase, user.id);
  const role = (rawRole ?? "") as UserRole;
  const allow = options.allowRoles;
  const deny = options.denyRoles ?? DEFAULT_DENY_ROLES;
  const passes = allow ? allow.includes(role) : !deny.includes(role);
  if (!passes) {
    return {
      user: null,
      role: null,
      error: NextResponse.json({ error: "forbidden" }, { status: 403 }),
    };
  }
  return { user, role, error: null };
}
