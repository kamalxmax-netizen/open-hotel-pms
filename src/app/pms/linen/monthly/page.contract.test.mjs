import assert from "node:assert/strict";
import fs from "node:fs";

const source = fs.readFileSync(new URL("./page.tsx", import.meta.url), "utf8");

assert.match(source, /MonthPicker currentDate=\{selectedDate\}/);
assert.match(source, /GenerateVendorLinkButton year=\{year\} month=\{month\}/);
assert.match(source, /const year = selectedDate\.getFullYear\(\)/);
assert.match(source, /const month = selectedDate\.getMonth\(\) \+ 1/);
