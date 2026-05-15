import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const routePath = resolve(dirname(fileURLToPath(import.meta.url)), "../app/api/reports/payment-daily/route.ts");
const source = readFileSync(routePath, "utf8");
const loopStart = source.indexOf("const isPosDeposit = isPosDepositRecord(rawTxType, category, note);");
const loopEnd = source.indexOf("const reservation = reservationId ? reservationMap.get(reservationId) : undefined;", loopStart);

assert.notEqual(loopStart, -1, "Payment Daily payment loop should detect POS paid-by-deposit rows");
assert.notEqual(loopEnd, -1, "Payment Daily payment loop should resolve reservation after movement rules");

const movementRules = source.slice(loopStart, loopEnd);

assert.match(
  movementRules,
  /const isRecordOnly = payment\.is_record_only === true;/,
  "Payment Daily room rows must keep POS paid-by-deposit rows record-only"
);

assert.match(
  movementRules,
  /const method: MethodKey = rawMethod;/,
  "Payment Daily room movement must not force POS paid-by-deposit rows into Cash"
);

assert.match(
  movementRules,
  /const txType: TxType = rawTxType;/,
  "Payment Daily room movement must leave POS paid-by-deposit rows as record-only trace rows"
);

const posStart = source.indexOf("const posMethodsRaw = createMethodsMap();");
const posEnd = source.indexOf("const pos = finalizeMethods(posMethodsRaw);", posStart);
assert.notEqual(posStart, -1, "Payment Daily should build POS methods");
assert.notEqual(posEnd, -1, "Payment Daily should finalize POS methods");

const posSection = source.slice(posStart, posEnd);

assert.match(
  posSection,
  /for \(const payment of paymentRowsForDay\)/,
  "Payment Daily POS section must include room-charge POS folio rows"
);
assert.match(
  posSection,
  /if \(!payment\.pos_order_id\) continue;/,
  "Payment Daily POS section must only add folio rows tied to POS orders"
);
assert.match(
  posSection,
  /if \(rawTxType !== "payment" \|\| category !== "pos_revenue"\) continue;/,
  "Payment Daily POS section must only add POS revenue payments"
);
assert.match(
  posSection,
  /if \(!isPosDeposit && !isPosRemainder\) continue;/,
  "Payment Daily POS section must only add paid-by-deposit and POS remainder folio rows"
);
assert.match(
  posSection,
  /const method = isPosDeposit \? "cash" : normalizeMethod\(payment\.method\);/,
  "Payment Daily POS section must show paid-by-deposit POS under Cash"
);
