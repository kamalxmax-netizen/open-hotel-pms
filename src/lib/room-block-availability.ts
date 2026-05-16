export const ROOM_UNSELLABLE_BLOCK_TYPES = ["OOO", "OOS"] as const;

export type RoomUnsellableBlockType = (typeof ROOM_UNSELLABLE_BLOCK_TYPES)[number];

export type RoomBlockAvailabilityRow = {
  room_id?: string | null;
  block_type?: string | null;
  start_date?: string | null;
  end_date?: string | null;
};

export function isUnsellableRoomBlockType(value: unknown): value is RoomUnsellableBlockType {
  const normalized = String(value ?? "").trim().toUpperCase();
  return ROOM_UNSELLABLE_BLOCK_TYPES.includes(normalized as RoomUnsellableBlockType);
}

export function roomBlockOverlapsNight(block: RoomBlockAvailabilityRow, stayDate: string): boolean {
  const roomId = String(block.room_id ?? "").trim();
  const startDate = String(block.start_date ?? "").trim();
  const endDate = String(block.end_date ?? "").trim();
  return Boolean(roomId && startDate && endDate) &&
    isUnsellableRoomBlockType(block.block_type) &&
    startDate <= stayDate &&
    endDate > stayDate;
}

export function getRoomIdsBlockedOnNight(
  blocks: RoomBlockAvailabilityRow[] | null | undefined,
  stayDate: string
): Set<string> {
  const roomIds = new Set<string>();
  for (const block of blocks ?? []) {
    if (!roomBlockOverlapsNight(block, stayDate)) continue;
    roomIds.add(String(block.room_id));
  }
  return roomIds;
}

export function getRoomIdsBlockedForStay(
  blocks: RoomBlockAvailabilityRow[] | null | undefined,
  stayDates: string[]
): Set<string> {
  const roomIds = new Set<string>();
  for (const stayDate of stayDates) {
    for (const roomId of getRoomIdsBlockedOnNight(blocks, stayDate)) {
      roomIds.add(roomId);
    }
  }
  return roomIds;
}
