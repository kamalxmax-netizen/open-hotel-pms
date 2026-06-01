import assert from "node:assert/strict";
import fs from "node:fs";

const source = fs.readFileSync(new URL("./page.tsx", import.meta.url), "utf8");

assert.match(source, /business_date/);
assert.match(source, /statementYear/);
assert.match(source, /statementMonth/);
assert.match(source, /reuse_active:\s*true/);
assert.match(source, /setMonthlyLink\(newMonthlyLink\)/);
assert.doesNotMatch(source, /prevMonth/);
