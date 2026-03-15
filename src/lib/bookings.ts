export function generateBookingCode(): string {
  const ts = Date.now().toString(36).toUpperCase();
  const rnd = Math.floor(Math.random() * 1679616)
    .toString(36)
    .toUpperCase()
    .padStart(4, "0");
  return `BK-${ts}-${rnd}`;
}

export function normalizeMoney(value: unknown): number {
  const num = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(num)) return 0;
  return Math.round(num * 100) / 100;
}

export function sumMoney(values: number[]): number {
  return Math.round(values.reduce((sum, value) => sum + normalizeMoney(value), 0) * 100) / 100;
}

export function mapBookingErrorToStatus(message: string): number {
  const text = message.toLowerCase();

  if (
    text.includes("must be after") ||
    text.includes("invalid") ||
    text.includes("required") ||
    text.includes("ota bookings require")
  ) {
    return 400;
  }

  if (text.includes("not found")) {
    return 404;
  }

  if (
    text.includes("not sellable") ||
    text.includes("already booked") ||
    text.includes("not active") ||
    text.includes("cannot generate unique booking code")
  ) {
    return 409;
  }

  return 500;
}
