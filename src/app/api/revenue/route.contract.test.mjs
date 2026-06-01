import assert from "node:assert/strict";
import fs from "node:fs";

const source = fs.readFileSync(new URL("./route.ts", import.meta.url), "utf8");

assert.match(source, /REVENUE_REPORT_PAGE_SIZE = 1000/);
assert.match(source, /async function fetchRevenueRows/);
assert.match(source, /\.range\(offset, offset \+ REVENUE_REPORT_PAGE_SIZE - 1\)/);
assert.match(source, /fetchRevenueRows<RevenueNightRow>/);
assert.match(source, /fetchRevenueRows<RevenuePosOrderRow>/);
assert.match(source, /fetchRevenueRows<RevenueExtraRow>/);
assert.match(source, /fetchRevenueRows<RevenueDayuseRow>/);
assert.doesNotMatch(source, /count:\s*["']exact["']/);
