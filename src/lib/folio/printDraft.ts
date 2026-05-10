export type EditableReservationField = "guest_name" | "guest_address" | "guest_phone" | "guest_email";

export interface FolioPrintDraftReservation {
  booking_code?: string | null;
  status?: string | null;
  checkin_date?: string | null;
  checkout_date?: string | null;
  nights?: number | null;
  room_number?: string | null;
  guest_name: string | null;
  guest_address: string | null;
  guest_phone: string | null;
  guest_email: string | null;
}

export interface FolioPrintDraftLedgerRow {
  date?: string | null;
  description: string | null;
  amount: number | null;
  kind: "charge" | "discount" | "payment" | "refund";
}

export interface FolioPrintDraftData {
  reservation: FolioPrintDraftReservation;
  ledger_rows: FolioPrintDraftLedgerRow[];
  total_charges: number;
  total_payments: number;
  balance_due: number;
  total_amount?: number;
}

function normalizeDraftText(value: string): string | null {
  return value === "" ? null : value;
}

export function updateFolioPrintReservationField<T extends FolioPrintDraftData>(
  draft: T,
  field: EditableReservationField,
  value: string
): T {
  return {
    ...draft,
    reservation: {
      ...draft.reservation,
      [field]: normalizeDraftText(value),
    },
  };
}

export function updateFolioPrintLedgerDescription<T extends FolioPrintDraftData>(
  draft: T,
  rowIndex: number,
  description: string
): T {
  if (rowIndex < 0 || rowIndex >= draft.ledger_rows.length) return draft;

  return {
    ...draft,
    ledger_rows: draft.ledger_rows.map((row, index) =>
      index === rowIndex
        ? {
            ...row,
            description: normalizeDraftText(description),
          }
        : row
    ),
  };
}

export function formatLockedLedgerAmount(row: FolioPrintDraftLedgerRow): string {
  if (row.amount === null) return "-";
  const amount = Math.abs(row.amount);
  const formatted = amount.toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
  if (row.kind === "payment" || row.kind === "discount" || row.amount < 0) return `(${formatted})`;
  return formatted;
}
