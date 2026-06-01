import assert from "node:assert/strict";
import fs from "node:fs";

const source = fs.readFileSync(new URL("./service.ts", import.meta.url), "utf8");

const loadNightsBlock = source.match(/async function loadNights[\s\S]*?async function loadFolioRows/)?.[0] ?? "";
assert.match(loadNightsBlock, /cancelled_at/);
assert.doesNotMatch(loadNightsBlock, /\.is\("cancelled_at", null\)/);

assert.match(source, /refund_total:\s*number;/);
assert.match(source, /\.select\("id, period_id, reservation_id, source, guest_name, checkin_date, checkout_date, room_revenue, extra_revenue, total_revenue, refund_total, outstanding"\)/);

assert.match(source, /function completeChargedReservationNightsFromAuditTotal/);
assert.match(source, /refundTotal > 0/);
assert.match(source, /candidateTotal/);
assert.match(source, /Math\.abs\(candidateTotal - residualTotal\) > 0\.01/);

const buildRoomPreviewBlock = source.match(/async function buildRoomPreview[\s\S]*?const drafts = assignSequentialInvoiceNumbers/)?.[0] ?? "";
const completeIndex = buildRoomPreviewBlock.indexOf("const nights = completeChargedReservationNightsFromAuditTotal");
const includedIndex = buildRoomPreviewBlock.indexOf("const includedNights = nights.filter");
assert.ok(completeIndex > -1, "buildRoomPreview should complete charged nights from audit totals");
assert.ok(includedIndex > -1, "buildRoomPreview should still filter included nights");
assert.ok(completeIndex < includedIndex, "charged cancelled nights must be restored before include/carry filtering");
