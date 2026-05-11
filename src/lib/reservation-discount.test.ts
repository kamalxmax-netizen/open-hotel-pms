import assert from "node:assert/strict";
import { computeReservationDiscountAmount } from "./reservation-discount";

assert.equal(
  computeReservationDiscountAmount({
    totalPrice: 6240,
    discountType: "percent",
    discountValue: 10,
    checkinDate: "2026-05-11",
    checkoutDate: "2026-05-23",
  }),
  624
);

assert.equal(
  computeReservationDiscountAmount({
    totalPrice: 1000,
    discountType: "fixed_total",
    discountValue: 1200,
    checkinDate: "2026-05-11",
    checkoutDate: "2026-05-12",
  }),
  1000
);

assert.equal(
  computeReservationDiscountAmount({
    totalPrice: 6240,
    discountType: "fixed_per_night",
    discountValue: 20,
    checkinDate: "2026-05-11",
    checkoutDate: "2026-05-23",
  }),
  240
);
