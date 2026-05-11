import assert from "node:assert/strict";
import {
  applyReservationDiscountsToLineItems,
  prepareEditedCoverageLineItems,
  prepareCoverageLineItems,
  sumLineItemAmounts,
} from "./coverage";
import type { TaxInvoiceLineItem } from "./types";

const baseItems: TaxInvoiceLineItem[] = [
  {
    kind: "room_charge",
    description: "Room 201",
    quantity: 1,
    unit: "คืน",
    unit_price: 1000,
    amount: 1000,
    stay_dates: ["2026-05-01"],
    reservation_id: "res-a",
    room_number: "201",
  },
  {
    kind: "room_charge",
    description: "Room 201",
    quantity: 1,
    unit: "คืน",
    unit_price: 2000,
    amount: 2000,
    stay_dates: ["2026-05-02"],
    reservation_id: "res-a",
    room_number: "201",
  },
];

const discounted = applyReservationDiscountsToLineItems(baseItems, [
  {
    id: "res-a",
    discount_type: "percent",
    discount_value: 10,
    discount_percent: null,
    rate_plan_id: null,
  },
]);

assert.equal(sumLineItemAmounts(discounted), 2700);
assert.equal(discounted.reduce((sum, item) => sum + (item.discount_amount ?? 0), 0), 300);
assert.deepEqual(discounted.map((item) => item.amount), [900, 1800]);

const ratePlanApplied = applyReservationDiscountsToLineItems(baseItems, [
  {
    id: "res-a",
    discount_type: "percent",
    discount_value: 10,
    discount_percent: null,
    rate_plan_id: "rate-plan-1",
  },
]);

assert.equal(sumLineItemAmounts(ratePlanApplied), 3000);
assert.equal(ratePlanApplied.reduce((sum, item) => sum + (item.discount_amount ?? 0), 0), 0);

const prepayment = prepareCoverageLineItems(discounted, {
  invoiceKind: "prepayment",
  coverageAmount: 1000,
  alreadyCoveredAmount: 0,
});

assert.equal(prepayment.coverageAmount, 1000);
assert.equal(sumLineItemAmounts(prepayment.lineItems), 1000);
assert.equal(prepayment.fullNetTotal, 2700);

const balance = prepareCoverageLineItems(discounted, {
  invoiceKind: "balance",
  alreadyCoveredAmount: 1000,
});

assert.equal(balance.coverageAmount, 1700);
assert.equal(sumLineItemAmounts(balance.lineItems), 1700);
assert.equal(balance.fullNetTotal, 2700);

assert.throws(
  () =>
    prepareCoverageLineItems(discounted, {
      invoiceKind: "prepayment",
      coverageAmount: 3000,
      alreadyCoveredAmount: 0,
    }),
  /exceed/i
);

const editedPrepayment = prepareEditedCoverageLineItems(
  [
    {
      kind: "room_charge",
      description: "ค่าห้องพัก 3 ห้อง (11-12/5/2569)",
      quantity: 6,
      unit: "คืน",
      unit_price: 500,
      gross_amount: 3000,
      discount_amount: 0,
      amount: 3000,
      stay_dates: ["2026-05-11", "2026-05-12"],
      room_number: "201,202,203",
      reservation_id: null,
      room_count: 3,
      merged_reservation_ids: ["res-201", "res-202", "res-203"],
      merged_line_sources: [
        { reservation_id: "res-201", room_number: "201", gross_amount: 1000, discount_amount: 0, amount: 1000 },
        { reservation_id: "res-202", room_number: "202", gross_amount: 1000, discount_amount: 0, amount: 1000 },
        { reservation_id: "res-203", room_number: "203", gross_amount: 1000, discount_amount: 0, amount: 1000 },
      ],
    },
  ],
  {
    invoiceKind: "prepayment",
    coverageAmount: 1000,
  }
);

assert.equal(editedPrepayment.coverageAmount, 1000);
assert.equal(sumLineItemAmounts(editedPrepayment.lineItems), 1000);
assert.deepEqual(
  editedPrepayment.lineItems[0].merged_line_sources?.map((source) => source.amount),
  [333.33, 333.33, 333.34]
);
