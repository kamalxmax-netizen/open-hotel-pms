// D18: Mirrors src/lib/linen/api-auth.ts — gates all /api/analytics/** endpoints.
import { getAuthenticatedUser } from "@/lib/server-auth";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { NextRequest } from "next/server";

export type AnalyticsActor = {
    userId: string;
    role: string | null;
    name: string | null;
    isAdmin: boolean;
};

function hasAnalyticsPagePermission(allowedPages: unknown): boolean {
    if (!Array.isArray(allowedPages)) return false;
    return allowedPages
        .map((page) => String(page).trim())
        .some((page) => page === "*" || page === "/pms/analytics" || page.startsWith("/pms/analytics/"));
}

export async function requireAnalyticsAccess(
    request: NextRequest
): Promise<{ supabase: SupabaseClient; actor: AnalyticsActor }> {
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
        hasAnalyticsPagePermission((profile as any)?.allowed_pages);
    if (!allowed) {
        const err = new Error("Forbidden");
        (err as any).status = 403;
        throw err;
    }

    return {
        supabase,
        actor: {
            userId: user.id,
            role,
            name: String((profile as any)?.full_name ?? user.email ?? "").trim() || null,
            isAdmin: role === "admin" || role === "supervisor",
        },
    };
}

export function analyticsApiError(error: unknown, fallback = "Internal server error") {
    const status = typeof (error as any)?.status === "number" ? (error as any).status : 500;
    const message = error instanceof Error ? error.message : fallback;
    return { status, message };
}
