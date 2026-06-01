import assert from "node:assert/strict";
import {
  getFrontdeskFinancialHistoryCutoff,
  getFrontdeskFinancialHistoryError,
} from "./financial-history-access.ts";

assert.equal(getFrontdeskFinancialHistoryCutoff("2026-06-01"), "2026-04-17");

assert.equal(
  getFrontdeskFinancialHistoryError("frontdesk", "2026-06-01", ["2026-04-17"]),
  null
);
assert.equal(
  getFrontdeskFinancialHistoryError("frontdesk", "2026-06-01", ["2026-04-16"]),
  "Front Desk can view financial history up to 45 days."
);
assert.equal(
  getFrontdeskFinancialHistoryError("admin", "2026-06-01", ["2026-01-01"]),
  null
);
