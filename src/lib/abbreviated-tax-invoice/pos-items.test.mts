import assert from "node:assert/strict";
import { mapCompletedPositivePosItemRows } from "./pos-items.ts";

const rows = mapCompletedPositivePosItemRows([
  {
    order_id: "walkin-disabled-product",
    product_id: "car-park",
    quantity: 1,
    unit_price: 20,
    line_total: 20,
    pos_orders: {
      order_number: "POS-20260404-0052",
      order_date: "2026-04-04",
      order_type: "walkin",
      status: "completed",
    },
    products: {
      name: "Car park rental",
      name_th: "",
      pos_abbreviated_enabled: false,
    },
  },
  {
    order_id: "guest-charge-coffee",
    product_id: "coffee",
    quantity: 1,
    unit_price: 20,
    line_total: 20,
    pos_orders: {
      order_number: "POS-20260409-0083",
      order_date: "2026-04-09",
      order_type: "guest_charge",
      status: "completed",
    },
    products: {
      name: "Coffee",
      name_th: "กาแฟ",
      pos_abbreviated_enabled: true,
    },
  },
  {
    order_id: "guest-charge-free-water",
    product_id: "water",
    quantity: 1,
    unit_price: 0,
    line_total: 0,
    pos_orders: {
      order_number: "POS-20260409-0084",
      order_date: "2026-04-09",
      order_type: "guest_charge",
      status: "completed",
    },
    products: {
      name: "Water",
      name_th: "น้ำดื่ม",
      pos_abbreviated_enabled: true,
    },
  },
  {
    order_id: "pending-walkin",
    product_id: "coffee",
    quantity: 1,
    unit_price: 20,
    line_total: 20,
    pos_orders: {
      order_number: "POS-20260409-0085",
      order_date: "2026-04-09",
      order_type: "walkin",
      status: "pending",
    },
    products: {
      name: "Coffee",
      name_th: "กาแฟ",
      pos_abbreviated_enabled: true,
    },
  },
]);

assert.deepEqual(
  rows.map((row) => row.order_id),
  ["guest-charge-coffee"]
);
assert.equal(
  rows.reduce((sum, row) => sum + row.amount, 0),
  20
);
assert.deepEqual(
  rows.map((row) => row.label_th),
  ["กาแฟ"]
);
