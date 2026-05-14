import assert from "node:assert/strict";
import { buildPaymentDailyTransferAuditHref } from "./payment-daily-transfer-audit-link.ts";

assert.equal(
  buildPaymentDailyTransferAuditHref({
    method: "transfer",
    transferEventId: "event-123",
    paymentId: "payment-123",
    paidDate: "2026-05-14",
    fallbackDate: "2026-05-13",
  }),
  "/pms/transfer-audit?focus=event-123&from=2026-05-14&to=2026-05-14"
);

assert.equal(
  buildPaymentDailyTransferAuditHref({
    method: "transfer",
    transferEventId: null,
    paymentId: "payment-456",
    paidDate: "2026-05-14",
    fallbackDate: "2026-05-13",
  }),
  "/pms/transfer-audit?focus=payment-456&from=2026-05-14&to=2026-05-14"
);

assert.equal(
  buildPaymentDailyTransferAuditHref({
    method: "transfer",
    transferEventId: "event-456",
    paymentId: "payment-456",
    paidDate: "not-a-date",
    fallbackDate: "2026-05-13",
  }),
  "/pms/transfer-audit?focus=event-456&from=2026-05-13&to=2026-05-13"
);

assert.equal(
  buildPaymentDailyTransferAuditHref({
    method: "cash",
    transferEventId: "event-123",
    paymentId: "payment-123",
    paidDate: "2026-05-14",
    fallbackDate: "2026-05-13",
  }),
  null
);

assert.equal(
  buildPaymentDailyTransferAuditHref({
    method: "transfer",
    transferEventId: null,
    paymentId: null,
    paidDate: "2026-05-14",
    fallbackDate: "2026-05-13",
  }),
  null
);
