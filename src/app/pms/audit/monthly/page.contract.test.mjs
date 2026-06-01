import assert from "node:assert/strict";
import fs from "node:fs";

const source = fs.readFileSync(new URL("./page.tsx", import.meta.url), "utf8");
const handler = source.slice(
  source.indexOf("const handleChannelFlagSave"),
  source.indexOf("  // ============================================================", source.indexOf("const handleChannelFlagSave"))
);

assert.match(source, /function patchEntryChannelFlag/);
assert.match(source, /setEntries\(\(current\) => current\.map\(patch\)\)/);
assert.match(source, /setPreviewEntries\(\(current\) => current\.map\(patch\)\)/);
assert.match(handler, /patchEntryChannelFlag\(entryId,/);
assert.doesNotMatch(handler, /loadPeriodData\(\)/);
assert.doesNotMatch(handler, /loadPreviewData\(\)/);
