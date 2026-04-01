import { NextRequest, NextResponse } from "next/server";
import { createMiddlewareSupabaseClient } from "@/lib/supabase/middleware";
import { clearPermissionCache, readPermissionCache, writePermissionCache } from "@/lib/middleware-permission-cache";

// Routes that are always public (no auth required)
const PUBLIC_PATHS = ["/login", "/_next", "/favicon", "/icon", "/api/auth"];

// Routes that should redirect authenticated users away
const AUTH_ONLY_PATHS = ["/login"];

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
        return NextResponse.redirect(new URL("/pms/board", request.url));
      }
    }
    return NextResponse.next();
  }

  // For /pms/** and other protected routes: require session
  if (pathname.startsWith("/pms") || pathname === "/") {
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

    // Skip permission check for the unauthorized page itself (avoid redirect loop)
    if (pathname === "/pms/unauthorized") return response;

    let allowedPages = await readPermissionCache(request, user.id);
    if (!allowedPages) {
      const { data: profile } = await supabase
        .from("profiles")
        .select("allowed_pages")
        .eq("user_id", user.id)
        .single();

      allowedPages = Array.isArray(profile?.allowed_pages) ? profile.allowed_pages : ["*"];
      await writePermissionCache(response, user.id, allowedPages);
    }

    // ["*"] = full access
    if (!allowedPages.includes("*")) {
      const permissionPath =
        pathname === "/pms/room-planner" || pathname.startsWith("/pms/room-planner/")
          ? "/pms/calendar"
          : pathname;
      const hasAccess = allowedPages.some(
        (p) => permissionPath === p || permissionPath.startsWith(p + "/") || permissionPath.startsWith(p)
      );
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
