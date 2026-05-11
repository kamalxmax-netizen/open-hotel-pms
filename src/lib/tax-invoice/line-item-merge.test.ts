import { mergeSameRateRoomLineItems } from "./line-item-merge";
import type { TaxInvoiceLineItem } from "./types";

function assertEqual<T>(actual: T, expected: T, message?: string) {
  if (actual !== expected) {
    throw new Error(message ?? `Expected ${String(expected)}, got ${String(actual)}`);
  }
}

function assertDeepEqual(actual: unknown, expected: unknown, message?: string) {
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    throw new Error(message ?? `Expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
  }
}

const sameRateItems: TaxInvoiceLineItem[] = [
  {
    kind: "room_charge",
    description: "ค่าห้องพัก (11-12/5/2569)",
    quantity: 2,
    unit: "คืน",
    unit_price: 500,
    gross_amount: 1000,
    discount_amount: 100,
    amount: 900,
    stay_dates: ["2026-05-11", "2026-05-12"],
    room_number: "201",
    reservation_id: "res-201",
  },
  {
    kind: "room_charge",
    description: "ค่าห้องพัก (11-12/5/2569)",
    quantity: 2,
    unit: "คืน",
    unit_price: 500,
    gross_amount: 1000,
    discount_amount: 0,
    amount: 1000,
    stay_dates: ["2026-05-11", "2026-05-12"],
    room_number: "202",
    reservation_id: "res-202",
  },
  {
    kind: "room_charge",
    description: "ค่าห้องพัก (11-12/5/2569)",
    quantity: 2,
    unit: "คืน",
    unit_price: 600,
    gross_amount: 1200,
    discount_amount: 0,
    amount: 1200,
    stay_dates: ["2026-05-11", "2026-05-12"],
    room_number: "203",
    reservation_id: "res-203",
  },
];

const merged = mergeSameRateRoomLineItems(sameRateItems, "th");

assertEqual(merged.length, 2);
assertDeepEqual(
  merged.map((item) => item.room_number),
  ["201,202", "203"]
);
assertEqual(merged[0].description, "ค่าห้องพัก 2 ห้อง (11-12/5/2569)");
assertEqual(merged[0].quantity, 4);
assertEqual(merged[0].unit_price, 500);
assertEqual(merged[0].gross_amount, 2000);
assertEqual(merged[0].discount_amount, 100);
assertEqual(merged[0].amount, 1900);
assertEqual(merged[0].reservation_id, null);
assertDeepEqual(merged[0].merged_reservation_ids, ["res-201", "res-202"]);
assertEqual(merged[0].room_count, 2);

const splitByDates = mergeSameRateRoomLineItems([
  sameRateItems[0],
  { ...sameRateItems[1], stay_dates: ["2026-05-12"], quantity: 1, gross_amount: 500, amount: 500 },
], "th");

assertEqual(splitByDates.length, 2);
