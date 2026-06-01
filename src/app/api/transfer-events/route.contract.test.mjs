import assert from "node:assert/strict";
import fs from "node:fs";

const source = fs.readFileSync(new URL("./route.ts", import.meta.url), "utf8");

assert.match(source, /getFrontdeskFinancialHistoryError\(auth\.role, today, \[from, to\]\)/);
assert.match(source, /getFrontdeskFinancialHistoryCutoff\(today\)/);
assert.match(source, /effectiveFrom/);
assert.match(source, /effectiveTo/);
assert.match(source, /status: 403/);
