type SupabaseLike = {
  from: (table: string) => any;
};

type ReservationLinkScope = {
  id?: string | null;
  parent_reservation_id?: string | null;
  booking_group_id?: string | null;
};

export class PrimaryGuestCheckinConflictError extends Error {
  status: number;
  code: string;
  details?: Record<string, unknown>;

  constructor(message: string, details?: Record<string, unknown>) {
    super(message);
    this.name = "PrimaryGuestCheckinConflictError";
    this.status = 409;
    this.code = "primary_guest_already_checked_in";
    this.details = details;
  }
}

function asReservation(row: any): any {
  return Array.isArray(row?.reservations) ? row.reservations[0] : row?.reservations;
}

function normalizeId(value: unknown): string {
  return String(value ?? "").trim();
}

function linkedRootId(reservation: ReservationLinkScope | null | undefined): string {
  const id = normalizeId(reservation?.id);
  const parentId = normalizeId(reservation?.parent_reservation_id);
  return parentId || id;
}

function isSameLinkedStay(current: ReservationLinkScope | null, candidate: ReservationLinkScope | null): boolean {
  if (!current || !candidate) return false;

  const currentGroupId = normalizeId(current.booking_group_id);
  const candidateGroupId = normalizeId(candidate.booking_group_id);
  if (currentGroupId && candidateGroupId && currentGroupId === candidateGroupId) return true;

  const currentRootId = linkedRootId(current);
  const candidateRootId = linkedRootId(candidate);
  return Boolean(currentRootId && candidateRootId && currentRootId === candidateRootId);
}

export async function assertPrimaryGuestAvailableForCheckin(params: {
  supabase: SupabaseLike;
  reservationId: string;
  guestProfileId: string;
}): Promise<void> {
  const { supabase } = params;
  const reservationId = String(params.reservationId ?? "").trim();
  const guestProfileId = String(params.guestProfileId ?? "").trim();
  if (!reservationId || !guestProfileId) return;

  const { data: currentReservation, error: currentReservationError } = await supabase
    .from("reservations")
    .select("id, parent_reservation_id, booking_group_id")
    .eq("id", reservationId)
    .maybeSingle();

  if (currentReservationError) {
    throw new Error(currentReservationError.message ?? "Failed to validate current reservation link scope.");
  }

  const { data: rows, error } = await supabase
    .from("reservation_guests")
    .select(`
      reservation_id,
      guest_profile_id,
      reservations!inner(
        id,
        booking_code,
        guest_name,
        status,
        checked_in_at,
        parent_reservation_id,
        booking_group_id
      )
    `)
    .eq("guest_profile_id", guestProfileId)
    .eq("role", "primary");

  if (error) {
    throw new Error(error.message ?? "Failed to validate primary guest check-in conflict.");
  }

  const otherReservationIds: string[] = [];
  const candidateRows = (rows ?? []).filter((row: any) => {
    const candidateReservationId = String((row as any)?.reservation_id ?? "");
    if (!candidateReservationId || candidateReservationId === reservationId) return false;
    const reservation = Array.isArray((row as any)?.reservations)
      ? (row as any).reservations[0]
      : (row as any)?.reservations;
    if (!reservation) return false;
    if (String(reservation.status ?? "") !== "active") return false;
    if (isSameLinkedStay(currentReservation as ReservationLinkScope | null, reservation as ReservationLinkScope)) {
      return false;
    }
    otherReservationIds.push(candidateReservationId);
    return true;
  });

  if (candidateRows.length === 0) return;

  const checkedInReservationIds = new Set<string>();
  for (const row of candidateRows) {
    const reservation = asReservation(row);
    const candidateReservationId = String((row as any)?.reservation_id ?? "");
    if (!candidateReservationId || !reservation) continue;
    if (reservation.checked_in_at) {
      checkedInReservationIds.add(candidateReservationId);
    }
  }

  const pendingIds = otherReservationIds.filter((id) => !checkedInReservationIds.has(id));
  if (pendingIds.length > 0) {
    const { data: logs, error: logError } = await supabase
      .from("audit_logs")
      .select("entity_id")
      .eq("entity_type", "reservation")
      .eq("action", "checked_in")
      .in("entity_id", pendingIds);

    if (logError) {
      throw new Error(logError.message ?? "Failed to validate checked-in audit logs.");
    }
    for (const log of logs ?? []) {
      const entityId = String((log as any)?.entity_id ?? "").trim();
      if (entityId) checkedInReservationIds.add(entityId);
    }
  }

  const conflict = candidateRows.find((row: any) => {
    const candidateReservationId = String((row as any)?.reservation_id ?? "");
    return candidateReservationId && checkedInReservationIds.has(candidateReservationId);
  });

  if (!conflict) return;

  const reservation = Array.isArray((conflict as any)?.reservations)
    ? (conflict as any).reservations[0]
    : (conflict as any)?.reservations;
  const bookingCode = reservation?.booking_code ? String(reservation.booking_code) : null;
  const guestName = reservation?.guest_name ? String(reservation.guest_name) : null;

  throw new PrimaryGuestCheckinConflictError(
    "Primary guest is already checked in on another active reservation.",
    {
      conflict_reservation_id: String((conflict as any)?.reservation_id ?? ""),
      conflict_booking_code: bookingCode,
      conflict_guest_name: guestName,
    }
  );
}
