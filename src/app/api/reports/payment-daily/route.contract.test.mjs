import assert from "node:assert/strict";
import fs from "node:fs";

const source = fs.readFileSync(new URL("./route.ts", import.meta.url), "utf8");

assert.match(source, /requireStaffAuth\(supabase, request\)/);
assert.match(source, /getFrontdeskFinancialHistoryError\(auth\.role, currentBusinessDate, \[businessDate\]\)/);
assert.match(source, /status: 403/);
