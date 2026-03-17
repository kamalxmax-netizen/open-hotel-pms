const LEGACY_DAYUSE_ROOM_DIGITS = new Set(["118", "120", "122"]);

export function normalizeRoomDigits(roomNumber: string | null | undefined): string {
  return String(roomNumber ?? "").replace(/\D/g, "");
}

export function isLegacyDayUseRoom(roomNumber: string | null | undefined): boolean {
  const digits = normalizeRoomDigits(roomNumber);
  return LEGACY_DAYUSE_ROOM_DIGITS.has(digits);
}

