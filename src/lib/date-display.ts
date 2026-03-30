const YMD_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;
const DMY_PATTERN = /^(\d{2})\/(\d{2})\/(\d{4})$/;

function formatFromDate(date: Date, withYear: boolean): string {
  if (Number.isNaN(date.getTime())) return "";
  return new Intl.DateTimeFormat("en-GB", {
    timeZone: "Asia/Bangkok",
    day: "2-digit",
    month: "2-digit",
    ...(withYear ? { year: "numeric" as const } : {}),
  }).format(date);
}

export function formatDateDisplay(
  value?: string | Date | null,
  options?: { withYear?: boolean },
): string {
  if (!value) return "";

  const withYear = options?.withYear ?? true;

  if (value instanceof Date) {
    return formatFromDate(value, withYear) || String(value);
  }

  const trimmed = String(value).trim();
  if (!trimmed) return "";

  const ymd = trimmed.match(YMD_PATTERN);
  if (ymd) {
    const [, year, month, day] = ymd;
    return withYear ? `${day}/${month}/${year}` : `${day}/${month}`;
  }

  const dmy = trimmed.match(DMY_PATTERN);
  if (dmy) {
    const [, day, month, year] = dmy;
    return withYear ? `${day}/${month}/${year}` : `${day}/${month}`;
  }

  const parsed = new Date(trimmed);
  if (!Number.isNaN(parsed.getTime())) {
    return formatFromDate(parsed, withYear) || trimmed;
  }

  return trimmed;
}

export function formatDateShortDisplay(value?: string | Date | null): string {
  return formatDateDisplay(value, { withYear: false });
}

export function formatDateRangeDisplay(
  start?: string | Date | null,
  end?: string | Date | null,
  options?: { withYear?: boolean; separator?: string },
): string {
  const separator = options?.separator ?? " → ";
  const left = formatDateDisplay(start, { withYear: options?.withYear ?? true }) || "—";
  const right = formatDateDisplay(end, { withYear: options?.withYear ?? true }) || "—";
  return `${left}${separator}${right}`;
}
