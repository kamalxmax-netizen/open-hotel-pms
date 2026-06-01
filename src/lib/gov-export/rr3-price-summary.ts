import type { RR3PriceSummaryRow } from "./types";

function roundMoney(value: unknown): number {
  return Math.round(Number(value ?? 0) * 100) / 100;
}

function stableStrings(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return Array.from(
    new Set(value.map((item) => String(item ?? "").trim()).filter(Boolean))
  ).sort();
}

function roomChargeQuantity(line: any): number {
  const quantity = Math.round(Number(line?.quantity ?? 0));
  if (quantity > 0) return quantity;

  const stayCount = stableStrings(line?.stay_dates).length;
  const roomCount = Math.max(1, Math.round(Number(line?.room_count ?? 0)));
  return Math.max(1, stayCount * roomCount);
}

function roomChargeAmount(line: any): number {
  const amount = roundMoney(line?.amount);
  if (amount > 0) return amount;
  return roundMoney(Number(line?.unit_price ?? 0) * roomChargeQuantity(line));
}

function roomChargePhysicalKey(line: any): string {
  const stayDates = stableStrings(line?.stay_dates);
  const reservationIds = stableStrings(line?.merged_reservation_ids);
  const fallbackReservationId = String(line?.reservation_id ?? "").trim();
  if (reservationIds.length === 0 && fallbackReservationId) reservationIds.push(fallbackReservationId);
  const roomNumber = String(line?.room_number ?? "").trim();

  if (stayDates.length === 0 && reservationIds.length === 0 && !roomNumber) {
    return [
      "fallback",
      String(line?.__rr3_invoice_id ?? line?.invoice_id ?? line?.invoice_no ?? "").trim(),
      String(line?.__rr3_line_index ?? "").trim(),
      String(line?.description ?? "").trim(),
      String(line?.unit_price ?? "").trim(),
      String(line?.quantity ?? "").trim(),
      String(line?.amount ?? "").trim(),
    ].join("::");
  }

  return [
    reservationIds.join(","),
    stayDates.join(","),
    roomNumber,
  ].join("::");
}

export function collectFullTaxRoomChargeSummaryRows(lines: any[]): RR3PriceSummaryRow[] {
  const groups = new Map<string, { amount: number; quantity: number }>();

  for (const line of lines) {
    const key = roomChargePhysicalKey(line);
    const current = groups.get(key) ?? { amount: 0, quantity: 0 };
    current.amount = roundMoney(current.amount + roomChargeAmount(line));
    current.quantity = Math.max(current.quantity, roomChargeQuantity(line));
    groups.set(key, current);
  }

  const bucket = new Map<number, number>();
  for (const group of groups.values()) {
    if (group.amount <= 0 || group.quantity <= 0) continue;
    const unitPrice = roundMoney(group.amount / group.quantity);
    if (unitPrice <= 0) continue;
    bucket.set(unitPrice, (bucket.get(unitPrice) ?? 0) + group.quantity);
  }

  return Array.from(bucket.entries())
    .sort(([left], [right]) => left - right)
    .map(([unitPrice, quantity]) => ({
      unit_price: unitPrice,
      quantity,
      total: roundMoney(unitPrice * quantity),
    }));
}

export function addFullTaxRoomChargeLinesToBucket(bucket: Map<number, number>, lines: any[]): void {
  for (const row of collectFullTaxRoomChargeSummaryRows(lines)) {
    bucket.set(row.unit_price, (bucket.get(row.unit_price) ?? 0) + row.quantity);
  }
}
