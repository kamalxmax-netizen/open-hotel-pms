import type { TaxInvoiceLanguage, TaxInvoiceLineItem } from "./types";
import { compareRoomNumber, formatDateLabelFromDates, normalizeMoney, round2 } from "./utils";

function sortedUnique(values: Array<string | null | undefined>): string[] {
  return Array.from(
    new Set(values.map((value) => String(value ?? "").trim()).filter(Boolean))
  );
}

function splitRoomNumbers(value: string | null | undefined): string[] {
  return sortedUnique(String(value ?? "").split(",")).sort(compareRoomNumber);
}

function itemGrossAmount(item: TaxInvoiceLineItem): number {
  const explicit = normalizeMoney(item.gross_amount);
  if (explicit > 0) return explicit;
  return round2(normalizeMoney(item.amount) + normalizeMoney(item.discount_amount));
}

function itemDiscountAmount(item: TaxInvoiceLineItem): number {
  const explicit = normalizeMoney(item.discount_amount);
  if (explicit > 0) return explicit;
  return Math.max(0, round2(itemGrossAmount(item) - normalizeMoney(item.amount)));
}

function mergeKey(item: TaxInvoiceLineItem): string | null {
  if (item.kind !== "room_charge") return null;
  if (!item.stay_dates?.length) return null;
  if ((item.merged_extra_charge_ids?.length ?? 0) > 0 || normalizeMoney(item.merged_extra_charge_total) > 0) {
    return null;
  }

  const dates = sortedUnique(item.stay_dates).sort();
  const unitPrice = normalizeMoney(item.unit_price);
  const unit = String(item.unit ?? "").trim() || "คืน";
  return [unit, unitPrice.toFixed(2), dates.join(",")].join("|");
}

function mergedDescription(roomCount: number, dates: string[], lang: TaxInvoiceLanguage): string {
  const dateLabel = formatDateLabelFromDates(dates, lang);
  return lang === "en"
    ? `Room charge ${roomCount} rooms (${dateLabel})`
    : `ค่าห้องพัก ${roomCount} ห้อง (${dateLabel})`;
}

export function mergeSameRateRoomLineItems(
  lineItems: TaxInvoiceLineItem[],
  lang: TaxInvoiceLanguage = "th"
): TaxInvoiceLineItem[] {
  const buckets = new Map<string, TaxInvoiceLineItem[]>();

  for (const item of lineItems) {
    const key = mergeKey(item);
    if (!key) continue;
    const current = buckets.get(key) ?? [];
    current.push(item);
    buckets.set(key, current);
  }

  const consumed = new Set<TaxInvoiceLineItem>();
  const output: TaxInvoiceLineItem[] = [];

  for (const item of lineItems) {
    if (consumed.has(item)) continue;
    const key = mergeKey(item);
    const bucket = key ? buckets.get(key) ?? [] : [];
    if (bucket.length <= 1) {
      output.push({ ...item });
      consumed.add(item);
      continue;
    }

    bucket.forEach((row) => consumed.add(row));
    const dates = sortedUnique(bucket.flatMap((row) => row.stay_dates ?? [])).sort();
    const roomNumbers = sortedUnique(bucket.flatMap((row) => splitRoomNumbers(row.room_number))).sort(compareRoomNumber);
    const reservationIds = sortedUnique(bucket.map((row) => row.reservation_id));
    const grossAmount = round2(bucket.reduce((sum, row) => sum + itemGrossAmount(row), 0));
    const discountAmount = round2(bucket.reduce((sum, row) => sum + itemDiscountAmount(row), 0));
    const amount = round2(bucket.reduce((sum, row) => sum + normalizeMoney(row.amount), 0));
    const quantity = round2(bucket.reduce((sum, row) => sum + Number(row.quantity || 0), 0));
    const first = bucket[0];
    const roomCount = roomNumbers.length || bucket.length;

    output.push({
      ...first,
      description: mergedDescription(roomCount, dates, lang),
      quantity,
      unit_price: round2(normalizeMoney(first.unit_price)),
      gross_amount: grossAmount,
      discount_amount: discountAmount,
      amount,
      stay_dates: dates,
      room_id: null,
      room_number: roomNumbers.join(","),
      reservation_id: reservationIds.length === 1 ? reservationIds[0] : null,
      merged_reservation_ids: reservationIds.length > 0 ? reservationIds : undefined,
      merged_line_sources: bucket.map((row) => ({
        reservation_id: row.reservation_id ?? null,
        room_number: row.room_number ?? null,
        gross_amount: itemGrossAmount(row),
        discount_amount: itemDiscountAmount(row),
        amount: normalizeMoney(row.amount),
      })),
      room_count: roomCount,
    });
  }

  return output;
}
