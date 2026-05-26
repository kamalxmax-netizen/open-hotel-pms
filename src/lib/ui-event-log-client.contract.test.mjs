import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const source = readFileSync("src/lib/ui-event-log-client.ts", "utf8");

assert.match(source, /MAX_BATCH_EVENTS = 200/);
assert.match(source, /CAPTURE_STATUS_ENDPOINT = "\/api\/ui-event-logs\/capture-status"/);
assert.match(source, /fetch\("\/api\/ui-event-logs\/batch"/);
assert.match(source, /"X-PMS-UI-Event-Log-Manual"/);
assert.doesNotMatch(source, /if \(EGRESS_STRICT_MODE && !manualCaptureEnabled\) return;/);
assert.doesNotMatch(source, /navigator\.sendBeacon/);
assert.doesNotMatch(source, /\[\.\.\.persisted,\s*\.\.\.eventQueue\]/);
