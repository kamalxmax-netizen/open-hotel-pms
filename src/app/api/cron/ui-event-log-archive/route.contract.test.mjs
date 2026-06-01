import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

const routePath = resolve("src/app/api/cron/ui-event-log-archive/route.ts");

assert.equal(existsSync(routePath), true);

const source = readFileSync(routePath, "utf8");

assert.match(source, /assertAuthorizedCronRequest/);
assert.match(source, /runUiEventLogArchive/);
assert.match(source, /runtime = "nodejs"/);
assert.match(source, /maxDuration = 60/);
assert.match(source, /export const POST = GET/);
