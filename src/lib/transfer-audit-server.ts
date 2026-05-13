import { roundMoney } from "@/lib/transfer-audit";
import {
  collectForeignTransferEventIds,
  findPartialForeignTransferEventIds,
} from "@/lib/transfer-audit-merge";

export const TRANSFER_AUDIT_PAYMENT_SELECT = `
  id,
  transfer_event_id,
  reservation_id,
  tx_type,
  method,
  amount,
  note,
  paid_at,
  paid_date,
  cashier_name,
  revenue_category,
  is_record_only,
  is_void_reversal,
  is_correction,
  void_of,
  correction_ref,
  transfer_audit_original_note,
  reservations(id, booking_code, guest_name, checkin_date, checkout_date, booking_group_id)
`;

type SupabaseLike = {
  from: (table: string) => any;
};

export type TransferAuditPaymentRow = {
  id: string;
  transfer_event_id?: string | null;
  reservation_id: string | null;
  tx_type: string | null;
  method: string | null;
  amount: number | string | null;
  note: string | null;
  paid_at: string | null;
  paid_date: string | null;
  cashier_name: string | null;
  revenue_category: string | null;
  is_record_only?: boolean | null;
  is_void_reversal?: boolean | null;
  is_correction?: boolean | null;
  void_of?: string | null;
  correction_ref?: string | null;
  transfer_audit_original_note?: string | null;
  reservations?: any;
};

export function relationOne<T>(value: T | T[] | null | undefined): T | null {
  if (Array.isArray(value)) return value[0] ?? null;
  return value ?? null;
}

export function uniqueText(values: Array<string | null | undefined>): string[] {
  return Array.from(new Set(values.map((value) => String(value ?? "").trim()).filter(Boolean)));
}

export async function loadInvalidTransferPaymentIds(
  supabase: SupabaseLike,
  paymentIds: string[]
): Promise<Set<string>> {
  const ids = Array.from(new Set(paymentIds.map((id) => String(id ?? "").trim()).filter(Boolean)));
  const invalid = new Set<string>();
  if (ids.length === 0) return invalid;

  const [voidRows, correctionRows] = await Promise.all([
    supabase.from("folio_payments").select("void_of").eq("is_void_reversal", true).in("void_of", ids),
    supabase.from("folio_payments").select("correction_ref").eq("is_correction", true).in("correction_ref", ids),
  ]);
  if (voidRows.error) throw new Error(voidRows.error.message);
  if (correctionRows.error) throw new Error(correctionRows.error.message);

  for (const row of voidRows.data ?? []) {
    const id = String((row as any).void_of ?? "").trim();
    if (id) invalid.add(id);
  }
  for (const row of correctionRows.data ?? []) {
    const id = String((row as any).correction_ref ?? "").trim();
    if (id) invalid.add(id);
  }
  return invalid;
}

export function isValidTransferAuditPayment(row: TransferAuditPaymentRow, invalidIds: Set<string>): boolean {
  if (!row.id || invalidIds.has(String(row.id))) return false;
  if (row.method !== "transfer") return false;
  if (row.tx_type !== "payment" && row.tx_type !== "deposit") return false;
  if (!row.reservation_id) return false;
  if (row.is_record_only === true) return false;
  if (row.is_void_reversal === true) return false;
  if (row.is_correction === true) return false;
  if (row.void_of) return false;
  if (row.correction_ref) return false;
  return roundMoney(row.amount) > 0;
}

export async function fetchTransferAuditPaymentsByIds(
  supabase: SupabaseLike,
  ids: string[]
): Promise<TransferAuditPaymentRow[]> {
  const uniqueIds = Array.from(new Set(ids.map((id) => String(id ?? "").trim()).filter(Boolean)));
  if (uniqueIds.length === 0) return [];

  const { data, error } = await supabase
    .from("folio_payments")
    .select(TRANSFER_AUDIT_PAYMENT_SELECT)
    .in("id", uniqueIds);
  if (error) throw new Error(error.message);
  return (data ?? []) as TransferAuditPaymentRow[];
}

export async function fetchTransferAuditPaymentsByEvent(
  supabase: SupabaseLike,
  transferEventId: string
): Promise<TransferAuditPaymentRow[]> {
  const { data, error } = await supabase
    .from("folio_payments")
    .select(TRANSFER_AUDIT_PAYMENT_SELECT)
    .eq("transfer_event_id", transferEventId);
  if (error) throw new Error(error.message);
  return (data ?? []) as TransferAuditPaymentRow[];
}

export async function validateTransferAuditSelection(
  supabase: SupabaseLike,
  ids: string[],
  options: { currentEventId?: string | null; allowMergeFromOtherEvents?: boolean } = {}
) {
  const requestedIds = Array.from(new Set(ids.map((id) => String(id ?? "").trim()).filter(Boolean)));
  if (requestedIds.length === 0) {
    return { ok: false as const, error: "Select at least one transfer payment row." };
  }

  const rows = await fetchTransferAuditPaymentsByIds(supabase, requestedIds);
  const foundIds = new Set(rows.map((row) => String(row.id)));
  const missingIds = requestedIds.filter((id) => !foundIds.has(id));
  if (missingIds.length > 0) {
    return { ok: false as const, error: "Some selected payment rows were not found." };
  }

  const invalidIds = await loadInvalidTransferPaymentIds(supabase, requestedIds);
  const invalidRows = rows.filter((row) => !isValidTransferAuditPayment(row, invalidIds));
  if (invalidRows.length > 0) {
    return { ok: false as const, error: "Only active transfer payment/deposit rows can be grouped." };
  }

  const currentEventId = options.currentEventId ? String(options.currentEventId) : null;
  const foreignTransferEventIds = collectForeignTransferEventIds(rows, currentEventId);
  if (foreignTransferEventIds.length > 0 && !options.allowMergeFromOtherEvents) {
    return { ok: false as const, error: "Some selected payment rows are already in another transfer group." };
  }

  if (foreignTransferEventIds.length > 0) {
    const eventPaymentIds = new Map<string, string[]>();
    for (const eventId of foreignTransferEventIds) {
      const eventRows = await fetchTransferAuditPaymentsByEvent(supabase, eventId);
      eventPaymentIds.set(eventId, eventRows.map((row) => row.id));
    }
    const partialEventIds = findPartialForeignTransferEventIds(rows, eventPaymentIds, currentEventId);
    if (partialEventIds.length > 0) {
      return {
        ok: false as const,
        error: "Select every folio row from an existing transfer group before merging it.",
      };
    }
  }

  const total = roundMoney(rows.reduce((sum, row) => sum + roundMoney(row.amount), 0));
  if (total <= 0) {
    return { ok: false as const, error: "Selected transfer rows must total more than 0." };
  }

  return { ok: true as const, rows, total, foreignTransferEventIds };
}

export async function buildTransferAuditFallbackLabel(
  supabase: SupabaseLike,
  payments: TransferAuditPaymentRow[]
): Promise<string | null> {
  const reservations = payments.map((payment) => relationOne(payment.reservations) as any);
  const groupIds = uniqueText(reservations.map((reservation) => reservation?.booking_group_id));
  if (groupIds.length === 1) {
    const { data, error } = await supabase
      .from("booking_groups")
      .select("group_code, group_name")
      .eq("id", groupIds[0])
      .maybeSingle();
    if (error) throw new Error(error.message);
    const groupName = String((data as any)?.group_name ?? "").trim();
    const groupCode = String((data as any)?.group_code ?? "").trim();
    if (groupName || groupCode) return groupName || groupCode;
  }

  const guestNames = uniqueText(reservations.map((reservation) => reservation?.guest_name));
  if (guestNames.length === 1) return guestNames[0];
  const bookingCodes = uniqueText(reservations.map((reservation) => reservation?.booking_code));
  if (bookingCodes.length === 1) return bookingCodes[0];
  if (bookingCodes.length > 1) return `${bookingCodes.length} bookings`;
  return `${payments.length} transfer rows`;
}

export async function linkTransferAuditPayments(
  supabase: SupabaseLike,
  payments: TransferAuditPaymentRow[],
  transferEventId: string,
  syncedNote: string
) {
  for (const payment of payments) {
    const isNewLink = String(payment.transfer_event_id ?? "").trim() !== transferEventId;
    const update: Record<string, unknown> = {
      transfer_event_id: transferEventId,
      note: syncedNote,
    };
    if (isNewLink) {
      update.transfer_audit_original_note = payment.transfer_audit_original_note ?? payment.note ?? null;
    }

    const { error } = await supabase
      .from("folio_payments")
      .update(update)
      .eq("id", payment.id);
    if (error) throw new Error(error.message);
  }
}

export async function unlinkTransferAuditPayments(
  supabase: SupabaseLike,
  payments: TransferAuditPaymentRow[]
) {
  for (const payment of payments) {
    const { error } = await supabase
      .from("folio_payments")
      .update({
        transfer_event_id: null,
        note: payment.transfer_audit_original_note ?? payment.note ?? null,
        transfer_audit_original_note: null,
      })
      .eq("id", payment.id);
    if (error) throw new Error(error.message);
  }
}

export async function archiveTransferEventHeaders(
  supabase: SupabaseLike,
  transferEventIds: string[],
  archivedBy?: string | null
) {
  const ids = Array.from(new Set(transferEventIds.map((id) => String(id ?? "").trim()).filter(Boolean)));
  if (ids.length === 0) return;

  const { error } = await supabase
    .from("transfer_events")
    .update({
      status: "archived",
      archived_at: new Date().toISOString(),
      archived_by: archivedBy ?? null,
      updated_at: new Date().toISOString(),
    })
    .in("id", ids);
  if (error) throw new Error(error.message);
}
