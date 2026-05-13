import assert from "node:assert/strict";
import {
  bangkokDateFromIso,
  buildTransferAuditNote,
  parseTransferAuditDetail,
  roundMoney,
} from "./transfer-audit.ts";

const parsed = parseTransferAuditDetail(
  {
    sender_name: "  คุณ สมชาย  ",
    bank_ref: "  REF-123  ",
    transfer_at: "2026-05-12T10:00:00.000Z",
    note: "  paid together  ",
  },
  new Date("2026-05-12T11:00:00.000Z")
);
assert.equal(parsed.ok, true);
assert.deepEqual(parsed.ok ? parsed.value : null, {
  senderName: "คุณ สมชาย",
  bankRef: "REF-123",
  transferAt: "2026-05-12T10:00:00.000Z",
  note: "paid together",
});

const future = parseTransferAuditDetail(
  { transfer_at: "2026-05-12T12:00:00.000Z" },
  new Date("2026-05-12T11:00:00.000Z")
);
assert.equal(future.ok, false);

const originalTz = process.env.TZ;
try {
  process.env.TZ = "UTC";
  const bangkokLocal = parseTransferAuditDetail(
    { transfer_at: "2026-05-12T18:00" },
    new Date("2026-05-12T11:30:00.000Z")
  );
  assert.equal(bangkokLocal.ok, true);
  if (bangkokLocal.ok) {
    assert.equal(bangkokLocal.value.transferAt, "2026-05-12T11:00:00.000Z");
  }
} finally {
  if (originalTz === undefined) {
    delete process.env.TZ;
  } else {
    process.env.TZ = originalTz;
  }
}

assert.equal(roundMoney("1,234.567"), 1234.57);
assert.equal(bangkokDateFromIso("2026-05-12T17:30:00.000Z"), "2026-05-13");
assert.equal(
  buildTransferAuditNote({
    transferAt: "2026-05-12T11:00:00.000Z",
    senderName: "คุณสมชาย",
    bankRef: "ABC",
    totalAmount: 1400,
  }),
  "โอน 12/05 18:00 คุณสมชาย รวม฿1,400.00 Ref ABC"
);
