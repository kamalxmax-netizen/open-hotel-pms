import assert from "node:assert/strict";
import {
  summarizeDailyRevenue,
  summarizeRevenueRange,
  sumExtraRevenue,
  sumPosRevenue,
} from "./revenue-reporting.ts";

const rooms = [
  { id: "101", room_number: "101", floor_number: 1, is_dayuse: false, closure_reason: null, is_sellable: true },
  { id: "102", room_number: "102", floor_number: 1, is_dayuse: false, closure_reason: null, is_sellable: true },
  { id: "DU1", room_number: "DU1", floor_number: 1, is_dayuse: true, closure_reason: null, is_sellable: true },
];

const nights = [
  {
    room_id: "101",
    stay_date: "2026-05-14",
    nightly_price: 1000,
    reservations: {
      id: "res-101",
      guest_name: "Regular Guest",
      booking_code: "BK-101",
      source: "walkin",
      checkin_date: "2026-05-14",
      checkout_date: "2026-05-15",
      is_dayuse: false,
      status: "active",
    },
  },
  {
    room_id: "DU1",
    stay_date: "2026-05-14",
    nightly_price: 500,
    reservations: {
      id: "res-du",
      guest_name: "Day Use Guest",
      booking_code: "BK-DU",
      source: "walkin",
      checkin_date: "2026-05-14",
      checkout_date: "2026-05-14",
      is_dayuse: true,
      status: "checked_out",
    },
  },
];

const extraRows = [
  {
    id: "extra-cash",
    tx_type: "payment",
    amount: 200,
    revenue_category: "extra_charge",
    is_record_only: false,
    room_number: "101",
    booking_code: "BK-101",
    guest_name: "Regular Guest",
  },
  {
    id: "extra-record-only",
    tx_type: "payment",
    amount: 300,
    revenue_category: "extra_charge",
    is_record_only: true,
    room_number: "102",
    booking_code: "BK-102",
    guest_name: "Record Guest",
  },
  {
    id: "deposit-in",
    tx_type: "deposit",
    amount: 790,
    revenue_category: "deposit",
    is_record_only: false,
  },
  {
    id: "deposit-out",
    tx_type: "refund",
    amount: 790,
    revenue_category: "deposit",
    note: "Deposit refund",
    is_record_only: false,
  },
  {
    id: "extra-voided",
    tx_type: "payment",
    amount: 999,
    revenue_category: "extra_charge",
    is_record_only: false,
  },
  {
    id: "extra-void-reversal",
    tx_type: "refund",
    amount: 999,
    revenue_category: "extra_charge",
    is_record_only: false,
    is_void_reversal: true,
    void_of: "extra-voided",
  },
];

assert.equal(sumExtraRevenue(extraRows), 500);

assert.equal(
  sumPosRevenue([
    { total: 120, status: "completed" },
    { total: 300, status: "voided" },
  ]),
  120
);

const daily = summarizeDailyRevenue({
  rooms,
  nights,
  extraRows,
  posOrders: [
    { total: 120, status: "completed" },
    { total: 300, status: "voided" },
  ],
  businessDate: "2026-05-14",
});

assert.equal(daily.sellableRooms, 2);
assert.equal(daily.occupiedRooms, 1);
assert.equal(daily.roomRevenue, 1000);
assert.equal(daily.dayuseRevenue, 500);
assert.equal(daily.extraRevenue, 500);
assert.deepEqual(daily.extraCharges, [
  {
    id: "extra-cash",
    room_number: "101",
    amount: 200,
    note: null,
    tx_type: "payment",
    booking_code: "BK-101",
    guest_name: "Regular Guest",
    is_record_only: false,
  },
  {
    id: "extra-record-only",
    room_number: "102",
    amount: 300,
    note: null,
    tx_type: "payment",
    booking_code: "BK-102",
    guest_name: "Record Guest",
    is_record_only: true,
  },
]);
assert.equal(daily.posRevenue, 120);
assert.equal(daily.totalRevenueExcludingPos, 2000);
assert.equal(daily.totalRevenueIncludingPos, 2120);
assert.equal(daily.adr, 1000);
assert.equal(daily.revpar, 500);
assert.equal(daily.occupancyPct, 50);

const range = summarizeRevenueRange({
  rooms,
  nights,
  extraRows: extraRows.map((row) => ({ ...row, paid_date: "2026-05-14" })),
  posOrders: [
    { total: 120, status: "completed", order_date: "2026-05-14" },
    { total: 300, status: "voided", order_date: "2026-05-14" },
  ],
  startDate: "2026-05-14",
  endDate: "2026-05-14",
});

assert.equal(range.kpi.room_nights, 2);
assert.equal(range.kpi.occupied_nights, 1);
assert.equal(range.kpi.room_revenue, 1000);
assert.equal(range.kpi.dayuse_revenue, 500);
assert.equal(range.kpi.extra_revenue, 500);
assert.equal(range.kpi.pos_revenue, 120);
assert.equal(range.kpi.total_revenue, 2120);
assert.equal(range.kpi.adr, 1000);
assert.equal(range.kpi.revpar, 500);
assert.deepEqual(range.by_day, [
  {
    date: "2026-05-14",
    revenue: 2120,
    room_revenue: 1000,
    dayuse_revenue: 500,
    extra_revenue: 500,
    pos_revenue: 120,
    total_revenue: 2120,
    occupied: 1,
    occ_pct: 50,
  },
]);
