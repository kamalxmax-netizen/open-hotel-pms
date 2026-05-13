import assert from "node:assert/strict";
import {
  MOBILE_CHECKIN_DEPOSIT_NOTE,
  MOBILE_CHECKIN_PAYMENT_NOTE,
  hasMatchingMobileCheckinFinancial,
} from "./mobile-checkin-financials.ts";

const businessDate = "2026-05-13";

assert.equal(
  hasMatchingMobileCheckinFinancial(
    [
      {
        tx_type: "payment",
        method: "transfer",
        amount: "2580.00",
        note: MOBILE_CHECKIN_PAYMENT_NOTE,
        revenue_category: "room_revenue",
        paid_date: businessDate,
      },
    ],
    {
      txType: "payment",
      method: "transfer",
      amount: 2580,
      note: MOBILE_CHECKIN_PAYMENT_NOTE,
      revenueCategory: "room_revenue",
      paidDate: businessDate,
    }
  ),
  true,
  "matches an existing mobile check-in room payment"
);

assert.equal(
  hasMatchingMobileCheckinFinancial(
    [
      {
        tx_type: "deposit",
        method: "transfer",
        amount: 200,
        note: MOBILE_CHECKIN_DEPOSIT_NOTE,
        revenue_category: "deposit",
        paid_date: businessDate,
      },
    ],
    {
      txType: "deposit",
      method: "transfer",
      amount: 200,
      note: MOBILE_CHECKIN_DEPOSIT_NOTE,
      revenueCategory: "deposit",
      paidDate: businessDate,
    }
  ),
  true,
  "matches an existing mobile check-in deposit"
);

assert.equal(
  hasMatchingMobileCheckinFinancial(
    [
      {
        tx_type: "payment",
        method: "transfer",
        amount: 2581,
        note: MOBILE_CHECKIN_PAYMENT_NOTE,
        revenue_category: "room_revenue",
        paid_date: businessDate,
      },
    ],
    {
      txType: "payment",
      method: "transfer",
      amount: 2580,
      note: MOBILE_CHECKIN_PAYMENT_NOTE,
      revenueCategory: "room_revenue",
      paidDate: businessDate,
    }
  ),
  false,
  "does not match a different amount"
);

assert.equal(
  hasMatchingMobileCheckinFinancial(
    [
      {
        tx_type: "payment",
        method: "transfer",
        amount: 2580,
        note: MOBILE_CHECKIN_PAYMENT_NOTE,
        revenue_category: "room_revenue",
        paid_date: businessDate,
        is_void_reversal: true,
      },
    ],
    {
      txType: "payment",
      method: "transfer",
      amount: 2580,
      note: MOBILE_CHECKIN_PAYMENT_NOTE,
      revenueCategory: "room_revenue",
      paidDate: businessDate,
    }
  ),
  false,
  "ignores voided mobile check-in payments"
);

assert.equal(
  hasMatchingMobileCheckinFinancial(
    [
      {
        id: "payment-original",
        tx_type: "payment",
        method: "transfer",
        amount: 2580,
        note: MOBILE_CHECKIN_PAYMENT_NOTE,
        revenue_category: "room_revenue",
        paid_date: businessDate,
      },
      {
        id: "payment-reversal",
        tx_type: "refund",
        method: "transfer",
        amount: -2580,
        note: "Void payment",
        revenue_category: "room_revenue",
        paid_date: businessDate,
        is_void_reversal: true,
        void_of: "payment-original",
      },
    ],
    {
      txType: "payment",
      method: "transfer",
      amount: 2580,
      note: MOBILE_CHECKIN_PAYMENT_NOTE,
      revenueCategory: "room_revenue",
      paidDate: businessDate,
    }
  ),
  false,
  "ignores original payments that have a void reversal"
);

assert.equal(
  hasMatchingMobileCheckinFinancial(
    [
      {
        tx_type: "payment",
        method: "transfer",
        amount: 2580,
        note: "โอนหน้าเคาน์เตอร์",
        revenue_category: "room_revenue",
        paid_date: businessDate,
      },
    ],
    {
      txType: "payment",
      method: "transfer",
      amount: 2580,
      note: MOBILE_CHECKIN_PAYMENT_NOTE,
      revenueCategory: "room_revenue",
      paidDate: businessDate,
      allowAnyNote: true,
    }
  ),
  true,
  "can match an equivalent manual payment when recovering a stale mobile check-in retry"
);

console.log("mobile-checkin-financials tests passed");
