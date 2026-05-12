export type LoanCollectionReservationStatus = string | null;

export type LoanCollectionReservationContext = {
  reservation_id: string;
  status: LoanCollectionReservationStatus;
};

type LoanCollectionReservationInput = {
  reservation_id?: string | null;
  status?: string | null;
};

function isCheckoutCollectionStatus(status: LoanCollectionReservationStatus | undefined): boolean {
  return status === "checked_out" || status === "cancelled";
}

export function mergeLoanCollectionReservationContexts(
  primaryContext: LoanCollectionReservationInput | null | undefined,
  checkoutContext: LoanCollectionReservationInput | null | undefined
): LoanCollectionReservationContext[] {
  const seen = new Set<string>();
  const contexts: LoanCollectionReservationContext[] = [];

  for (const context of [primaryContext, checkoutContext]) {
    const reservationId = String(context?.reservation_id ?? "").trim();
    if (!reservationId || seen.has(reservationId)) continue;
    seen.add(reservationId);
    contexts.push({
      reservation_id: reservationId,
      status: context?.status ?? null,
    });
  }

  return contexts;
}

export function shouldShowLoanCollectionForReservation({
  reservationStatus,
  isCollectionVisibleStatus,
  dueDate,
  date,
}: {
  reservationStatus: LoanCollectionReservationStatus | undefined;
  isCollectionVisibleStatus: boolean;
  dueDate: string | null | undefined;
  date: string;
}): boolean {
  if (!isCollectionVisibleStatus) return false;
  if (isCheckoutCollectionStatus(reservationStatus)) return true;
  return reservationStatus === "active" && Boolean(dueDate && dueDate <= date);
}

export function getLoanCollectionDueState({
  reservationStatus,
  dueDate,
  date,
}: {
  reservationStatus: LoanCollectionReservationStatus | undefined;
  dueDate: string | null | undefined;
  date: string;
}): boolean {
  if (isCheckoutCollectionStatus(reservationStatus)) return true;
  return Boolean(dueDate && dueDate <= date);
}
