export type TransferAuditMergePayment = {
  id: string;
  transfer_event_id?: string | null;
};

export function collectForeignTransferEventIds(
  rows: TransferAuditMergePayment[],
  currentEventId?: string | null
): string[] {
  const current = String(currentEventId ?? "").trim();
  const ids = rows
    .map((row) => String(row.transfer_event_id ?? "").trim())
    .filter((eventId) => eventId && eventId !== current);
  return Array.from(new Set(ids));
}

export function findPartialForeignTransferEventIds(
  selectedRows: TransferAuditMergePayment[],
  eventPaymentIds: Map<string, string[]>,
  currentEventId?: string | null
): string[] {
  const selectedIds = new Set(selectedRows.map((row) => String(row.id)));
  const foreignEventIds = collectForeignTransferEventIds(selectedRows, currentEventId);
  return foreignEventIds.filter((eventId) => {
    const allPaymentIds = eventPaymentIds.get(eventId) ?? [];
    return allPaymentIds.some((paymentId) => !selectedIds.has(paymentId));
  });
}
