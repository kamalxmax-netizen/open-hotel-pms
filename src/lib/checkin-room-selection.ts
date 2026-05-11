type RoomNightLike = {
  room_id?: unknown;
  stay_date?: unknown;
};

type NormalizedNight<T> = {
  row: T;
  stayDate: string;
};

function normalizeNight<T extends RoomNightLike>(row: T): NormalizedNight<T> | null {
  const roomId = typeof row.room_id === "string" ? row.room_id.trim() : "";
  const stayDate = typeof row.stay_date === "string" ? row.stay_date.trim() : "";
  if (!roomId || !/^\d{4}-\d{2}-\d{2}$/.test(stayDate)) return null;
  return { row, stayDate };
}

export function pickCheckinRoomNight<T extends RoomNightLike>(
  nights: T[],
  businessDate: string
): T | null {
  const normalized = nights.map(normalizeNight).filter((night): night is NormalizedNight<T> => Boolean(night));
  if (normalized.length === 0) return null;

  const exact = normalized.find((night) => night.stayDate === businessDate);
  if (exact) return exact.row;

  const future = normalized
    .filter((night) => night.stayDate > businessDate)
    .sort((left, right) => left.stayDate.localeCompare(right.stayDate))[0];
  if (future) return future.row;

  return normalized.sort((left, right) => right.stayDate.localeCompare(left.stayDate))[0]?.row ?? null;
}
