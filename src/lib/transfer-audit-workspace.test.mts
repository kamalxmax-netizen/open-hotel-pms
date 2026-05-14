import assert from "node:assert/strict";
import {
  addPaymentIds,
  addSameBookingGroupPaymentIds,
  addSameGroupNamePaymentIds,
  canSaveTransferSet,
  DRAFT_TRANSFER_SET_EDITOR_ID,
  findTransferAuditFocusedRow,
  getTransferSetEditorIdAfterSelect,
  getTransferSetEditorId,
  getTransferSetSaveAction,
  removePaymentId,
  shouldBlockTransferSetSwitch,
  shouldCollapseTransferSetEditor,
  splitWorkspaceCandidates,
  type TransferAuditWorkspaceCandidate,
} from "./transfer-audit-workspace.ts";

function row(
  id: string,
  options: {
    eventId?: string | null;
    bookingGroupId?: string | null;
    groupName?: string | null;
  } = {}
): TransferAuditWorkspaceCandidate {
  return {
    id,
    transfer_event_id: options.eventId ?? null,
    booking_group_id: options.bookingGroupId ?? null,
    group_name: options.groupName ?? null,
  };
}

const candidates = [
  row("p1", { eventId: "set-a", bookingGroupId: "bg-1", groupName: "Somchai Tour" }),
  row("p2", { eventId: "set-a", bookingGroupId: "bg-1", groupName: "Somchai Tour" }),
  row("p3", { eventId: null, bookingGroupId: "bg-1", groupName: "Somchai Tour" }),
  row("p4", { eventId: null, bookingGroupId: "bg-2", groupName: "Somchai Tour" }),
  row("p5", { eventId: "set-b", bookingGroupId: "bg-2", groupName: "Somchai Tour" }),
  row("p6", { eventId: "set-b", bookingGroupId: "bg-2", groupName: "Somchai Tour" }),
  row("p7", { eventId: null, bookingGroupId: "bg-3", groupName: "Other Guest" }),
];

assert.deepEqual(addPaymentIds(["p1"], ["p2", "p1", "p3"]), ["p1", "p2", "p3"]);
assert.deepEqual(removePaymentId(["p1", "p2", "p3"], "p2"), ["p1", "p3"]);

assert.deepEqual(
  splitWorkspaceCandidates(candidates, ["p1"], "set-a"),
  {
    selected: [candidates[0]],
    needsDetail: [candidates[1], candidates[2], candidates[3], candidates[6]],
  }
);

assert.deepEqual(
  findTransferAuditFocusedRow(
    [
      { id: "set-a", transfer_event_id: "event-a", payment_id: "p1", payment_ids: ["p1", "p2"] },
      { id: "p3", transfer_event_id: null, payment_id: "p3", payment_ids: ["p3"] },
    ],
    "p2"
  ),
  { id: "set-a", transfer_event_id: "event-a", payment_id: "p1", payment_ids: ["p1", "p2"] }
);

assert.deepEqual(
  findTransferAuditFocusedRow(
    [
      { id: "set-a", transfer_event_id: "event-a", payment_id: "p1", payment_ids: ["p1", "p2"] },
      { id: "p3", transfer_event_id: null, payment_id: "p3", payment_ids: ["p3"] },
    ],
    "p3"
  ),
  { id: "p3", transfer_event_id: null, payment_id: "p3", payment_ids: ["p3"] }
);

assert.equal(
  findTransferAuditFocusedRow(
    [{ id: "set-a", transfer_event_id: "event-a", payment_id: "p1", payment_ids: ["p1"] }],
    "missing"
  ),
  null
);

assert.deepEqual(
  addSameBookingGroupPaymentIds(["p1"], candidates, [candidates[0]]),
  ["p1", "p2", "p3"]
);

assert.deepEqual(
  addSameGroupNamePaymentIds(["p1"], candidates, [candidates[0]]),
  ["p1", "p2", "p3", "p4", "p5", "p6"]
);

assert.equal(getTransferSetEditorId(true, "set-a"), DRAFT_TRANSFER_SET_EDITOR_ID);
assert.equal(getTransferSetEditorId(false, "set-a"), "set-a");
assert.equal(getTransferSetEditorId(false, null), null);

assert.equal(shouldCollapseTransferSetEditor({ key: "Escape" }), true);
assert.equal(shouldCollapseTransferSetEditor({ targetInsideTransferSetControls: false }), true);
assert.equal(shouldCollapseTransferSetEditor({ targetInsideTransferSetControls: true }), false);

assert.equal(canSaveTransferSet({ draftSet: true, hasSelectedSet: false, selectedPaymentCount: 0 }), false);
assert.equal(canSaveTransferSet({ draftSet: true, hasSelectedSet: false, selectedPaymentCount: 1 }), true);
assert.equal(canSaveTransferSet({ draftSet: false, hasSelectedSet: true, selectedPaymentCount: 0 }), true);

assert.equal(
  getTransferSetSaveAction({ draftSet: false, hasSelectedSet: true, selectedPaymentCount: 0 }),
  "archive_empty"
);
assert.equal(
  getTransferSetSaveAction({ draftSet: false, hasSelectedSet: true, selectedPaymentCount: 1 }),
  "save"
);
assert.equal(
  getTransferSetSaveAction({ draftSet: true, hasSelectedSet: false, selectedPaymentCount: 0 }),
  "disabled"
);

assert.equal(
  getTransferSetEditorIdAfterSelect({ nextSetId: "set-b", currentEditorId: "set-a", expand: false }),
  null
);
assert.equal(
  getTransferSetEditorIdAfterSelect({ nextSetId: "set-b", currentEditorId: "set-a", expand: true }),
  "set-b"
);
assert.equal(
  getTransferSetEditorIdAfterSelect({ nextSetId: "set-a", currentEditorId: "set-a", expand: false }),
  "set-a"
);

assert.equal(
  shouldBlockTransferSetSwitch({ dirty: true, draftSet: false, currentSetId: "set-a", nextSetId: "set-b" }),
  true
);
assert.equal(
  shouldBlockTransferSetSwitch({ dirty: true, draftSet: false, currentSetId: "set-a", nextSetId: "set-a" }),
  false
);
assert.equal(
  shouldBlockTransferSetSwitch({ dirty: true, draftSet: true, currentSetId: null, nextSetId: "set-a" }),
  true
);
assert.equal(
  shouldBlockTransferSetSwitch({ dirty: false, draftSet: false, currentSetId: "set-a", nextSetId: "set-b" }),
  false
);
