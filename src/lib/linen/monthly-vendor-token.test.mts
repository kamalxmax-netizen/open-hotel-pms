import assert from "node:assert/strict";
import {
  buildMonthlyVendorUrl,
  getBangkokMonthParts,
  getNextBangkokMonthStartIso,
  getPreviousBangkokMonth,
} from "./monthly-vendor-token.ts";

assert.deepEqual(
  getBangkokMonthParts(new Date("2026-04-30T17:00:00.000Z")),
  { year: 2026, month: 5, day: 1 },
  "Bangkok month parts should use UTC+07 day boundary"
);

assert.deepEqual(
  getPreviousBangkokMonth(new Date("2026-04-30T17:00:00.000Z")),
  { year: 2026, month: 4 },
  "Day-1 Bangkok auto mode should resolve the previous statement month"
);

assert.deepEqual(
  getPreviousBangkokMonth(new Date("2026-01-31T17:00:00.000Z")),
  { year: 2026, month: 1 },
  "February 1 Bangkok auto mode should resolve January of the same year"
);

assert.equal(
  getNextBangkokMonthStartIso(new Date("2026-05-01T03:00:00.000Z")),
  "2026-05-31T17:00:00.000Z",
  "Token generated during May Bangkok time should expire at June 1 00:00 Bangkok"
);

assert.equal(
  getNextBangkokMonthStartIso(new Date("2026-05-20T05:00:00.000Z")),
  "2026-05-31T17:00:00.000Z",
  "Manual generation later in May should still expire at the next Bangkok month boundary"
);

assert.equal(
  getNextBangkokMonthStartIso(new Date("2026-05-31T17:00:00.000Z")),
  "2026-06-30T17:00:00.000Z",
  "Generation exactly at June 1 00:00 Bangkok should expire at July 1 00:00 Bangkok"
);

assert.equal(
  buildMonthlyVendorUrl("https://pms.example.com", "abc"),
  "https://pms.example.com/linen-vendor/monthly/abc"
);

assert.equal(
  buildMonthlyVendorUrl("", "abc"),
  "/linen-vendor/monthly/abc"
);
