import assert from "node:assert/strict";
import {
  getExactTransferDepositSplit,
  getTransferDepositSplitAmount,
  getTransferDepositSplitTotal,
} from "./transfer-deposit-split.ts";

assert.deepEqual(
  getExactTransferDepositSplit({
    folioAmount: "500",
    actualTransferAmount: "700",
    depositTargetAmount: "200",
  }),
  {
    ok: true,
    folioAmount: 500,
    depositAmount: 200,
    actualTransferAmount: 700,
  }
);

assert.deepEqual(
  getExactTransferDepositSplit({
    folioAmount: "500",
    actualTransferAmount: "650",
    depositTargetAmount: "200",
  }),
  { ok: false }
);

assert.deepEqual(
  getExactTransferDepositSplit({
    folioAmount: "500",
    actualTransferAmount: "700",
    depositTargetAmount: "0",
  }),
  { ok: false }
);

assert.deepEqual(
  getExactTransferDepositSplit({
    folioAmount: "500",
    actualTransferAmount: "500",
    depositTargetAmount: "200",
  }),
  { ok: false }
);

assert.equal(getTransferDepositSplitAmount({ deposit_amount: "200" }), 200);
assert.equal(getTransferDepositSplitAmount({ deposit_amount: "0" }), 0);
assert.equal(getTransferDepositSplitAmount(null), 0);

assert.equal(
  getTransferDepositSplitTotal([
    { transfer_deposit_split: { deposit_amount: "200.50" } },
    { transfer_deposit_split: { deposit_amount: 99.5 } },
    { transfer_deposit_split: null },
  ]),
  300
);
