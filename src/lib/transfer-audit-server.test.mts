import assert from "node:assert/strict";
import {
  collectForeignTransferEventIds,
  findPartialForeignTransferEventIds,
  type TransferAuditMergePayment,
} from "./transfer-audit-merge.ts";

function payment(id: string, transferEventId: string | null): TransferAuditMergePayment {
  return {
    id,
    transfer_event_id: transferEventId,
  };
}

const selected = [
  payment("p1", "target-event"),
  payment("p2", "source-event-a"),
  payment("p3", "source-event-a"),
  payment("p4", "source-event-b"),
  payment("p5", null),
];

assert.deepEqual(
  collectForeignTransferEventIds(selected, "target-event"),
  ["source-event-a", "source-event-b"]
);

assert.deepEqual(
  findPartialForeignTransferEventIds(
    [payment("p2", "source-event-a"), payment("p4", "source-event-b")],
    new Map([
      ["source-event-a", ["p2", "p3"]],
      ["source-event-b", ["p4"]],
    ]),
    "target-event"
  ),
  ["source-event-a"]
);
