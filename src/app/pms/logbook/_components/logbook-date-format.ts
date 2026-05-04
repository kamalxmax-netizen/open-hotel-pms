const LOGBOOK_TIME_ZONE = "Asia/Bangkok"

function toValidDate(value: Date | string | null | undefined): Date | null {
  if (!value) return null
  const date = value instanceof Date ? value : new Date(value)
  return Number.isNaN(date.getTime()) ? null : date
}

export function formatLogbookDate(value: Date | string | null | undefined): string {
  const date = toValidDate(value)
  if (!date) return ""
  return new Intl.DateTimeFormat("en-GB", {
    timeZone: LOGBOOK_TIME_ZONE,
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  }).format(date)
}

export function formatLogbookDateTime(value: Date | string | null | undefined): string {
  const date = toValidDate(value)
  if (!date) return ""
  return new Intl.DateTimeFormat("en-GB", {
    timeZone: LOGBOOK_TIME_ZONE,
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(date)
}

export function formatLogbookCompactDateTime(value: Date | string | null | undefined): string {
  const date = toValidDate(value)
  if (!date) return ""
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: LOGBOOK_TIME_ZONE,
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).formatToParts(date)
  const get = (type: string) => parts.find((part) => part.type === type)?.value ?? ""
  return `${get("hour")}:${get("minute")} ${get("day")}/${get("month")}/${get("year")}`.trim()
}

export function formatLogbookWeekdayDate(value: Date | string | null | undefined): string {
  const date = toValidDate(value)
  if (!date) return ""
  return new Intl.DateTimeFormat("en-GB", {
    timeZone: LOGBOOK_TIME_ZONE,
    weekday: "short",
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  }).format(date)
}
