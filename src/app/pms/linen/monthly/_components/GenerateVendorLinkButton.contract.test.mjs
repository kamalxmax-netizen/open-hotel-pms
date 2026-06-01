import assert from "node:assert/strict";
import fs from "node:fs";

const source = fs.readFileSync(new URL("./GenerateVendorLinkButton.tsx", import.meta.url), "utf8");

assert.match(source, /body:\s*JSON\.stringify\(\{\s*year,\s*month\s*\}\)/);
assert.match(source, /ยอดเดือน \{month\}\/\{year\}/);
assert.doesNotMatch(source, /new Date\(\)\.getMonth/);
