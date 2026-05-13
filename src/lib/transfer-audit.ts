export type TransferAuditDetailInput = {
  sender_name?: unknown;
  bank_ref?: unknown;
  transfer_at?: unknown;
  note?: unknown;
};

export type TransferAuditDetail = {
  senderName: string | null;
  bankRef: string | null;
  transferAt: string;
  note: string | null;
};

export type TransferAuditDetailResult =
  | { ok: true; value: TransferAuditDetail }
  | { ok: false; error: string };

export function roundMoney(value: unknown): number {
  const n = typeof value === "number" ? value : Number(String(value ?? "").replace(/,/g, ""));
  if (!Number.isFinite(n)) return 0;
  return Math.round(n * 100) / 100;
}

function compactText(value: unknown, maxLength: number): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.replace(/\s+/g, " ").trim();
  if (!trimmed) return null;
  return trimmed.slice(0, maxLength);
}

export function parseTransferAuditDetail(
  input: TransferAuditDetailInput | null | undefined,
  now: Date = new Date()
): TransferAuditDetailResult {
  if (!input || typeof input !== "object") {
    return { ok: false, error: "Transfer detail is required." };
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
      senderName: compactText(input.sender_name, 120),
      bankRef: compactText(input.bank_ref, 120),
      transferAt: transferAtDate.toISOString(),
      note: compactText(input.note, 500),
    },
  };
}

export function bangkokDateFromIso(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  const base = new Date(date.toLocaleString("en-US", { timeZone: "Asia/Bangkok" }));
  const yyyy = base.getFullYear();
  const mm = String(base.getMonth() + 1).padStart(2, "0");
  const dd = String(base.getDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}

export function formatBangkokShortDateTime(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "-";
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Asia/Bangkok",
    day: "2-digit",
    month: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).formatToParts(date);
  const byType = new Map(parts.map((part) => [part.type, part.value]));
  return `${byType.get("day")}/${byType.get("month")} ${byType.get("hour")}:${byType.get("minute")}`;
}

export function formatTransferAuditMoney(value: number): string {
  return roundMoney(value).toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

export function buildTransferAuditNote(args: {
  transferAt: string;
  senderName?: string | null;
  bankRef?: string | null;
  fallbackLabel?: string | null;
  totalAmount: number;
}): string {
  const name = String(args.senderName || args.fallbackLabel || "").trim();
  const ref = String(args.bankRef || "").trim();
  const parts = [
    `โอน ${formatBangkokShortDateTime(args.transferAt)}`,
    name || null,
    `รวม฿${formatTransferAuditMoney(args.totalAmount)}`,
    ref ? `Ref ${ref}` : null,
  ].filter(Boolean);
  return parts.join(" ");
}
