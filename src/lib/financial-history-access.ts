import type { UserRole } from "@/lib/types";

export const FRONTDESK_FINANCIAL_HISTORY_DAYS = 45;

const dateRegex = /^\d{4}-\d{2}-\d{2}$/;

export function addDays(dateString: string, days: number): string {
  const date = new Date(`${dateString}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

export function getFrontdeskFinancialHistoryCutoff(anchorDate: string): string {
  return addDays(anchorDate, -FRONTDESK_FINANCIAL_HISTORY_DAYS);
}

export function getFrontdeskFinancialHistoryError(
  role: UserRole | string | null | undefined,
  anchorDate: string,
  dates: Array<string | null | undefined>
): string | null {
  if (String(role ?? "").trim().toLowerCase() !== "frontdesk") return null;
  const cutoff = getFrontdeskFinancialHistoryCutoff(anchorDate);
  const oldestRequested = dates
    .map((date) => String(date ?? "").trim())
    .filter((date) => dateRegex.test(date))
    .sort()[0];

  if (!oldestRequested || oldestRequested >= cutoff) return null;
  return `Front Desk can view financial history up to ${FRONTDESK_FINANCIAL_HISTORY_DAYS} days.`;
}
