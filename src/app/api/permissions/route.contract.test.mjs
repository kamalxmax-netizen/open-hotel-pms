import assert from "node:assert/strict";
import fs from "node:fs";

const source = fs.readFileSync(new URL("./route.ts", import.meta.url), "utf8");

assert.match(source, /path: "\/pms\/board", label: "Room Rack"/);
assert.doesNotMatch(source, /Room Diary/);
