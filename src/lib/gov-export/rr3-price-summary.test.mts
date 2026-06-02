import assert from "node:assert/strict";
import { collectFullTaxRoomChargeSummaryRows } from "./rr3-price-summary.ts";

const rows = collectFullTaxRoomChargeSummaryRows([
  {
    kind: "room_charge",
    description: "ค่าห้องพัก 3 ห้อง (11-16/5/2569)",
    unit_price: 272.52,
    quantity: 18,
    amount: 4414.8,
    gross_amount: 4905.33,
    discount_amount: 490.53,
    room_count: 3,
    room_number: "201,205,209",
    stay_dates: ["2026-05-11", "2026-05-12", "2026-05-13", "2026-05-14", "2026-05-15", "2026-05-16"],
    merged_reservation_ids: [
      "d4c43077-3881-46c2-a0a1-b0aa72c0b9e4",
      "0dfe5499-9e8c-4a01-b0f1-286c524154d2",
      "3cffe31f-3c0a-4380-9a9d-3d2aee58e0b3",
    ],
  },
  {
    kind: "room_charge",
    description: "ค่าห้องพัก 3 ห้อง (17-22/5/2569)",
    unit_price: 242.79,
    quantity: 18,
    amount: 3933.2,
    gross_amount: 4370.22,
    discount_amount: 437.02,
    room_count: 3,
    room_number: "201,205,209",
    stay_dates: ["2026-05-17", "2026-05-18", "2026-05-19", "2026-05-20", "2026-05-21", "2026-05-22"],
    merged_reservation_ids: [
      "d4c43077-3881-46c2-a0a1-b0aa72c0b9e4",
      "0dfe5499-9e8c-4a01-b0f1-286c524154d2",
      "3cffe31f-3c0a-4380-9a9d-3d2aee58e0b3",
    ],
  },
  {
    kind: "room_charge",
    description: "ค่าห้องพัก 3 ห้อง (11-16/5/2569)",
    unit_price: 277.48,
    quantity: 18,
    amount: 4495.19,
    gross_amount: 4994.66,
    discount_amount: 499.47,
    room_count: 3,
    room_number: "201,205,209",
    stay_dates: ["2026-05-11", "2026-05-12", "2026-05-13", "2026-05-14", "2026-05-15", "2026-05-16"],
    merged_reservation_ids: [
      "d4c43077-3881-46c2-a0a1-b0aa72c0b9e4",
      "0dfe5499-9e8c-4a01-b0f1-286c524154d2",
      "3cffe31f-3c0a-4380-9a9d-3d2aee58e0b3",
    ],
  },
  {
    kind: "room_charge",
    description: "ค่าห้องพัก 3 ห้อง (17-22/5/2569)",
    unit_price: 247.21,
    quantity: 18,
    amount: 4004.81,
    gross_amount: 4449.79,
    discount_amount: 444.98,
    room_count: 3,
    room_number: "201,205,209",
    stay_dates: ["2026-05-17", "2026-05-18", "2026-05-19", "2026-05-20", "2026-05-21", "2026-05-22"],
    merged_reservation_ids: [
      "d4c43077-3881-46c2-a0a1-b0aa72c0b9e4",
      "0dfe5499-9e8c-4a01-b0f1-286c524154d2",
      "3cffe31f-3c0a-4380-9a9d-3d2aee58e0b3",
    ],
  },
]);

assert.deepEqual(rows, [
  { unit_price: 441, quantity: 18, total: 7938 },
  { unit_price: 495, quantity: 18, total: 8910 },
]);

const fallbackRows = collectFullTaxRoomChargeSummaryRows([
  {
    kind: "room_charge",
    description: "Manual room charge",
    unit_price: 500,
    quantity: 1,
    amount: 500,
    __rr3_invoice_id: "invoice-a",
    __rr3_line_index: 0,
  },
  {
    kind: "room_charge",
    description: "Manual room charge",
    unit_price: 600,
    quantity: 1,
    amount: 600,
    __rr3_invoice_id: "invoice-b",
    __rr3_line_index: 0,
  },
]);

assert.deepEqual(fallbackRows, [
  { unit_price: 500, quantity: 1, total: 500 },
  { unit_price: 600, quantity: 1, total: 600 },
]);
