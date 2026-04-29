import { NextRequest, NextResponse } from "next/server";
import { createMiddlewareSupabaseClient } from "@/lib/supabase/middleware";
import { clearPermissionCache, readPermissionCache, writePermissionCache } from "@/lib/middleware-permission-cache";

// Routes that are always public (no auth required)
const PUBLIC_PATHS = ["/login", "/_next", "/favicon", "/icon", "/api/auth", "/offline", "/linen-vendor"];

// Routes that should redirect authenticated users away
const AUTH_ONLY_PATHS = ["/login"];
const MOBILE_HOME_PATH = "/pms/mobile-checkin";
const MAID_HOME_PATH = "/maid";
const STAFF_SCHEDULE_PATH = "/pms/staff-schedule";
const EXACT_PERMISSION_PATHS = new Set([
  "/pms/inventory",
  "/pms/housekeeping",
  "/pms/lost-found",
  "/pms/linen",
]);
const STRICT_PERMISSION_PREFIXES = [
  "/pms/tax-invoice/abbreviated",
];
const MUTATING_API_METHODS = new Set(["POST", "PUT", "PATCH", "DELETE"]);
const PUBLIC_MUTATION_API_PREFIXES = [
  "/api/auth",
  "/api/webhooks",
  "/api/linen/vendor",
];
const PUBLIC_MUTATION_API_PATTERNS = [
  /^\/api\/telegram\/webhook\/(?!register(?:\/|$))[^/]+$/,
];
// Phase 75 Batch 1.2 (2026-04-24): removed 5 unsafe entries per Agent B §4 audit.
// Removed: rate-plans/calculate, checkin-wizard/preview-payments, dynamic-rules/preview
//          (preview mutates despite the name), guests/match, checkin/match-booking
//          (writes to storage). Handler-level auth in Batch 1.3 rejects owner.
const OWNER_SAFE_MUTATION_API_PATTERNS = [
  /^\/api\/room-planner\/preview$/,
  /^\/api\/bookings\/[^/]+\/extend-stay\/preview$/,
  /^\/api\/bookings\/[^/]+\/ota-extend-orchestrator\/preview$/,
  /^\/api\/dynamic-rules\/simulate$/,
  /^\/api\/tax\/lookup$/,
  /^\/api\/mobile-text(?:\/|$)/,
];

function isPublicMutationApiPath(pathname: string): boolean {
  return (
    PUBLIC_MUTATION_API_PREFIXES.some((prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`)) ||
    PUBLIC_MUTATION_API_PATTERNS.some((pattern) => pattern.test(pathname))
  );
}

function isOwnerSafeMutationApiPath(pathname: string): boolean {
  return OWNER_SAFE_MUTATION_API_PATTERNS.some((pattern) => pattern.test(pathname));
}

function resolvePostLoginPath(role: string | null | undefined): string {
  const normalizedRole = String(role ?? "").trim().toLowerCase();
  if (normalizedRole === "mobile") return MOBILE_HOME_PATH;
  if (normalizedRole === "maid") return MAID_HOME_PATH;
  return "/pms/board";
}

function isStrictPermissionPath(pathname: string): boolean {
  return STRICT_PERMISSION_PREFIXES.some((prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`));
}

function isStrictPermissionGrant(allowedPath: string): boolean {
  return STRICT_PERMISSION_PREFIXES.some((prefix) => allowedPath === prefix || allowedPath.startsWith(`${prefix}/`));
}

export async function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;

  // Allow public paths without session check
  if (PUBLIC_PATHS.some((p) => pathname.startsWith(p))) {
    // If already logged in and hitting /login → redirect to Room Diary landing.
    if (AUTH_ONLY_PATHS.some((p) => pathname.startsWith(p))) {
      const response = NextResponse.next();
      const supabase = createMiddlewareSupabaseClient(request, response);
      const { data: { user } } = await supabase.auth.getUser();
      if (user) {
        const { data: profile } = await supabase
          .from("profiles")
          .select("role")
          .eq("user_id", user.id)
          .maybeSingle();
        return NextResponse.redirect(new URL(resolvePostLoginPath(profile?.role), request.url));
      }
    }
    return NextResponse.next();
  }

  if (pathname.startsWith("/api") && MUTATING_API_METHODS.has(request.method.toUpperCase())) {
    if (isPublicMutationApiPath(pathname) || isOwnerSafeMutationApiPath(pathname)) {
      return NextResponse.next();
    }

    const response = NextResponse.next();
    const supabase = createMiddlewareSupabaseClient(request, response);
    const authHeader = request.headers.get("authorization");
    const bearerToken = authHeader?.match(/^Bearer\s+(.+)$/i)?.[1] ?? null;
    const { data: authData } = bearerToken
      ? await supabase.auth.getUser(bearerToken)
      : await supabase.auth.getUser();
    const user = authData.user;

    if (!user) return response;

    const { data: profile } = await supabase
      .from("profiles")
      .select("role")
      .eq("user_id", user.id)
      .maybeSingle();
    const role = String(profile?.role ?? "").trim().toLowerCase();

    if (role === "owner") {
      return NextResponse.json(
        { success: false, error: "Owner is view-only." },
        { status: 403 }
      );
    }

    return response;
  }

  // For /pms/** and other protected routes: require session
  if (pathname.startsWith("/pms") || pathname.startsWith("/linen-mobile") || pathname.startsWith("/maid") || pathname === "/") {
    const response = NextResponse.next();
    const supabase = createMiddlewareSupabaseClient(request, response);
    const { data: { user } } = await supabase.auth.getUser();

    if (!user) {
      const loginUrl = new URL("/login", request.url);
      loginUrl.searchParams.set("next", pathname);
      const redirectResponse = NextResponse.redirect(loginUrl);
      clearPermissionCache(redirectResponse);
      return redirectResponse;
    }

    const { data: profile } = await supabase
      .from("profiles")
      .select("role, allowed_pages")
      .eq("user_id", user.id)
      .maybeSingle();
    const role = String(profile?.role ?? "").trim().toLowerCase();
    const isStaffSchedulePath = pathname === STAFF_SCHEDULE_PATH || pathname.startsWith(`${STAFF_SCHEDULE_PATH}/`);

    if (role === "mobile") {
      const isMobilePath = pathname === MOBILE_HOME_PATH || pathname.startsWith(`${MOBILE_HOME_PATH}/`);
      if (!isMobilePath && !isStaffSchedulePath) {
        return NextResponse.redirect(new URL(MOBILE_HOME_PATH, request.url));
      }
      if (isMobilePath) return response;
    }

    if (role === "maid") {
      const isMaidPath = pathname === MAID_HOME_PATH || pathname.startsWith(`${MAID_HOME_PATH}/`);
      if (!isMaidPath && !isStaffSchedulePath) {
        return NextResponse.redirect(new URL(MAID_HOME_PATH, request.url));
      }
    }

    // Skip permission check for the unauthorized page itself (avoid redirect loop)
    if (pathname === "/pms/unauthorized") return response;

    let allowedPages = await readPermissionCache(request, user.id);
    if (!allowedPages) {
      allowedPages = Array.isArray(profile?.allowed_pages) ? profile.allowed_pages : ["*"];
      await writePermissionCache(response, user.id, allowedPages);
    }

    // ["*"] = full access
    if (!allowedPages.includes("*")) {
      const permissionPath =
        pathname.startsWith("/maid")
          ? MAID_HOME_PATH
        : pathname.startsWith("/linen-mobile")
          ? "/linen-mobile"
        : pathname === "/pms/room-planner" || pathname.startsWith("/pms/room-planner/")
          ? "/pms/calendar"
          : pathname;
      const hasAccess = allowedPages.some((p) => {
        if (isStrictPermissionPath(permissionPath)) {
          return isStrictPermissionGrant(p) && (permissionPath === p || permissionPath.startsWith(`${p}/`));
        }
        if (EXACT_PERMISSION_PATHS.has(p)) return permissionPath === p;
        return permissionPath === p || permissionPath.startsWith(`${p}/`);
      });
      if (!hasAccess) {
        return NextResponse.redirect(new URL("/pms/unauthorized", request.url));
      }
    }

    return response;
  }

  return NextResponse.next();
}

export const config = {
  matcher: [
    /*
     * Match all request paths except:
     * - _next/static (static files)
     * - _next/image (image optimization)
     * - favicon.ico, icon.svg
     * - public folder assets (images, html files)
     */
    "/((?!_next/static|_next/image|favicon.ico|icon.svg|.*\\.(?:svg|png|jpg|jpeg|gif|webp|html)$).*)",
  ],
};
