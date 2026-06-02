import assert from "node:assert/strict";
import fs from "node:fs";

const previewSource = fs.readFileSync(new URL("./preview/route.ts", import.meta.url), "utf8");
const eodSource = fs.readFileSync(new URL("../eod/run/route.ts", import.meta.url), "utf8");

for (const source of [previewSource, eodSource]) {
  assert.match(source, /createNightAuditPaymentDailyRequest/);
  assert.match(source, /const paymentDailyRequest = createNightAuditPaymentDailyRequest\(businessDate\)/);
  assert.doesNotMatch(source, /new URL\(`http:\/\/night-audit\.local\/api\/reports\/payment-daily\?date=\$\{businessDate\}`\)/);
}
