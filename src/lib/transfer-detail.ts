export type ManualTransferDetailInput = {
  actual_amount?: unknown;
  sender_name?: unknown;
  bank_ref?: unknown;
  transfer_at?: unknown;
  note?: unknown;
};

export type ManualTransferDetailPayload = {
  actual_amount: number | string;
  sender_name?: string | null;
  bank_ref?: string | null;
  transfer_at: string;
  note?: string | null;
};

export type ManualTransferDetailDraftInput = {
  actualAmount?: string;
  senderName?: string;
  bankRef?: string;
  transferAt?: string;
  note?: string;
};

export type ManualTransferDetail = {
  actualAmount: number;
  senderName: string | null;
  bankRef: string | null;
  transferAt: string;
  note: string | null;
};

export type ManualTransferDetailParseResult =
  | { ok: true; value: ManualTransferDetail }
  | { ok: false; error: string };

function compactText(value: unknown, maxLength: number): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.replace(/\s+/g, " ").trim();
  if (!trimmed) return null;
  return trimmed.slice(0, maxLength);
}

export function normalizeTransferSenderName(value: unknown): string {
  return compactText(value, 120) ?? "";
}

export function applyDefaultTransferSender<T extends { senderName: string }>(
  draft: T,
  senderName: unknown
): T {
  if (draft.senderName.trim()) return draft;
  const normalized = normalizeTransferSenderName(senderName);
  if (!normalized) return draft;
  return { ...draft, senderName: normalized };
}

export function buildManualTransferDetailPayloadFromDraft(
  draft: ManualTransferDetailDraftInput
): ManualTransferDetailPayload | undefined {
  const actualAmount = String(draft.actualAmount ?? "").trim();
  if (!actualAmount) return undefined;
  const transferAt = String(draft.transferAt ?? "").trim();

  return {
    actual_amount: actualAmount,
    sender_name: normalizeTransferSenderName(draft.senderName) || null,
    bank_ref: compactText(draft.bankRef, 120),
    transfer_at: transferAt ? new Date(transferAt).toISOString() : "",
    note: compactText(draft.note, 500),
  };
}

function toFiniteAmount(value: unknown): number {
  const numeric = typeof value === "number" ? value : Number(String(value ?? "").replace(/,/g, ""));
  if (!Number.isFinite(numeric)) return NaN;
  return Math.round(numeric * 100) / 100;
}

export function parseManualTransferDetail(
  input: ManualTransferDetailInput | null | undefined,
  now: Date = new Date()
): ManualTransferDetailParseResult {
  if (!input || typeof input !== "object") {
    return { ok: false, error: "Transfer detail is required." };
  }

  const actualAmount = toFiniteAmount(input.actual_amount);
  if (!Number.isFinite(actualAmount) || actualAmount <= 0) {
    return { ok: false, error: "Transfer actual amount must be greater than 0." };
  }

  const rawTransferAt = typeof input.transfer_at === "string" ? input.transfer_at.trim() : "";
  if (!rawTransferAt) {
    return { ok: false, error: "Transfer time is required." };
  }

  const transferAtDate = new Date(rawTransferAt);
  if (Number.isNaN(transferAtDate.getTime())) {
    return { ok: false, error: "Transfer time is invalid." };
  }
  if (transferAtDate.getTime() > now.getTime()) {
    return { ok: false, error: "Transfer time cannot be in the future." };
  }

  return {
    ok: true,
    value: {
      actualAmount,
      senderName: compactText(input.sender_name, 120),
      bankRef: compactText(input.bank_ref, 120),
      transferAt: transferAtDate.toISOString(),
      note: compactText(input.note, 500),
    },
  };
}

export function formatBangkokTransferDateTime(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Invalid date";
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Asia/Bangkok",
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).formatToParts(date);
  const byType = new Map(parts.map((part) => [part.type, part.value]));
  return `${byType.get("day")}/${byType.get("month")}/${byType.get("year")} ${byType.get("hour")}:${byType.get("minute")}`;
}

export function buildTransferDetailPreview(detail: ManualTransferDetail): string {
  const parts = [
    detail.senderName,
    detail.bankRef ? `Ref ${detail.bankRef}` : null,
    formatBangkokTransferDateTime(detail.transferAt),
  ].filter(Boolean);
  return parts.join(" · ");
}

export function computeTransferAuditDelta(
  actualAmount: number | string | null | undefined,
  folioAmount: number | string | null | undefined
): { delta: number; status: "matched" | "difference" } {
  const actual = toFiniteAmount(actualAmount ?? 0);
  const folio = toFiniteAmount(folioAmount ?? 0);
  const delta = Math.round((actual - folio) * 100) / 100;
  return {
    delta,
    status: Math.abs(delta) < 0.005 ? "matched" : "difference",
  };
}
