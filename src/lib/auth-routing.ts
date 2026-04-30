const MOBILE_HOME_PATH = "/pms/mobile-checkin";
const MAID_HOME_PATH = "/maid";
const DEFAULT_HOME_PATH = "/pms/board";

export function resolvePostLoginPath(role: string | null | undefined): string {
  const normalizedRole = String(role ?? "").trim().toLowerCase();
  if (normalizedRole === "mobile") return MOBILE_HOME_PATH;
  if (normalizedRole === "maid") return MAID_HOME_PATH;
  return DEFAULT_HOME_PATH;
}

export function sanitizePostLoginPath(value: string | null | undefined): string {
  if (!value) return DEFAULT_HOME_PATH;
  if (!value.startsWith("/") || value.startsWith("//")) return DEFAULT_HOME_PATH;
  if (value.startsWith("/login") || value.startsWith("/api")) return DEFAULT_HOME_PATH;
  if (
    value === "/" ||
    value.startsWith("/pms") ||
    value.startsWith("/maid") ||
    value.startsWith("/linen-mobile")
  ) {
    return value === "/pms" ? DEFAULT_HOME_PATH : value;
  }
  return DEFAULT_HOME_PATH;
}

export function resolveRoleAwarePostLoginPath(
  requestedPath: string | null | undefined,
  role: string | null | undefined
): string {
  const normalizedRole = String(role ?? "").trim().toLowerCase();
  const fallback = resolvePostLoginPath(normalizedRole);
  const requested = sanitizePostLoginPath(requestedPath);

  if (normalizedRole === "mobile") {
    return requested.startsWith(MOBILE_HOME_PATH) ? requested : fallback;
  }
  if (normalizedRole === "maid") {
    return requested.startsWith(MAID_HOME_PATH) ? requested : fallback;
  }
  return requested === "/" ? fallback : requested;
}
