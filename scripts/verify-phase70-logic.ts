import assert from "node:assert/strict";
import {
  computeAbbreviatedInvoiceNo,
  computeAbbreviatedStayRange,
  computeAutoShift,
  computeBookNo,
  computeVatBreakdown,
  groupLinesForDay,
  mapActualChannelToGroup,
} from "@/lib/abbreviated-tax-invoice/service";
import type { AbbreviatedInvoiceDraft } from "@/lib/abbreviated-tax-invoice/types";

assert.equal(computeAbbreviatedInvoiceNo("2026-03-01", "ota"), "690301");
assert.equal(computeAbbreviatedInvoiceNo("2026-03-01", "walkin_direct"), "W690301");
assert.equal(computeBookNo("2026-03-01"), 8);
assert.deepEqual(computeAbbreviatedStayRange("2026-03-29"), { from: "2026-03-28", to: "2026-03-29" });
assert.deepEqual(computeAbbreviatedStayRange("2026-03-01"), { from: "2026-02-28", to: "2026-03-01" });

assert.equal(mapActualChannelToGroup("ota"), "ota");
assert.equal(mapActualChannelToGroup("agent"), "ota");
assert.equal(mapActualChannelToGroup("walkin"), "walkin_direct");
assert.equal(mapActualChannelToGroup("direct"), "walkin_direct");

assert.deepEqual(computeVatBreakdown(107), { inc: 107, ex: 100, vat: 7 });

const groupedLines = groupLinesForDay([
  {
    entry_id: "00000000-0000-0000-0000-000000000001",
    reservation_id: "10000000-0000-0000-0000-000000000001",
    guest_name: "A",
    checkin_date: "2026-03-01",
    checkout_date: "2026-03-02",
    issue_date: "2026-03-01",
    stay_date: "2026-03-01",
    channel_group: "ota",
    tax_invoice_channel: "ota",
    tax_group: "A",
    label_th: "ห้องพักแบบ A",
    unit_price: 490,
    amount: 490,
    shifted_from_date: null,
    shift_source: null,
  },
  {
    entry_id: "00000000-0000-0000-0000-000000000002",
    reservation_id: "10000000-0000-0000-0000-000000000002",
    guest_name: "B",
    checkin_date: "2026-03-01",
    checkout_date: "2026-03-02",
    issue_date: "2026-03-01",
    stay_date: "2026-03-01",
    channel_group: "ota",
    tax_invoice_channel: "ota",
    tax_group: "A",
    label_th: "ห้องพักแบบ A",
    unit_price: 490,
    amount: 490,
    shifted_from_date: null,
    shift_source: null,
  },
]);
assert.equal(groupedLines.length, 1);
assert.equal(groupedLines[0]?.quantity, 2);
assert.equal(groupedLines[0]?.amount, 980);
assert.deepEqual(groupedLines[0]?.source_entry_ids, [
  "00000000-0000-0000-0000-000000000001",
  "00000000-0000-0000-0000-000000000002",
]);

const overflowDraft: AbbreviatedInvoiceDraft = {
  source_type: "room",
  render_mode: "full_a4",
  issue_date: "2026-03-01",
  stay_date_from: "2026-03-01",
  stay_date_to: "2026-03-01",
  channel_group: "ota",
  tax_invoice_channel: "ota",
  predicted_invoice_no: "690301",
  book_no: 8,
  lines: Array.from({ length: 8 }, (_, index) => ({
    tax_group: "A",
    label_th: "ห้องพักแบบ A",
    quantity: 1,
    unit_price: 400 + index,
    amount: 400 + index,
    source_entry_ids: [`00000000-0000-0000-0000-00000000000${index}`],
    source_entries: [{
      entry_id: `00000000-0000-0000-0000-00000000000${index}`,
      guest_name: "Guest",
      checkin_date: "2026-03-01",
      checkout_date: "2026-03-02",
      quantity: 1,
    }],
    shifted_from_date: null,
    shift_source: null,
  })),
  subtotal_inc_vat: 0,
  subtotal_ex_vat: 0,
  vat_rate: 7,
  vat_amount: 0,
};

const shifted = computeAutoShift([overflowDraft]);
assert.equal(shifted.find((draft) => draft.issue_date === "2026-03-01")?.lines.length, 7);
assert.equal(shifted.find((draft) => draft.issue_date === "2026-03-02")?.lines.length, 1);

console.log("Phase70 logic verification passed");
