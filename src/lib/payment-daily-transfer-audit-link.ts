const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function compact(value: unknown): string {
  return String(value ?? "").trim();
}

export function buildPaymentDailyTransferAuditHref(input: {
  method: unknown;
  transferEventId?: unknown;
  paymentId?: unknown;
  paidDate?: unknown;
  fallbackDate?: unknown;
}): string | null {
  if (compact(input.method).toLowerCase() !== "transfer") return null;

  const focus = compact(input.transferEventId) || compact(input.paymentId);
  if (!focus) return null;

  const params = new URLSearchParams({ focus });
  const paidDate = compact(input.paidDate);
  const fallbackDate = compact(input.fallbackDate);
  const date = DATE_RE.test(paidDate) ? paidDate : DATE_RE.test(fallbackDate) ? fallbackDate : "";
  if (date) {
    params.set("from", date);
    params.set("to", date);
  }

  return `/pms/transfer-audit?${params.toString()}`;
}
