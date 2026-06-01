import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const source = readFileSync(resolve("src/app/api/ui-event-logs/batch/route.ts"), "utf8");

assert.match(source, /MAX_BATCH_EVENTS = 200/);
assert.match(source, /skipUiEventLogsForStrictMode/);
assert.match(source, /x-pms-ui-event-log-manual/);
assert.match(source, /getAuthenticatedUser/);
assert.match(source, /ui_event_log_capture_emails/);
assert.match(source, /isUiEventLogEmailAllowed/);
assert.match(source, /getSafeClientCapturedAt/);
assert.match(source, /created_at: getSafeClientCapturedAt\(metadata\)/);
assert.match(source, /from\("ui_event_logs"\)\.insert\(rows\)/);
assert.doesNotMatch(source, /from\("ui_event_logs"\)\.insert\(rows\)[\s\S]*?\.select\(/);
