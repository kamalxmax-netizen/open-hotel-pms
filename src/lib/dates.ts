const DATE_REGEX = /^\d{4}-\d{2}-\d{2}$/;

function toUtcDateParts(dateString: string): { year: number; month: number; day: number } | null {
  if (!DATE_REGEX.test(dateString)) return null;
  const [yearStr, monthStr, dayStr] = dateString.split("-");
  const year = Number(yearStr);
  const month = Number(monthStr);
  const day = Number(dayStr);
  if (!Number.isInteger(year) || !Number.isInteger(month) || !Number.isInteger(day)) return null;
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;
  return { year, month, day };
}

export function isValidDateString(dateString: string): boolean {
  const parts = toUtcDateParts(dateString);
  if (!parts) return false;
  const date = new Date(Date.UTC(parts.year, parts.month - 1, parts.day));
  return (
    date.getUTCFullYear() === parts.year &&
    date.getUTCMonth() === parts.month - 1 &&
    date.getUTCDate() === parts.day
  );
}

export function compareDateStrings(left: string, right: string): number {
  if (!isValidDateString(left) || !isValidDateString(right)) {
    throw new Error("Invalid date string.");
  }
  if (left === right) return 0;
  return left < right ? -1 : 1;
}

export function addDays(dateString: string, days: number): string {
  const parts = toUtcDateParts(dateString);
  if (!parts) throw new Error("Invalid date string.");
  const date = new Date(Date.UTC(parts.year, parts.month - 1, parts.day));
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

export function listNights(checkinDate: string, checkoutDate: string): string[] {
  if (!isValidDateString(checkinDate) || !isValidDateString(checkoutDate)) {
    throw new Error("Invalid date format.");
  }
  if (compareDateStrings(checkoutDate, checkinDate) <= 0) {
    throw new Error("checkout_date must be after checkin_date.");
  }

  const nights: string[] = [];
  let cursor = checkinDate;
  while (compareDateStrings(cursor, checkoutDate) < 0) {
    nights.push(cursor);
    cursor = addDays(cursor, 1);
  }
  return nights;
}

export function nowIso(): string {
  return new Date().toISOString();
}
