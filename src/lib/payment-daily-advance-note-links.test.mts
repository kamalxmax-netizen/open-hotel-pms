import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const pagePath = resolve(dirname(fileURLToPath(import.meta.url)), "../app/pms/payment-daily/page.tsx");
const source = readFileSync(pagePath, "utf8");
const start = source.indexOf("advanceGroupSections.map");
const end = source.indexOf("{/* Advance Subtotal Row */}");
assert.notEqual(start, -1, "Payment Daily advance group section should be present");
assert.notEqual(end, -1, "Payment Daily advance subtotal marker should be present");

const advanceSection = source.slice(start, end);
const noteCapsuleUses = advanceSection.match(/<NoteCapsules notes=\{adv\.notes\}/g) ?? [];

assert.equal(
  noteCapsuleUses.length,
  2,
  "Advance payment notes must render through NoteCapsules in group and normal views so href remains clickable"
);
assert.equal(
  advanceSection.includes("adv.notes.map((note"),
  false,
  "Advance payment notes must not be re-rendered as plain badges because that drops href"
);
