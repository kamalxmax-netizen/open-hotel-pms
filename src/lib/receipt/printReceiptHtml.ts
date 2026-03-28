import { esc, fmtMoney, fmtDate } from "@/lib/tax-invoice/utils";

export interface ReceiptRenderData {
  receiptNo: string;
  printedAt: string;
  language: "th" | "en";
  guestName: string;
  roomNumbers: string[];
  checkinDate: string | null;
  checkoutDate: string | null;
  grandTotal: number;
  note: string | null;
  seller: {
    hotel_name: string | null;
    company_name: string | null;
    company_name_en: string | null;
    company_address: string | null;
    company_address_en: string | null;
    company_tax_id: string | null;
    company_phone: string | null;
  };
}

function receiptCopy(data: ReceiptRenderData, labelType: "original" | "copy") {
  const { language: lang } = data;
  const isTh = lang === "th";
  const title = isTh ? "ใบเสร็จรับเงิน" : "Receipt";
  const copyLabel = isTh
    ? (labelType === "original" ? "ต้นฉบับ / Original" : "สำเนา / Copy")
    : (labelType === "original" ? "Original" : "Copy");
  const sellerName = lang === "en" && data.seller.company_name_en
    ? data.seller.company_name_en
    : data.seller.company_name || "";
  const sellerAddress = lang === "en" && data.seller.company_address_en
    ? data.seller.company_address_en
    : data.seller.company_address || "";
  const hotelName = data.seller.hotel_name || "";
  const hotelSuffix = hotelName
    ? ` <span class="seller-hotel">/ ${esc(hotelName)}</span>`
    : "";

  const roomText = data.roomNumbers.join(", ") || "-";
  const stayLine = data.checkinDate && data.checkoutDate
    ? `${isTh ? "เช็คอิน" : "Check-in"} ${fmtDate(data.checkinDate, lang)} — ${isTh ? "เช็คเอาท์" : "Check-out"} ${fmtDate(data.checkoutDate, lang)}`
    : "";

  return `
    <section class="receipt-copy">
      <div class="doc-head">
        <div class="seller">
          <div class="seller-main">${esc(sellerName)}${hotelSuffix}</div>
          <div class="seller-line">${esc(sellerAddress)}</div>
          ${data.seller.company_tax_id ? `<div class="seller-line">${isTh ? "เลขประจำตัวผู้เสียภาษี" : "Tax ID"} ${esc(data.seller.company_tax_id)}</div>` : ""}
          ${data.seller.company_phone ? `<div class="seller-line">${isTh ? "โทร" : "Tel"} ${esc(data.seller.company_phone)}</div>` : ""}
        </div>
        <div class="doc-title">
          <div class="title-th">ใบเสร็จรับเงิน</div>
          <div class="title-en">Receipt</div>
          <div class="copy-label">${esc(copyLabel)}</div>
        </div>
      </div>

      <div class="meta-row">
        <div class="guest-block">
          <div class="guest-name">${isTh ? "ลูกค้า" : "Guest"} ${esc(data.guestName)}</div>
          <div class="guest-line">${isTh ? "ห้อง" : "Room"} ${esc(roomText)}</div>
          ${stayLine ? `<div class="guest-line">${esc(stayLine)}</div>` : ""}
        </div>
        <div class="meta-box">
          <div><span>${isTh ? "เลขที่" : "No."}</span><b>${esc(data.receiptNo)}</b></div>
          <div><span>${isTh ? "วันที่" : "Date"}</span><b>${esc(fmtDate(data.printedAt, lang))}</b></div>
        </div>
      </div>

      <div class="divider"></div>

      <div class="total-section">
        <div class="total-label">${isTh ? "จำนวนเงินทั้งสิ้น" : "Grand Total"}</div>
        <div class="total-amount">${fmtMoney(data.grandTotal)} <span class="total-currency">${isTh ? "บาท" : "THB"}</span></div>
        ${data.note ? `<div class="note-text">${esc(data.note)}</div>` : ""}
      </div>

      <div class="divider"></div>

      <div class="sig-row">
        <div class="sig-col">
          <div class="sig-line"></div>
          <div class="sig-label">${isTh ? "พนักงานเก็บเงิน" : "Collection Staff"}</div>
        </div>
        <div class="sig-col">
          <div class="sig-name">นาย ตัวอย่าง สมมุติ</div>
          <div class="sig-label">${isTh ? "ผู้จัดการโรงแรม" : "Hotel Manager"}</div>
        </div>
      </div>
    </section>
  `;
}

export function renderReceiptA4Html(data: ReceiptRenderData): string {
  const css = `
  @font-face {
    font-family: "TH Sarabun New";
    src: url("/fonts/THSarabunNew.ttf") format("truetype");
    font-weight: normal; font-style: normal; font-display: swap;
  }
  @font-face {
    font-family: "TH Sarabun New";
    src: url("/fonts/THSarabunNew Bold.ttf") format("truetype");
    font-weight: bold; font-style: normal; font-display: swap;
  }
  @page { size: A4 portrait; margin: 0mm; }
  html, body { margin: 0; padding: 0; width: 210mm; height: 297mm; background: #fff; }
  * { box-sizing: border-box; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
  body {
    --font-scale: 1.45;
    font-family: "TH Sarabun New", "Sarabun", Tahoma, Arial, sans-serif;
  }
  .paper { width: 210mm; height: 297mm; display: flex; flex-direction: column; }
  .sheet { width: 100%; height: 148.5mm; padding: 7mm; }
  .sheet + .sheet { border-top: 0.15mm dashed rgba(20,83,45,0.3); }
  .receipt-copy {
    width: 100%; height: 100%;
    border: 0.25mm solid rgba(20,83,45,0.6);
    padding: 6mm 7mm;
    display: flex; flex-direction: column; gap: 2mm;
  }
  .doc-head { display: flex; justify-content: space-between; gap: 4mm; }
  .seller { flex: 1; min-width: 0; }
  .seller-main { font-size: calc(10pt * var(--font-scale)); font-weight: bold; line-height: 1.1; margin-bottom: 0.8mm; }
  .seller-hotel { font-size: calc(8pt * var(--font-scale)); font-weight: normal; color: #4b5563; }
  .seller-line { font-size: calc(8pt * var(--font-scale)); line-height: 1.15; }
  .doc-title { width: 56mm; text-align: center; }
  .title-th { font-size: calc(16pt * var(--font-scale)); font-weight: 800; color: #14532d; line-height: 1.0; }
  .title-en { font-size: calc(8pt * var(--font-scale)); font-weight: 600; color: #4b5563; line-height: 1.0; }
  .copy-label { font-size: calc(10.5pt * var(--font-scale)); font-weight: bold; margin-top: 1mm; }
  .meta-row { display: flex; justify-content: space-between; gap: 4mm; }
  .guest-block { flex: 1; min-width: 0; }
  .guest-name { font-size: calc(9.5pt * var(--font-scale)); font-weight: bold; line-height: 1.2; }
  .guest-line { font-size: calc(8.4pt * var(--font-scale)); line-height: 1.2; }
  .meta-box {
    width: 54mm; border: 0.25mm solid rgba(20,83,45,0.5); padding: 1mm 1.5mm;
  }
  .meta-box div { display: flex; justify-content: space-between; gap: 2mm; font-size: calc(8.5pt * var(--font-scale)); line-height: 1.3; }
  .meta-box span { font-weight: 600; }
  .divider { border-top: 0.4mm solid #14532d; margin: 1mm 0; }
  .total-section { padding: 3mm 0; text-align: center; }
  .total-label { font-size: calc(11pt * var(--font-scale)); font-weight: 600; color: #374151; }
  .total-amount { font-size: calc(20pt * var(--font-scale)); font-weight: 800; color: #14532d; margin-top: 1mm; }
  .total-currency { font-size: calc(12pt * var(--font-scale)); font-weight: 600; color: #4b5563; }
  .note-text { font-size: calc(8pt * var(--font-scale)); color: #6b7280; margin-top: 1.5mm; }
  .sig-row { display: flex; gap: 12mm; margin-top: auto; }
  .sig-col { flex: 1; text-align: center; }
  .sig-line { height: 8mm; border-bottom: 0.3mm solid #374151; }
  .sig-name { height: 8mm; display: flex; align-items: flex-end; justify-content: center; font-size: calc(9pt * var(--font-scale)); font-weight: bold; padding-bottom: 0.5mm; }
  .sig-label { margin-top: 1mm; font-size: calc(8.4pt * var(--font-scale)); font-weight: 600; }
  @media print { body { background: #fff; } }
  `;

  return `<!doctype html>
<html>
  <head>
    <meta charset="utf-8" />
    <title>Receipt - ${esc(data.receiptNo)}</title>
    <style>${css}</style>
  </head>
  <body onload="window.focus();">
    <main class="paper">
      <div class="sheet">${receiptCopy(data, "original")}</div>
      <div class="sheet">${receiptCopy(data, "copy")}</div>
    </main>
  </body>
</html>`;
}
