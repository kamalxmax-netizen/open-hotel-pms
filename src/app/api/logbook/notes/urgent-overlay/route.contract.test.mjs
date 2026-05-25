import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const source = readFileSync(resolve("src/app/api/logbook/notes/urgent-overlay/route.ts"), "utf8");

assert.match(source, /requireStaffAuth/);
assert.match(source, /from\("logbook_notes"\)/);
assert.match(
  source,
  /select\("id, title, body, note_type, status, priority, remind_at, archived_at, updated_at"\)/
);
assert.match(source, /\.eq\("note_type", "urgent"\)/);
assert.match(source, /\.is\("archived_at", null\)/);
assert.match(source, /\.limit\(100\)/);
assert.doesNotMatch(source, /body_rich/);
assert.doesNotMatch(source, /count: "exact"/);
assert.doesNotMatch(source, /hydrateLogbookNotes/);
