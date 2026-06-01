import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

const helperPath = resolve("src/lib/ui-event-log-archive.ts");
const supabaseCronMigrationPath = resolve("supabase/migrations/20260531134927_ui_event_log_supabase_cron.sql");

assert.equal(existsSync(helperPath), true);
assert.equal(existsSync(supabaseCronMigrationPath), true);

const source = readFileSync(helperPath, "utf8");
const supabaseCronMigration = readFileSync(supabaseCronMigrationPath, "utf8");

assert.match(source, /runUiEventLogArchive/);
assert.match(source, /ui_event_log_archive_runs/);
assert.match(source, /archives\/ui_event_logs/);
assert.match(source, /createHash\("sha256"\)/);
assert.match(source, /gzipSync/);
assert.match(source, /Delete/);
assert.match(source, /retentionPolicy/);
assert.match(supabaseCronMigration, /ui_event_log_archive_http/);
assert.match(supabaseCronMigration, /\/api\/cron\/ui-event-log-archive/);
assert.match(supabaseCronMigration, /net\.http_post/);
