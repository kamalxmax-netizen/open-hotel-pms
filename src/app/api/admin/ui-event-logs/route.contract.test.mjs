import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const source = readFileSync(resolve("src/app/api/admin/ui-event-logs/route.ts"), "utf8");

assert.match(source, /category/);
assert.match(source, /auth_action/);
assert.match(source, /event_name", params\.authAction/);
assert.match(source, /getUiEventLogTypesForCategory/);
assert.match(source, /resolveUiEventLogCategory/);
assert.match(source, /archive_status/);
assert.match(source, /from\("ui_event_logs"\)\.select\("\*"/);
assert.match(source, /deleteFilteredUiEventLogsInBatches/);
assert.match(source, /FILTERED_DELETE_PAGE_SIZE/);
assert.match(source, /\.limit\(FILTERED_DELETE_PAGE_SIZE\)/);
assert.match(source, /partial/);
