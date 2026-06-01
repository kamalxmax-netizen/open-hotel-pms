import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

const helperPath = resolve("src/lib/ui-event-log-categories.ts");

assert.equal(existsSync(helperPath), true);

const source = readFileSync(helperPath, "utf8");

assert.match(source, /UI_EVENT_LOG_CATEGORIES/);
assert.match(source, /activity/);
assert.match(source, /auth/);
assert.match(source, /device/);
assert.match(source, /errors/);
assert.match(source, /auth_activity/);
assert.match(source, /UI_EVENT_LOG_AUTH_ACTION_OPTIONS/);
assert.match(source, /login_succeeded/);
assert.match(source, /logout_clicked/);
assert.match(source, /smart_card/);
assert.match(source, /client_error/);
assert.match(source, /resolveUiEventLogCategory/);
assert.match(source, /getUiEventLogTypesForCategory/);
