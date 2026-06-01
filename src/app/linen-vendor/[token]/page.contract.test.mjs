import assert from "node:assert/strict";
import fs from "node:fs";

const source = fs.readFileSync(new URL("./page.tsx", import.meta.url), "utf8");

assert.match(source, /data\.monthly_vendor\?\.url/);
assert.match(source, /สรุปรายเดือนสำหรับร้าน/);
assert.match(source, /href=\{data\.monthly_vendor\.url\}/);
