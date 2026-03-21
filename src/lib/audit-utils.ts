export const AUDIT_SOURCE_VALUES = ["manual", "system", "api", "night_audit"] as const;
export type AuditSource = (typeof AUDIT_SOURCE_VALUES)[number];

export const AUDIT_GROUPS = {
  reservation: { label: "Reservation", entityTypes: ["reservation"], actions: ["tax_invoice_toggled"] },
  payment: { label: "Payment", entityTypes: ["commission_ledger", "tip_ledger", "transfer_transaction"] },
  housekeeping: { label: "Housekeeping", entityTypes: ["housekeeping_task", "extra_task"], actions: ["assign", "approve", "clock_in", "dismiss", "dismissed", "done", "start", "resume", "pause", "collect_loan", "cancelled", "update"] },
  night_audit: { label: "Night Audit", actionPrefixes: ["night_audit_"], actions: ["document_match"] },
  staff: { label: "Staff", entityTypes: ["transfer", "staff"], actions: ["clock_in", "staff_created", "staff_updated"] },
  configuration: { label: "Configuration", fallback: true },
} as const;

export const AUDIT_GROUP_RULES = AUDIT_GROUPS;
export type AuditGroupKey = keyof typeof AUDIT_GROUPS;

export const SOURCE_BADGE: Record<AuditSource, { label: string; lightClass: string; darkClass: string }> = {
  manual: {
    label: "Manual",
    lightClass: "bg-slate-100 text-slate-700 border-slate-200",
    darkClass: "dark:bg-slate-800/60 dark:text-slate-300 dark:border-slate-700",
  },
  system: {
    label: "System",
    lightClass: "bg-sky-100 text-sky-700 border-sky-200",
    darkClass: "dark:bg-sky-900/40 dark:text-sky-300 dark:border-sky-800",
  },
  api: {
    label: "API",
    lightClass: "bg-emerald-100 text-emerald-700 border-emerald-200",
    darkClass: "dark:bg-emerald-900/40 dark:text-emerald-300 dark:border-emerald-800",
  },
  night_audit: {
    label: "Night Audit",
    lightClass: "bg-amber-100 text-amber-700 border-amber-200",
    darkClass: "dark:bg-amber-900/40 dark:text-amber-300 dark:border-amber-800",
  },
};

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

type AuditLikeRow = {
  entity_type?: string | null;
  action?: string | null;
};

export function isValidDateString(value: unknown): value is string {
  return typeof value === "string" && DATE_RE.test(value);
}

export function isUuidLike(value: unknown): boolean {
  return typeof value === "string" && UUID_RE.test(value);
}

export function humanizeAction(action: string | null | undefined): string {
  if (!action) return "";
  return String(action)
    .replace(/_/g, " ")
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

export function humanizeKey(key: string | null | undefined): string {
  if (!key) return "";
  return String(key)
    .replace(/_/g, " ")
    .replace(/\bid\b/gi, "ID")
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

export function toBangkokDateString(date = new Date()): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Bangkok",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);
  const y = parts.find((p) => p.type === "year")?.value;
  const m = parts.find((p) => p.type === "month")?.value;
  const d = parts.find((p) => p.type === "day")?.value;
  if (!y || !m || !d) return new Date().toISOString().slice(0, 10);
  return `${y}-${m}-${d}`;
}

export function normalizeAuditSource(value: string | null | undefined): AuditSource {
  if (!value) return "manual";
  return AUDIT_SOURCE_VALUES.includes(value as AuditSource) ? (value as AuditSource) : "manual";
}

function startsWithAny(value: string, prefixes: readonly string[]): boolean {
  return prefixes.some((prefix) => value.startsWith(prefix));
}

function isHousekeepingAction(action: string): boolean {
  return (AUDIT_GROUPS.housekeeping.actions as readonly string[]).some((prefix) => action.startsWith(prefix));
}

function isNightAuditAction(action: string): boolean {
  return (
    startsWithAny(action, AUDIT_GROUPS.night_audit.actionPrefixes) ||
    (AUDIT_GROUPS.night_audit.actions as readonly string[]).includes(action)
  );
}

function isReservationAction(action: string): boolean {
  const actions = (AUDIT_GROUPS.reservation as { actions?: readonly string[] }).actions ?? [];
  return actions.includes(action);
}

export function classifyAuditGroup(entry: AuditLikeRow): AuditGroupKey {
  const entityType = String(entry.entity_type ?? "").trim();
  const action = String(entry.action ?? "").trim();

  if (action && isReservationAction(action)) return "reservation";
  if ((AUDIT_GROUPS.reservation.entityTypes as readonly string[]).includes(entityType)) return "reservation";
  if ((AUDIT_GROUPS.payment.entityTypes as readonly string[]).includes(entityType)) return "payment";
  if ((AUDIT_GROUPS.housekeeping.entityTypes as readonly string[]).includes(entityType)) return "housekeeping";
  if (action && isHousekeepingAction(action)) return "housekeeping";
  if (action && isNightAuditAction(action)) return "night_audit";
  if ((AUDIT_GROUPS.staff.entityTypes as readonly string[]).includes(entityType)) return "staff";
  return "configuration";
}

export function matchesAuditGroup(entry: AuditLikeRow, group?: string | null): boolean {
  if (!group) return true;
  if (!Object.prototype.hasOwnProperty.call(AUDIT_GROUPS, group)) return true;
  return classifyAuditGroup(entry) === group;
}

export function filterAuditRowsByGroup<T extends AuditLikeRow>(rows: T[], group?: string | null): T[] {
  if (!group) return rows;
  return rows.filter((row) => matchesAuditGroup(row, group));
}

export async function resolveAuditBusinessDate(requestedDate?: string | null): Promise<string> {
  if (isValidDateString(requestedDate)) return requestedDate;
  return toBangkokDateString();
}
