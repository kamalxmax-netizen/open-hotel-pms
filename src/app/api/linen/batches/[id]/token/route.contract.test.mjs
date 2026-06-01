import assert from "node:assert/strict";
import fs from "node:fs";

const source = fs.readFileSync(new URL("./route.ts", import.meta.url), "utf8");

assert.match(source, /createMonthlyVendorToken/);
assert.match(source, /getLatestMonthlyVendorName/);
assert.match(source, /firstDayStatementMonth/);
assert.match(source, /business_date/);
assert.match(source, /monthly_vendor/);
assert.match(source, /reuseActive:\s*true/);
assert.doesNotMatch(source, /getPreviousBangkokMonth/);
