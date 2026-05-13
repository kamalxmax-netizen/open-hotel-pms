import assert from "node:assert/strict";
import {
  applyDefaultTransferSender,
  buildManualTransferDetailPayloadFromDraft,
  buildTransferDetailPreview,
  computeTransferAuditDelta,
  normalizeTransferSenderName,
  parseManualTransferDetail,
} from "./transfer-detail.ts";

const now = new Date("2026-05-12T12:00:00+07:00");

const parsed = parseManualTransferDetail(
  {
    actual_amount: "1400.00",
    sender_name: "  K. Somchai  ",
    bank_ref: " SCB123456 ",
    transfer_at: "2026-05-12T11:45:00+07:00",
    note: " Key deposit included ",
  },
  now
);

assert.equal(parsed.ok, true);
if (parsed.ok) {
  assert.equal(parsed.value.actualAmount, 1400);
  assert.equal(parsed.value.senderName, "K. Somchai");
  assert.equal(parsed.value.bankRef, "SCB123456");
  assert.equal(parsed.value.transferAt, "2026-05-12T04:45:00.000Z");
  assert.equal(parsed.value.note, "Key deposit included");
  assert.equal(
    buildTransferDetailPreview(parsed.value),
    "K. Somchai · Ref SCB123456 · 12/05/2026 11:45"
  );
}

assert.deepEqual(
  parseManualTransferDetail(
    {
      actual_amount: 500,
      transfer_at: "2026-05-12T12:01:00+07:00",
    },
    now
  ),
  { ok: false, error: "Transfer time cannot be in the future." }
);

assert.deepEqual(
  parseManualTransferDetail(
    {
      actual_amount: 0,
      transfer_at: "2026-05-12T11:45:00+07:00",
    },
    now
  ),
  { ok: false, error: "Transfer actual amount must be greater than 0." }
);

assert.deepEqual(computeTransferAuditDelta(1400, 1400), {
  delta: 0,
  status: "matched",
});

assert.deepEqual(computeTransferAuditDelta(1400, 1000), {
  delta: 400,
  status: "difference",
});

assert.equal(normalizeTransferSenderName("  Mary   Smith  "), "Mary Smith");
assert.equal(normalizeTransferSenderName("   "), "");
assert.equal(normalizeTransferSenderName(null), "");

assert.deepEqual(
  applyDefaultTransferSender({ senderName: "", note: "keep" }, "  Mary   Smith  "),
  { senderName: "Mary Smith", note: "keep" }
);

assert.deepEqual(
  applyDefaultTransferSender({ senderName: "Manual Sender", note: "keep" }, "Mary Smith"),
  { senderName: "Manual Sender", note: "keep" }
);

assert.equal(
  buildManualTransferDetailPayloadFromDraft({
    actualAmount: "",
    senderName: "Mary Smith",
    bankRef: "",
    transferAt: "2026-05-12T11:45",
    note: "",
  }),
  undefined
);

assert.deepEqual(
  buildManualTransferDetailPayloadFromDraft({
    actualAmount: "700",
    senderName: "Mary Smith",
    bankRef: "SCB700",
    transferAt: "2026-05-12T11:45",
    note: "Deposit included",
  }),
  {
    actual_amount: "700",
    sender_name: "Mary Smith",
    bank_ref: "SCB700",
    transfer_at: new Date("2026-05-12T11:45").toISOString(),
    note: "Deposit included",
  }
);
