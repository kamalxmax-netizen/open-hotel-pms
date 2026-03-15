import { fromSatang, toSatang } from "@/lib/money";
import type { PaymentMethod } from "@/lib/types";

export type DepositMethod = PaymentMethod;

export type DepositLine = {
  method: DepositMethod;
  amount: number;
  note: string | null;
};

type RawDepositLine = {
  method?: unknown;
  amount?: unknown;
  note?: unknown;
};

export function normalizeDepositMethod(raw: unknown): DepositMethod {
  const value = String(raw ?? "").trim().toLowerCase();
  if (!value) return "cash";
  if (value === "cash") return "cash";
  if (value === "transfer") return "transfer";
  if (value === "credit_card") return "credit_card";
  if (value === "other") return "other";
  if (value.includes("promptpay")) return "transfer";
  if (value.includes("bank transfer")) return "transfer";
  if (value.includes("transfer")) return "transfer";
  if (value.includes("credit")) return "credit_card";
  if (value.includes("card")) return "credit_card";
  if (value.includes("cash")) return "cash";
  return "cash";
}

function normalizeDepositLine(line: RawDepositLine): DepositLine | null {
  const amount = fromSatang(toSatang(line.amount ?? 0));
  if (!Number.isFinite(amount) || amount <= 0) return null;
  return {
    method: normalizeDepositMethod(line.method),
    amount,
    note: typeof line.note === "string" && line.note.trim() ? line.note.trim() : null,
  };
}

export function normalizeDepositLines(lines: RawDepositLine[]): DepositLine[] {
  const merged = new Map<DepositMethod, DepositLine>();

  for (const rawLine of lines) {
    const line = normalizeDepositLine(rawLine);
    if (!line) continue;

    const current = merged.get(line.method);
    if (!current) {
      merged.set(line.method, { ...line });
      continue;
    }

    current.amount = fromSatang(toSatang(current.amount + line.amount));
    if (!current.note && line.note) current.note = line.note;
  }

  return Array.from(merged.values()).filter((line) => line.amount > 0);
}

export function parseDepositSnapshotNote(rawNote: unknown): {
  generalNote: string | null;
  lines: DepositLine[];
} {
  const noteText = typeof rawNote === "string" ? rawNote.trim() : "";
  if (!noteText) return { generalNote: null, lines: [] };

  try {
    const parsed = JSON.parse(noteText);
    const generalNote =
      typeof parsed?.note === "string" && parsed.note.trim().length > 0
        ? parsed.note.trim()
        : null;
    const rawLines = Array.isArray(parsed)
      ? parsed
      : Array.isArray(parsed?.lines)
        ? parsed.lines
        : [];
    return {
      generalNote,
      lines: normalizeDepositLines(rawLines),
    };
  } catch {
    return { generalNote: null, lines: [] };
  }
}

export function extractDepositGeneralNote(rawNote: unknown): string | null {
  return parseDepositSnapshotNote(rawNote).generalNote;
}

export function parseDepositPayloadLines(rawNote: unknown, depositAmount: number): DepositLine[] {
  const total = fromSatang(toSatang(depositAmount));
  if (!Number.isFinite(total) || total <= 0) return [];

  const parsed = parseDepositSnapshotNote(rawNote);
  const parsedTotal = fromSatang(
    toSatang(parsed.lines.reduce((sum, line) => sum + line.amount, 0))
  );
  if (parsed.lines.length > 0 && Math.abs(parsedTotal - total) <= 0.01) {
    return parsed.lines;
  }

  const noteText = typeof rawNote === "string" ? rawNote.trim() : "";
  if (!noteText) {
    return [{ method: "cash", amount: total, note: null }];
  }

  return [{ method: normalizeDepositMethod(noteText), amount: total, note: noteText || null }];
}

export function formatDepositMethodLabel(raw: unknown): string {
  const normalized = normalizeDepositMethod(raw);
  if (normalized === "credit_card") return "Credit Card";
  if (normalized === "transfer") return "Transfer";
  if (normalized === "cash") return "Cash";
  return "Other";
}

export function buildDepositSnapshotNote(lines: RawDepositLine[], generalNote?: string | null): string | null {
  const normalizedLines = normalizeDepositLines(lines);
  const note = typeof generalNote === "string" && generalNote.trim() ? generalNote.trim() : null;
  if (normalizedLines.length === 0 && !note) return null;
  return JSON.stringify({
    lines: normalizedLines.map((line) => ({
      method: line.method,
      amount: line.amount,
      note: line.note ?? undefined,
    })),
    note: note || undefined,
  });
}

export function computeHeldDepositFromRows(
  rows: Array<{
    tx_type?: unknown;
    revenue_category?: unknown;
    amount?: unknown;
    note?: unknown;
  }>
): number {
  return fromSatang(
    rows.reduce((sum, row) => {
      const amount = toSatang(row.amount ?? 0);
      const category = String(row.revenue_category ?? "").toLowerCase();
      const note = String(row.note ?? "").toLowerCase();
      if (row.tx_type === "deposit") return sum + amount;
      if (row.tx_type === "refund" && (category === "deposit" || note.includes("deposit refund"))) {
        return sum - amount;
      }
      return sum;
    }, 0)
  );
}
