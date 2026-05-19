import assert from "node:assert/strict";
import {
  assignSequentialInvoiceNumbers,
  computeAbbreviatedInvoiceNo,
} from "./numbering.ts";

assert.equal(computeAbbreviatedInvoiceNo("2026-04-19", "ota", "room", 18), "690418");
assert.equal(computeAbbreviatedInvoiceNo("2026-04-19", "walkin_direct", "room", 18), "W690418");
assert.equal(computeAbbreviatedInvoiceNo("2026-04-28", null, "pos", 26), "D690426");
assert.equal(computeAbbreviatedInvoiceNo("2026-04-30", null, "dayuse"), "DY6904");

const drafts = assignSequentialInvoiceNumbers([
  {
    source_type: "room",
    issue_date: "2026-04-01",
    channel_group: "ota",
    predicted_invoice_no: "690401",
  },
  {
    source_type: "room",
    issue_date: "2026-04-03",
    channel_group: "ota",
    predicted_invoice_no: "690403",
  },
  {
    source_type: "room",
    issue_date: "2026-04-01",
    channel_group: "walkin_direct",
    predicted_invoice_no: "W690401",
  },
  {
    source_type: "pos",
    issue_date: "2026-04-28",
    channel_group: null,
    predicted_invoice_no: "D690428",
  },
  {
    source_type: "pos",
    issue_date: "2026-04-30",
    channel_group: null,
    predicted_invoice_no: "D690430",
  },
]);

assert.deepEqual(
  drafts.map((draft) => draft.predicted_invoice_no),
  ["690401", "690402", "W690401", "D690401", "D690402"]
);
