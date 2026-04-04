export const DEFAULT_UI_EVENT_LOG_CAPTURE_EMAILS = "ops@example.com";

export function normalizeUiEventLogCaptureEmails(value: unknown): string[] {
  const raw = typeof value === "string" ? value : DEFAULT_UI_EVENT_LOG_CAPTURE_EMAILS;
  return Array.from(
    new Set(
      raw
        .split(/[\n,]/)
        .map((entry) => entry.trim().toLowerCase())
        .filter(Boolean)
    )
  );
}

export function serializeUiEventLogCaptureEmails(value: unknown): string {
  const emails = normalizeUiEventLogCaptureEmails(value);
  return emails.length > 0 ? emails.join(", ") : DEFAULT_UI_EVENT_LOG_CAPTURE_EMAILS;
}

export function isUiEventLogEmailAllowed(email: string | null | undefined, value: unknown): boolean {
  const normalizedEmail = String(email ?? "").trim().toLowerCase();
  if (!normalizedEmail) return false;
  return normalizeUiEventLogCaptureEmails(value).includes(normalizedEmail);
}
