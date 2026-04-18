import { getAuthenticatedUser } from "@/lib/server-auth";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import type { NextRequest } from "next/server";
import type { SupabaseClient } from "@supabase/supabase-js";

export type InventoryActor = {
  userId: string;
  role: string | null;
  name: string | null;
};

function hasInventoryPermission(allowedPages: unknown): boolean {
  if (!Array.isArray(allowedPages)) return false;
  return allowedPages
    .map((page) => String(page).trim())
    .some((page) => page === "*" || page === "/pms/inventory" || page.startsWith("/pms/inventory/"));
}

export async function requireFoPrepareAccess(
  request: NextRequest
): Promise<{ supabase: SupabaseClient; actor: InventoryActor }> {
  const supabase = createServerSupabaseClient();
  const user = await getAuthenticatedUser(supabase, request);
  if (!user) {
    const error = new Error("Unauthorized");
    (error as any).status = 401;
    throw error;
  }

  const { data: profile, error } = await supabase
    .from("profiles")
    .select("role, allowed_pages, full_name")
    .eq("user_id", user.id)
    .maybeSingle();

  if (error) throw new Error(error.message);

  const role = String((profile as any)?.role ?? "").trim().toLowerCase() || null;
  const allowed =
    role === "admin" ||
    role === "supervisor" ||
    role === "frontdesk" ||
    hasInventoryPermission((profile as any)?.allowed_pages);

  if (!allowed) {
    const error = new Error("Forbidden");
    (error as any).status = 403;
    throw error;
  }

  return {
    supabase,
    actor: {
      userId: user.id,
      role,
      name: String((profile as any)?.full_name ?? user.email ?? "").trim() || null,
    },
  };
}

export function amenityReconApiError(error: unknown, fallback = "Internal server error") {
  const status = typeof (error as any)?.status === "number" ? (error as any).status : 500;
  const message = error instanceof Error ? error.message : fallback;
  return { status, message };
}
