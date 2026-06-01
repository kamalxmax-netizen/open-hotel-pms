export type UiEventLogCategory = "all" | "activity" | "auth" | "device" | "errors";
export type UiEventLogArchiveStatus = "hot" | "archived" | "eligible_for_archive";

export const UI_EVENT_LOG_CATEGORIES: Array<{ value: UiEventLogCategory; label: string }> = [
  { value: "all", label: "All categories" },
  { value: "activity", label: "Activity" },
  { value: "auth", label: "Auth" },
  { value: "device", label: "Device" },
  { value: "errors", label: "Errors" },
];

export const UI_EVENT_LOG_TYPE_OPTIONS = [
  { value: "all", label: "All types" },
  { value: "page_view", label: "Page view" },
  { value: "click", label: "Click" },
  { value: "submit", label: "Submit" },
  { value: "auth_activity", label: "Auth activity" },
  { value: "smart_card", label: "Smart card" },
  { value: "client_error", label: "Client error" },
];

export const UI_EVENT_LOG_AUTH_ACTION_OPTIONS = [
  { value: "all", label: "All auth actions" },
  { value: "login_succeeded", label: "Login" },
  { value: "logout_clicked", label: "Logout" },
  { value: "session_started", label: "Session start" },
];

const UI_EVENT_TYPES_BY_CATEGORY: Record<Exclude<UiEventLogCategory, "all" | "errors">, string[]> = {
  activity: ["click", "page_view", "submit"],
  auth: ["auth_activity"],
  device: ["smart_card"],
};

export function normalizeUiEventLogCategory(value: string | null | undefined): UiEventLogCategory {
  const normalized = String(value ?? "all").trim().toLowerCase();
  if (normalized === "activity" || normalized === "auth" || normalized === "device" || normalized === "errors") {
    return normalized;
  }
  return "all";
}

export function getUiEventLogTypesForCategory(category: string | null | undefined): string[] | null {
  const normalized = normalizeUiEventLogCategory(category);
  if (normalized === "all" || normalized === "errors") return null;
  return UI_EVENT_TYPES_BY_CATEGORY[normalized];
}

export function resolveUiEventLogCategory(eventType: string | null | undefined, severity?: string | null): Exclude<UiEventLogCategory, "all"> {
  const normalizedType = String(eventType ?? "").trim().toLowerCase();
  const normalizedSeverity = String(severity ?? "").trim().toLowerCase();
  if (normalizedSeverity === "warning" || normalizedSeverity === "error" || normalizedType === "client_error") return "errors";
  if (normalizedType === "auth_activity") return "auth";
  if (normalizedType === "smart_card") return "device";
  return "activity";
}

export function getUiEventLogArchiveStatus(archivedAt: unknown, createdAt: unknown, now = new Date()): UiEventLogArchiveStatus {
  if (archivedAt) return "archived";
  const created = new Date(String(createdAt ?? ""));
  if (Number.isNaN(created.getTime())) return "hot";
  const archiveCutoff = now.getTime() - 7 * 24 * 60 * 60 * 1000;
  return created.getTime() < archiveCutoff ? "eligible_for_archive" : "hot";
}
