import { PlannedRoomMoveError } from "@/lib/planned-room-moves";
import { isLegacyDayUseRoom } from "@/lib/dayuse-rooms";
import { getRoomIdsBlockedOnNight, ROOM_UNSELLABLE_BLOCK_TYPES } from "@/lib/room-block-availability";

export async function assertRoomTypeCapacityForDateRange(
  supabase: any,
  params: {
    roomTypeId: number;
    nights: string[];
    excludeReservationId?: string | null;
  }
): Promise<void> {
  const { roomTypeId, nights, excludeReservationId = null } = params;
  if (!Number.isFinite(roomTypeId) || roomTypeId <= 0 || nights.length === 0) return;

  const { data: typeRooms, error: typeRoomsError } = await supabase
    .from("rooms")
    .select("id, room_number, is_sellable, is_dayuse")
    .eq("room_type_id", roomTypeId);
  if (typeRoomsError) {
    throw new Error(`Failed to check room type capacity: ${typeRoomsError.message}`);
  }

  const sellableRoomIds = (typeRooms ?? [])
    .filter(
      (row: any) =>
        Boolean(row?.is_sellable) &&
        !Boolean(row?.is_dayuse) &&
        !isLegacyDayUseRoom(String(row?.room_number ?? ""))
    )
    .map((row: any) => (row?.id ? String(row.id) : ""))
    .filter(Boolean);
  if (sellableRoomIds.length <= 0) {
    throw new PlannedRoomMoveError("No sellable rooms found for selected room type.", 409);
  }

  const dayUseRoomIdSet = new Set(
    (typeRooms ?? [])
      .filter((row: any) => Boolean(row?.is_dayuse) || isLegacyDayUseRoom(String(row?.room_number ?? "")))
      .map((row: any) => String(row.id))
  );

  const firstStayDate = nights[0];
  const lastStayDate = nights[nights.length - 1];
  const checkoutDate = new Date(`${lastStayDate}T00:00:00Z`);
  checkoutDate.setUTCDate(checkoutDate.getUTCDate() + 1);
  const checkoutDateText = checkoutDate.toISOString().slice(0, 10);

  const { data: blockedRooms, error: blockedRoomsError } = await supabase
    .from("room_blocks")
    .select("room_id, block_type, start_date, end_date")
    .in("block_type", ROOM_UNSELLABLE_BLOCK_TYPES)
    .in("room_id", sellableRoomIds)
    .lt("start_date", checkoutDateText)
    .gt("end_date", firstStayDate);
  if (blockedRoomsError) {
    throw new Error(`Failed to check room blocks for room type capacity: ${blockedRoomsError.message}`);
  }

  const { data: overlappingNights, error: overlappingNightsError } = await supabase
    .from("reservation_nights")
    .select("reservation_id, stay_date, room_id, room_type_id")
    .is("cancelled_at", null)
    .in("stay_date", nights);
  if (overlappingNightsError) {
    throw new Error(`Failed to load overlapping reservations: ${overlappingNightsError.message}`);
  }

  const overlappingReservationIds = Array.from(
    new Set(
      (overlappingNights ?? [])
        .map((row: any) => (row?.reservation_id ? String(row.reservation_id) : ""))
        .filter(Boolean)
    )
  );

  let ignoredReservationIdSet = new Set<string>();
  if (overlappingReservationIds.length > 0) {
    const { data: overlapReservations, error: overlapReservationsError } = await supabase
      .from("reservations")
      .select("id, status, is_dayuse")
      .in("id", overlappingReservationIds)
    if (overlapReservationsError) {
      throw new Error(`Failed to check reservation overlaps for room type capacity: ${overlapReservationsError.message}`);
    }
    ignoredReservationIdSet = new Set(
      (overlapReservations ?? [])
        .filter((row: any) => Boolean(row?.is_dayuse) || String(row?.status ?? "") !== "active")
        .map((row: any) => String(row.id))
    );
  }

  const sellableRoomIdSet = new Set(sellableRoomIds);
  const occupancyByDate = new Map<string, Set<string>>();
  for (const row of overlappingNights ?? []) {
    const reservationId = row?.reservation_id ? String(row.reservation_id) : "";
    if (!reservationId || (excludeReservationId && reservationId === excludeReservationId)) continue;
    if (ignoredReservationIdSet.has(reservationId)) continue;

    const stayDate = row?.stay_date ? String(row.stay_date) : "";
    if (!stayDate) continue;

    const rowRoomTypeId = row?.room_type_id != null ? Number(row.room_type_id) : null;
    const rowRoomId = row?.room_id ? String(row.room_id) : null;
    if (rowRoomId && dayUseRoomIdSet.has(rowRoomId)) continue;

    const belongsToRoomType =
      rowRoomTypeId === roomTypeId ||
      (rowRoomId !== null && sellableRoomIdSet.has(rowRoomId));
    if (!belongsToRoomType) continue;

    const used = occupancyByDate.get(stayDate) ?? new Set<string>();
    used.add(reservationId);
    occupancyByDate.set(stayDate, used);
  }

  for (const stayDate of nights) {
    const blockedRoomIdSet = getRoomIdsBlockedOnNight(blockedRooms, stayDate);

    const roomCapacity = sellableRoomIds.reduce((count: number, roomId: string) => {
      return blockedRoomIdSet.has(roomId) ? count : count + 1;
    }, 0);
    const occupied = occupancyByDate.get(stayDate)?.size ?? 0;
    if (occupied >= roomCapacity) {
      throw new PlannedRoomMoveError(
        `No availability: all ${roomCapacity} rooms of this type are fully booked on ${stayDate}.`,
        409
      );
    }
  }
}
