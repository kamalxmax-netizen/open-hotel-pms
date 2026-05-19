import assert from "node:assert/strict";
import {
  buildSalesTaxReportSheetRows,
  toSalesTaxReportRows,
  type SalesTaxExportCategory,
} from "./sales-tax-report.ts";

const selected: SalesTaxExportCategory[] = [
  "abbreviated_ota",
  "abbreviated_walkin_direct",
  "abbreviated_pos",
  "full_tax_invoice",
];

const rows = toSalesTaxReportRows({
  selectedCategories: selected,
  abbreviatedRoomDrafts: [
    {
      source_type: "room",
      issue_date: "2026-03-01",
      channel_group: "ota",
      predicted_invoice_no: "690301",
      book_no: 8,
      subtotal_inc_vat: 1070,
      subtotal_ex_vat: 1000,
      vat_amount: 70,
    },
    {
      source_type: "room",
      issue_date: "2026-03-01",
      channel_group: "walkin_direct",
      predicted_invoice_no: "W690301",
      book_no: 8,
      subtotal_inc_vat: 2140,
      subtotal_ex_vat: 2000,
      vat_amount: 140,
    },
  ],
  abbreviatedPosDrafts: [
    {
      source_type: "pos",
      issue_date: "2026-03-02",
      channel_group: null,
      predicted_invoice_no: "D690302",
      book_no: 8,
      subtotal_inc_vat: 321,
      subtotal_ex_vat: 300,
      vat_amount: 21,
    },
  ],
  fullTaxInvoices: [
    {
      issue_date: "2026-03-03",
      invoice_no: "T6903001",
      customer_name: "ACME Co., Ltd.",
      customer_tax_id: "0123456789012",
      grand_total: 5350,
      subtotal: 5000,
      vat_amount: 350,
    },
  ],
});

assert.deepEqual(
  rows.map((row) => row.category),
  ["abbreviated_ota", "abbreviated_walkin_direct", "abbreviated_pos", "full_tax_invoice"]
);

assert.equal(rows[0].buyerTaxId, "");
assert.equal(rows[1].buyerTaxId, "");
assert.equal(rows[2].buyerTaxId, "");
assert.equal(rows[3].buyerTaxId, "0123456789012");
assert.equal(rows[0].invoiceNo, "8/690301");
assert.equal(rows[0].buyerName, "เงินสด");
assert.equal(rows[1].buyerName, "เงินสด");
assert.equal(rows[2].buyerName, "เงินสด");
assert.equal(rows[3].buyerName, "ACME Co., Ltd.");

const sheetRows = buildSalesTaxReportSheetRows({
  year: 2026,
  month: 3,
  seller: {
    company_name: "บริษัท ตัวอย่าง จำกัด",
    company_tax_id: "0000000000000",
    company_branch: "สำนักงานใหญ่",
    hotel_name: "OpenHotel",
  },
  rows,
});

assert.equal(sheetRows[1][1], "รายงานภาษีขาย");
assert.equal(sheetRows[4][1], "เดือนภาษี :  มีนาคม ปี  2569");
assert.equal(sheetRows[6][1], "ชื่อผู้ประกอบการ : บริษัท ตัวอย่าง จำกัด");
assert.equal(sheetRows[10][1], "ลำดับที่");
assert.equal(sheetRows[12][1], 1);
assert.equal(sheetRows[12][2], "01/03/2569");
assert.equal(sheetRows[12][3], "8/690301");
assert.equal(sheetRows[12][4], "เงินสด");
assert.equal(sheetRows[12][6], "");
assert.equal(sheetRows[12][7], 1070);
assert.equal(sheetRows[12][9], 1000);
assert.equal(sheetRows[12][10], 70);
assert.equal(sheetRows[15][6], "0123456789012");
