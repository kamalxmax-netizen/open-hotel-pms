type DepartureNightRow = {
  room_id?: string | null;
  stay_date?: string | null;
  cancelled_at?: string | null;
};

type DepartureReservationRow = {
  id?: string | null;
  parent_reservation_id?: string | null;
  checkout_date?: string | null;
  reservation_nights?: DepartureNightRow[] | DepartureNightRow | null;
};

type OccupiedStayRow = {
  reservation_id?: string | null;
  parent_reservation_id?: string | null;
  room_id?: string | null;
  checkin_date?: string | null;
};

function asString(value: unknown): string {
  return String(value ?? "").trim();
}

function ensureArray<T>(value: T[] | T | null | undefined): T[] {
  if (Array.isArray(value)) return value;
  if (value == null) return [];
  return [value];
}

function rootReservationId(reservationId: string, parentReservationId: string | null): string {
  return parentReservationId || reservationId;
}

function latestActiveDepartureRoomId(row: DepartureReservationRow): string | null {
  const nights = ensureArray(row.reservation_nights)
    .filter((night) => !night?.cancelled_at && asString(night?.room_id))
    .sort((left, right) => asString(right?.stay_date).localeCompare(asString(left?.stay_date)));
  const roomId = asString(nights[0]?.room_id);
  return roomId || null;
}

export function collectSameRoomLinkedContinuationReservationIds(params: {
  departures: DepartureReservationRow[];
  occupiedStays: OccupiedStayRow[];
}): Set<string> {
  const { departures, occupiedStays } = params;
  const occupiedByRoomId = new Map<string, OccupiedStayRow[]>();

  for (const stay of occupiedStays) {
    const roomId = asString(stay.room_id);
    const reservationId = asString(stay.reservation_id);
    if (!roomId || !reservationId) continue;
    const bucket = occupiedByRoomId.get(roomId) ?? [];
    bucket.push(stay);
    occupiedByRoomId.set(roomId, bucket);
  }

  const suppressedReservationIds = new Set<string>();

  for (const departure of departures) {
    const reservationId = asString(departure.id);
    const checkoutDate = asString(departure.checkout_date);
    if (!reservationId || !checkoutDate) continue;

    const roomId = latestActiveDepartureRoomId(departure);
    if (!roomId) continue;

    const linkedRootId = rootReservationId(
      reservationId,
      asString(departure.parent_reservation_id) || null
    );
    const occupiedRows = occupiedByRoomId.get(roomId) ?? [];
    const hasSameRoomContinuation = occupiedRows.some((stay) => {
      const occupiedReservationId = asString(stay.reservation_id);
      if (!occupiedReservationId || occupiedReservationId === reservationId) return false;
      const occupiedRootId = rootReservationId(
        occupiedReservationId,
        asString(stay.parent_reservation_id) || null
      );
      if (occupiedRootId !== linkedRootId) return false;
      return asString(stay.checkin_date) === checkoutDate;
    });

    if (hasSameRoomContinuation) {
      suppressedReservationIds.add(reservationId);
    }
  }

  return suppressedReservationIds;
}
