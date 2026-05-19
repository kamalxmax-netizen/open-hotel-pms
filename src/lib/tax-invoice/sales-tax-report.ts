import * as XLSX from "xlsx";

export type SalesTaxExportCategory =
  | "abbreviated_ota"
  | "abbreviated_walkin_direct"
  | "abbreviated_pos"
  | "full_tax_invoice";

export type SalesTaxSellerInfo = {
  company_name?: string | null;
  company_tax_id?: string | null;
  company_branch?: string | null;
  hotel_name?: string | null;
};

export type SalesTaxAbbreviatedDraftInput = {
  source_type?: string | null;
  issue_date: string;
  channel_group?: "ota" | "walkin_direct" | null;
  predicted_invoice_no: string;
  book_no?: number | string | null;
  subtotal_inc_vat: number;
  subtotal_ex_vat: number;
  vat_amount: number;
};

export type SalesTaxFullInvoiceInput = {
  issue_date: string | null;
  invoice_no: string | null;
  customer_name: string | null;
  customer_tax_id: string | null;
  grand_total: number | string | null;
  subtotal: number | string | null;
  vat_amount: number | string | null;
};

export type SalesTaxReportRow = {
  category: SalesTaxExportCategory;
  issueDate: string;
  invoiceNo: string;
  buyerName: string;
  buyerTaxId: string;
  totalIncVat: number;
  subtotalExVat: number;
  vatAmount: number;
};

const CATEGORY_ORDER: SalesTaxExportCategory[] = [
  "abbreviated_ota",
  "abbreviated_walkin_direct",
  "abbreviated_pos",
  "full_tax_invoice",
];

const THAI_MONTHS = [
  "มกราคม",
  "กุมภาพันธ์",
  "มีนาคม",
  "เมษายน",
  "พฤษภาคม",
  "มิถุนายน",
  "กรกฎาคม",
  "สิงหาคม",
  "กันยายน",
  "ตุลาคม",
  "พฤศจิกายน",
  "ธันวาคม",
];

function num(value: unknown): number {
  const n = Number(value ?? 0);
  return Number.isFinite(n) ? Math.round(n * 100) / 100 : 0;
}

function text(value: unknown): string {
  return String(value ?? "").trim();
}

function formatThaiDate(value: string): string {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return value;
  const year = Number(value.slice(0, 4)) + 543;
  return `${value.slice(8, 10)}/${value.slice(5, 7)}/${year}`;
}

function formatBookInvoiceNo(bookNo: unknown, invoiceNo: unknown): string {
  const normalizedInvoiceNo = text(invoiceNo);
  if (!normalizedInvoiceNo) return "";
  const normalizedBookNo = text(bookNo);
  return normalizedBookNo ? `${normalizedBookNo}/${normalizedInvoiceNo}` : normalizedInvoiceNo;
}

function abbreviatedBuyerName(category: SalesTaxExportCategory): string {
  if (
    category === "abbreviated_ota" ||
    category === "abbreviated_walkin_direct" ||
    category === "abbreviated_pos"
  ) {
    return "เงินสด";
  }
  return "";
}

function fromAbbreviatedDraft(
  draft: SalesTaxAbbreviatedDraftInput,
  category: SalesTaxExportCategory
): SalesTaxReportRow {
  return {
    category,
    issueDate: draft.issue_date,
    invoiceNo: formatBookInvoiceNo(draft.book_no, draft.predicted_invoice_no),
    buyerName: abbreviatedBuyerName(category),
    buyerTaxId: "",
    totalIncVat: num(draft.subtotal_inc_vat),
    subtotalExVat: num(draft.subtotal_ex_vat),
    vatAmount: num(draft.vat_amount),
  };
}

function fromFullTaxInvoice(invoice: SalesTaxFullInvoiceInput): SalesTaxReportRow {
  const totalIncVat = num(invoice.grand_total);
  const vatAmount = num(invoice.vat_amount);
  const subtotalExVat = invoice.subtotal == null ? num(totalIncVat - vatAmount) : num(invoice.subtotal);
  return {
    category: "full_tax_invoice",
    issueDate: text(invoice.issue_date),
    invoiceNo: text(invoice.invoice_no),
    buyerName: text(invoice.customer_name),
    buyerTaxId: text(invoice.customer_tax_id),
    totalIncVat,
    subtotalExVat,
    vatAmount,
  };
}

export function normalizeSalesTaxCategories(values: string[]): SalesTaxExportCategory[] {
  const set = new Set(values.map((value) => value.trim()).filter(Boolean));
  return CATEGORY_ORDER.filter((category) => set.has(category));
}

export function toSalesTaxReportRows(params: {
  selectedCategories: SalesTaxExportCategory[];
  abbreviatedRoomDrafts?: SalesTaxAbbreviatedDraftInput[];
  abbreviatedPosDrafts?: SalesTaxAbbreviatedDraftInput[];
  fullTaxInvoices?: SalesTaxFullInvoiceInput[];
}): SalesTaxReportRow[] {
  const selected = new Set(params.selectedCategories);
  const rows: SalesTaxReportRow[] = [];

  for (const category of CATEGORY_ORDER) {
    if (!selected.has(category)) continue;

    if (category === "abbreviated_ota") {
      rows.push(
        ...(params.abbreviatedRoomDrafts ?? [])
          .filter((draft) => draft.channel_group === "ota")
          .map((draft) => fromAbbreviatedDraft(draft, category))
      );
      continue;
    }

    if (category === "abbreviated_walkin_direct") {
      rows.push(
        ...(params.abbreviatedRoomDrafts ?? [])
          .filter((draft) => draft.channel_group === "walkin_direct")
          .map((draft) => fromAbbreviatedDraft(draft, category))
      );
      continue;
    }

    if (category === "abbreviated_pos") {
      rows.push(
        ...(params.abbreviatedPosDrafts ?? [])
          .map((draft) => fromAbbreviatedDraft(draft, category))
      );
      continue;
    }

    rows.push(...(params.fullTaxInvoices ?? []).map(fromFullTaxInvoice));
  }

  return rows;
}

function emptyRow(): unknown[] {
  return Array.from({ length: 16 }, () => "");
}

export function buildSalesTaxReportSheetRows(params: {
  year: number;
  month: number;
  seller: SalesTaxSellerInfo;
  rows: SalesTaxReportRow[];
}): unknown[][] {
  const beYear = params.year + 543;
  const sellerName = text(params.seller.company_name || params.seller.hotel_name);
  const placeName = text(params.seller.hotel_name || params.seller.company_name);
  const branch = text(params.seller.company_branch) || "สำนักงานใหญ่";
  const taxId = text(params.seller.company_tax_id);

  const sheetRows: unknown[][] = [
    emptyRow(),
    ["", "รายงานภาษีขาย", "", "", "", "", "", "", "", "", "", "", "", "", "", ""],
    emptyRow(),
    emptyRow(),
    ["", `เดือนภาษี :  ${THAI_MONTHS[params.month - 1] ?? ""} ปี  ${beYear}`, "", "", "", "", "", "", "", "", "", "", "", "", "", ""],
    emptyRow(),
    ["", `ชื่อผู้ประกอบการ : ${sellerName}`, "", "", "", `เลขประจำตัวผู้เสียภาษีอากร : ${taxId}`, "", "", "", "", "", "", "", "", "", ""],
    emptyRow(),
    ["", `ชื่อสถานประกอบการ : ${placeName}`, "", "", "", branch, "", "", "", "", "", "", "", "", "", ""],
    emptyRow(),
    [
      "",
      "ลำดับที่",
      "ใบกำกับภาษี",
      "",
      "ชื่อผู้ซื้อสินค้า/ผู้รับบริการ ",
      "",
      "เลขประจำตัวผู้เสียภาษีอากร\nของผู้ซื้อสินค้า/\nผู้รับบริการ",
      "รวมมูลค่า",
      "",
      "มูลค่าสินค้า            หรือ บริการ",
      "จำนวนเงิน ภาษีมูลค่า  เพิ่ม",
      "",
      "",
      "",
      "",
      "",
    ],
    ["", "", "วัน เดือน ปี", "เล่มที่/เลขที่", "", "", "", "", "", "", "", "", "", "", "", ""],
  ];

  params.rows.forEach((row, index) => {
    sheetRows.push([
      "",
      index + 1,
      formatThaiDate(row.issueDate),
      row.invoiceNo,
      row.buyerName,
      "",
      row.buyerTaxId,
      row.totalIncVat,
      "",
      row.subtotalExVat,
      row.vatAmount,
      "",
      "",
      "",
      "",
      "",
    ]);
  });

  sheetRows.push(emptyRow());
  sheetRows.push(["", "หมายเหตุ", "", "", "", "", "", "", "", "", "", "", "", "", "", ""]);
  sheetRows.push(emptyRow());
  sheetRows.push(["", "1. ช่อง “ลำดับ” ให้กรอกลำดับที่ของใบกำกับภาษีที่ผู้ประกอบการได้จัดเรียงลำดับขึ้นใหม่", "", "", "", "", "", "", "", "", "", "", "", "", "", ""]);
  sheetRows.push(["", "2. ช่อง “วัน เดือน ปี” ให้กรอกวัน เดือน ปี ของใบกำกับภาษี", "", "", "", "", "", "", "", "", "", "", "", "", "", ""]);
  sheetRows.push(["", "3. ช่อง “เลขที่” ให้กรอกเลขที่ของใบกำกับภาษี และเล่มที่ (ถ้ามี)", "", "", "", "", "", "", "", "", "", "", "", "", "", ""]);
  sheetRows.push(["", "4. ใบกำกับภาษี หมายความรวมถึง ใบเพิ่มหนี้ ใบลดหนี้ ใบเสร็จรับเงินที่ส่วนราชการออกให้ในการขายทอดตลาดหรือขายโดยวิธีอื่นตามมาตรา 83/5 และใบเสร็จรับเงินของกรมสรรพากร ของกรมศุลกากรหรือของกรมสรรพสามิตเฉพาะส่วนที่เป็นภาษีมูลค่าเพิ่ม", "", "", "", "", "", "", "", "", "", "", "", "", "", ""]);

  return sheetRows;
}

export function buildSalesTaxReportWorkbookBuffer(params: {
  year: number;
  month: number;
  seller: SalesTaxSellerInfo;
  rows: SalesTaxReportRow[];
}): Buffer {
  const workbook = XLSX.utils.book_new();
  const sheetRows = buildSalesTaxReportSheetRows(params);
  const worksheet = XLSX.utils.aoa_to_sheet(sheetRows);
  const dataStartRow = 13;
  const dataEndRow = dataStartRow + params.rows.length - 1;

  worksheet["!cols"] = [
    { wch: 13 },
    { wch: 4.5 },
    { wch: 14.2 },
    { wch: 13 },
    { wch: 29.2 },
    { wch: 16.5 },
    { wch: 20.7 },
    { wch: 7 },
    { wch: 6.3 },
    { wch: 13.8 },
    { wch: 12.3 },
    { wch: 13 },
    { wch: 13 },
    { wch: 13 },
    { wch: 13 },
    { wch: 13 },
  ];
  worksheet["!rows"] = sheetRows.map((_, index) => ({
    hpt: index === 10 ? 27.75 : index === 11 ? 41.25 : index >= 12 && index <= dataEndRow - 1 ? 32.25 : undefined,
  }));

  worksheet["!merges"] = [
    XLSX.utils.decode_range("B11:B12"),
    XLSX.utils.decode_range("C11:D11"),
    XLSX.utils.decode_range("E11:F12"),
    XLSX.utils.decode_range("G11:G12"),
    XLSX.utils.decode_range("H11:I12"),
    XLSX.utils.decode_range("J11:J12"),
    XLSX.utils.decode_range("K11:K12"),
  ];

  for (let row = dataStartRow; row <= dataEndRow; row += 1) {
    worksheet["!merges"].push(XLSX.utils.decode_range(`E${row}:F${row}`));
    worksheet["!merges"].push(XLSX.utils.decode_range(`H${row}:I${row}`));
    for (const col of ["H", "J", "K"]) {
      const cell = worksheet[`${col}${row}`];
      if (cell) cell.z = "#,##0.00";
    }
  }

  XLSX.utils.book_append_sheet(workbook, worksheet, "Sale Bill with tax Print");
  return XLSX.write(workbook, { type: "buffer", bookType: "xlsx" }) as Buffer;
}
