const MOBILE_HOME_PATH = "/pms/mobile-checkin";
const MAID_HOME_PATH = "/maid";
const DEFAULT_HOME_PATH = "/pms/board";
const TRANSFER_AUDIT_PATH = "/pms/transfer-audit";
const TRANSFER_AUDIT_PERMISSION_PATHS = [
  TRANSFER_AUDIT_PATH,
  "/pms/payment-daily",
  "/pms/payments",
  "/pms/audit",
];
const FOLIO_PRINT_PREVIEW_PATH = "/pms/folio/preview";
const FOLIO_PRINT_PERMISSION_PATHS = [
  "/pms/reservations",
  "/pms/board",
  "/pms/arrivals",
  "/pms/inhouse",
  "/pms/departures",
  "/pms/groups",
];

function normalizeAllowedPages(allowedPages: string[] | null | undefined): string[] {
  if (!Array.isArray(allowedPages)) return ["*"];
  const normalized = allowedPages
    .map((page) => String(page ?? "").trim())
    .filter((page) => page.length > 0);
  return normalized;
}

function normalizeLandingPath(path: string): string {
  if (path === "/" || path === "/pms") return DEFAULT_HOME_PATH;
  return path;
}

export function resolvePermissionPathsForRoute(path: string): string[] {
  const normalizedPath = normalizeLandingPath(path);
  if (normalizedPath === TRANSFER_AUDIT_PATH || normalizedPath.startsWith(`${TRANSFER_AUDIT_PATH}/`)) {
    return TRANSFER_AUDIT_PERMISSION_PATHS;
  }
  if (normalizedPath === FOLIO_PRINT_PREVIEW_PATH || normalizedPath.startsWith(`${FOLIO_PRINT_PREVIEW_PATH}/`)) {
    return FOLIO_PRINT_PERMISSION_PATHS;
  }
  return [normalizedPath];
}

function canAccessPath(path: string, allowedPages: string[] | null | undefined): boolean {
  const pages = normalizeAllowedPages(allowedPages);
  if (pages.includes("*")) return true;
  const candidatePaths = resolvePermissionPathsForRoute(path);
  return candidatePaths.some((candidatePath) =>
    pages.some((page) => {
      const allowed = normalizeLandingPath(page);
      return candidatePath === allowed || candidatePath.startsWith(`${allowed}/`);
    })
  );
}

function firstAllowedLandingPath(allowedPages: string[] | null | undefined): string | null {
  const pages = normalizeAllowedPages(allowedPages);
  if (pages.includes("*")) return null;

  const priority = [
    "/linen-mobile",
    "/pms/linen",
    "/maid",
    "/pms/staff-schedule",
    "/pms/mobile-checkin",
    "/pms/board",
  ];
  const byPriority = priority.find((path) => canAccessPath(path, pages));
  if (byPriority) return byPriority;

  const first = pages[0];
  return first ? normalizeLandingPath(first) : null;
}

export function resolvePostLoginPath(
  role: string | null | undefined,
  allowedPages?: string[] | null
): string {
  const normalizedRole = String(role ?? "").trim().toLowerCase();
  if (normalizedRole === "mobile") return MOBILE_HOME_PATH;
  if (normalizedRole === "maid") return MAID_HOME_PATH;
  const allowedLanding = firstAllowedLandingPath(allowedPages);
  if (allowedLanding) return allowedLanding;
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
  role: string | null | undefined,
  allowedPages?: string[] | null
): string {
  const normalizedRole = String(role ?? "").trim().toLowerCase();
  const fallback = resolvePostLoginPath(normalizedRole, allowedPages);
  const requested = sanitizePostLoginPath(requestedPath);

  if (normalizedRole === "mobile") {
    return requested.startsWith(MOBILE_HOME_PATH) ? requested : fallback;
  }
  if (normalizedRole === "maid") {
    return requested.startsWith(MAID_HOME_PATH) ? requested : fallback;
  }
  if (!canAccessPath(requested, allowedPages)) {
    return fallback;
  }
  return requested === "/" ? fallback : requested;
}
