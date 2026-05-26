import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

const routePath = resolve("src/app/api/ui-event-logs/capture-status/route.ts");

assert.equal(existsSync(routePath), true);

const source = readFileSync(routePath, "utf8");

assert.match(source, /getAuthenticatedUser/);
assert.match(source, /ui_event_log_capture_emails/);
assert.match(source, /isUiEventLogEmailAllowed/);
assert.match(source, /capture_enabled/);
assert.doesNotMatch(source, /from\("ui_event_logs"\)/);
