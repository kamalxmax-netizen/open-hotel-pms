import assert from "node:assert/strict";
import fs from "node:fs";

const source = fs.readFileSync(new URL("./sidebar.tsx", import.meta.url), "utf8");

assert.match(source, /href: "\/pms\/board", label: "Room Rack"/);
assert.doesNotMatch(source, /Room Diary/);
