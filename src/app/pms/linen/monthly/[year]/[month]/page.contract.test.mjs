import assert from "node:assert/strict";
import fs from "node:fs";

const source = fs.readFileSync(new URL("./page.tsx", import.meta.url), "utf8");

assert.match(source, /MonthPicker currentDate=\{selectedDate\}/);
assert.match(source, /router\.push\(`\/pms\/linen\/monthly\/\$\{date\.getFullYear\(\)\}\/\$\{date\.getMonth\(\) \+ 1\}`\)/);
assert.match(source, /GenerateVendorLinkButton year=\{year\} month=\{month\}/);
assert.doesNotMatch(source, /body:\s*JSON\.stringify\(\{\s*year,\s*month\s*\}\)/);
