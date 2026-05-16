import assert from "node:assert/strict";
import {
  buildTraceStatusUpdate,
  parseTraceAction,
  TRACE_ACTION_ERROR,
} from "./trace-status";

assert.equal(parseTraceAction("restore"), "restore");
assert.equal(parseTraceAction("open"), null);
assert.equal(TRACE_ACTION_ERROR, "action must be 'done', 'cancelled', or 'restore'");

assert.deepEqual(
  buildTraceStatusUpdate({
    action: "restore",
    currentStatus: "cancelled",
    nowIso: "2026-05-16T09:00:00.000Z",
    resolvedBy: "Front Desk",
  }),
  {
    ok: true,
    update: {
      status: "open",
      resolved_at: null,
      resolved_by: null,
    },
  }
);

assert.deepEqual(
  buildTraceStatusUpdate({
    action: "restore",
    currentStatus: "done",
    nowIso: "2026-05-16T09:00:00.000Z",
    resolvedBy: "Front Desk",
  }),
  {
    ok: false,
    status: 400,
    error: "Only cancelled traces can be restored.",
  }
);

assert.deepEqual(
  buildTraceStatusUpdate({
    action: "done",
    currentStatus: "open",
    nowIso: "2026-05-16T09:00:00.000Z",
    resolvedBy: "Front Desk",
  }),
  {
    ok: true,
    update: {
      status: "done",
      resolved_at: "2026-05-16T09:00:00.000Z",
      resolved_by: "Front Desk",
    },
  }
);
