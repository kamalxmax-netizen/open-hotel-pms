import assert from "node:assert/strict";
import fs from "node:fs";

const source = fs.readFileSync(new URL("./service.ts", import.meta.url), "utf8");
const nightAllocationSource = fs.readFileSync(new URL("./night-allocation.ts", import.meta.url), "utf8");

const loadNightsBlock = source.match(/async function loadNights[\s\S]*?async function loadFolioRows/)?.[0] ?? "";
assert.match(loadNightsBlock, /cancelled_at/);
assert.doesNotMatch(loadNightsBlock, /\.is\("cancelled_at", null\)/);
assert.match(loadNightsBlock, /\.range\(/);
assert.match(source, /RESERVATION_NIGHT_PAGE_SIZE = 1000/);

assert.match(source, /refund_total:\s*number;/);
assert.match(source, /\.select\("id, period_id, reservation_id, source, guest_name, checkin_date, checkout_date, room_revenue, extra_revenue, total_revenue, refund_total, outstanding"\)/);

assert.match(nightAllocationSource, /function completeChargedReservationNightsFromAuditTotal/);
assert.match(nightAllocationSource, /refundTotal > 0/);
assert.match(nightAllocationSource, /candidateTotal/);
assert.match(nightAllocationSource, /Math\.abs\(candidateTotal - residualTotal\) > 0\.01/);
assert.match(nightAllocationSource, /function applyCoveredRoomRevenueToNights/);
assert.match(nightAllocationSource, /function computeInvoiceableRoomTotal/);
assert.match(nightAllocationSource, /function allocateRoomAndExtraAcrossNights/);
assert.match(source, /covered_room_revenue_by_stay_date/);
assert.match(source, /applyCoveredRoomRevenueToNights/);
assert.match(source, /allocateRoomAndExtraAcrossNights/);

const buildRoomPreviewBlock = source.match(/async function buildRoomPreview[\s\S]*?const drafts = assignSequentialInvoiceNumbers/)?.[0] ?? "";
const completeIndex = buildRoomPreviewBlock.indexOf("const completedNights = completeChargedReservationNightsFromAuditTotal");
const includedIndex = buildRoomPreviewBlock.indexOf("const includedNights = nights.filter");
assert.ok(completeIndex > -1, "buildRoomPreview should complete charged nights from audit totals");
assert.ok(includedIndex > -1, "buildRoomPreview should still filter included nights");
assert.ok(completeIndex < includedIndex, "charged cancelled nights must be restored before include/carry filtering");
