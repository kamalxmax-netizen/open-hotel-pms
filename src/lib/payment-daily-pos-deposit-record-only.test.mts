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
  /const isRecordOnly = payment\.is_record_only === true && !isPosDeposit && !isPosRemainder;/,
  "Payment Daily must count POS paid-by-deposit record-only rows as cash movement"
);

assert.match(
  movementRules,
  /const method: MethodKey = isPosDeposit \? "cash" : rawMethod;/,
  "Payment Daily must force POS paid-by-deposit rows into Cash"
);

assert.match(
  movementRules,
  /const txType: TxType = isPosDeposit \? "payment" : rawTxType;/,
  "Payment Daily must treat POS paid-by-deposit rows as payments"
);
