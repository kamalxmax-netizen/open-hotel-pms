import { esc, fmtDate, fmtMoney } from "@/lib/tax-invoice/utils";
import type { AbbreviatedRenderData } from "./types";

export function renderAbbreviatedA4Html(data: AbbreviatedRenderData): string {
  const css = `
  @font-face {
    font-family: "TH Sarabun New";
    src: url("/fonts/THSarabunNew.ttf") format("truetype");
    font-weight: normal;
    font-style: normal;
    font-display: swap;
  }
  @font-face {
    font-family: "TH Sarabun New";
    src: url("/fonts/THSarabunNew Bold.ttf") format("truetype");
    font-weight: bold;
    font-style: normal;
    font-display: swap;
  }

  @page { size: A4 portrait; margin: 0mm; }

  html, body {
    margin: 0;
    padding: 0;
    width: 210mm;
    min-height: 297mm;
    background: #fff;
    color: #111827;
  }

  * { box-sizing: border-box; -webkit-print-color-adjust: exact; print-color-adjust: exact; }

  body {
    --font-scale: 1.45;
    font-family: "TH Sarabun New", "Sarabun", "Noto Sans Thai", Tahoma, Arial, sans-serif;
  }

  .paper {
    width: 210mm;
    min-height: 297mm;
    display: flex;
    flex-direction: column;
    page-break-after: always;
    break-after: page;
  }

  .paper.print-a4-full {
    min-height: 297mm;
  }

  .paper.print-a4-half {
    min-height: 148.5mm;
  }

  .paper:last-child {
    page-break-after: auto;
    break-after: auto;
  }

  .sheet {
    width: 100%;
    height: 148.5mm; /* Exact half A4 */
    padding: 7mm;
    box-sizing: border-box;
  }

  .sheet + .sheet {
    position: relative;
    border-top: none;
    margin-top: -0.05mm;
  }

  /* Use a more print-stable method for the cut guides */
  .sheet + .sheet::before {
    content: "";
    position: absolute;
    top: 0;
    left: 0;
    width: 10mm;
    height: 0;
    border-top: 0.15mm dashed rgba(20, 83, 45, 0.6);
  }

  .sheet + .sheet::after {
    content: "";
    position: absolute;
    top: 0;
    right: 0;
    width: 10mm;
    height: 0;
    border-top: 0.15mm dashed rgba(20, 83, 45, 0.6);
  }

  .sheet.empty { opacity: 0; }

  .invoice-copy {
    width: 100%; height: 100%;
    border: 0.25mm solid rgba(20, 83, 45, 0.6);
    padding: 6mm 7mm;
    display: flex; flex-direction: column; gap: 1.5mm;
  }

  .doc-head { display: flex; justify-content: space-between; gap: 4mm; }
  .seller { flex: 1; min-width: 0; }
  .seller-main { font-size: calc(10pt * var(--font-scale)); font-weight: bold; line-height: 1.1; margin-bottom: 0.8mm; }
  .seller-line { font-size: calc(8pt * var(--font-scale)); line-height: 1.15; text-wrap: pretty; }

  .doc-title { width: 62mm; text-align: right; position: relative; }
  .doc-title .th { 
    font-size: calc(13pt * var(--font-scale)); 
    font-weight: 800; 
    color: #14532d; 
    line-height: 1.05; 
    border: 0.25mm solid rgba(20, 83, 45, 0.5);
    padding: 1.5mm 4mm;
    display: inline-block;
    width: 48mm;
    text-align: center;
  }
  .doc-title .en { font-size: calc(8pt * var(--font-scale)); font-weight: 600; color: #4b5563; margin-top: 0.1mm; line-height: 1.0; display: none; }
  .doc-title .label { font-size: calc(9pt * var(--font-scale)); font-weight: bold; margin-top: 1mm; padding: 0.5mm 0; display: none; }

  .party-row { display: flex; justify-content: space-between; gap: 4mm; margin-top: 2mm; align-items: flex-start; }
  .party { flex: 1; min-width: 0; font-size: calc(9pt * var(--font-scale)); line-height: 1.2; padding-top: 1mm; }
  .party-name { font-size: calc(9.5pt * var(--font-scale)); font-weight: bold; line-height: 1.1; margin-bottom: 0.6mm; display: none; }
  
  .meta { width: 48mm; border: 0.25mm solid rgba(20, 83, 45, 0.5); padding: 3mm 3.5mm 1mm; }
  .meta div { display: flex; justify-content: space-between; gap: 2mm; font-size: calc(8.5pt * var(--font-scale)); line-height: 1.25; }
  .meta span { font-weight: 600; }

  .items {
    width: 100%; border-collapse: collapse; table-layout: fixed;
    margin-top: 1.5mm; border-top: 0.4mm solid #14532d;
    height: 48mm;
  }
  .items th { padding: 1.5mm 0.8mm; font-size: calc(8.5pt * var(--font-scale)); font-weight: bold; border-bottom: 0.2mm solid rgba(20, 83, 45, 0.5); border-left: 0.2mm solid rgba(20, 83, 45, 0.5); text-align: center; line-height: 1.1; }
  .items th:last-child { border-right: 0.2mm solid rgba(20, 83, 45, 0.5); }
  .items td { padding: 1mm 1.2mm; font-size: calc(8.6pt * var(--font-scale)); line-height: 1.2; vertical-align: top; border-bottom: 0.1mm solid rgba(20, 83, 45, 0.3); border-left: 0.2mm solid rgba(20, 83, 45, 0.5); }
  .items td:last-child { border-right: 0.2mm solid rgba(20, 83, 45, 0.5); }
  .items tr:last-child td { border-bottom: 0.4mm solid #14532d; }
  .item-row { height: 6mm; }
  .w-no { width: 10mm; } .w-qty { width: 15mm; } .w-price { width: 25mm; } .w-amt { width: 30mm; }
  .center { text-align: center; } .num { text-align: right; }

  .bottom-section { display: flex; gap: 10mm; margin-top: auto; }
  .bottom-left { flex: 1; }
  .bottom-right { width: 72mm; display: flex; flex-direction: column; justify-content: space-between; }
  .summary { width: 100%; border-collapse: collapse; border: 0.25mm solid rgba(20, 83, 45, 0.5); }
  .summary td { font-size: calc(9pt * var(--font-scale) * 1.2); font-weight: bold; line-height: 1.2; padding: 1mm 1.5mm; }
  .summary td:first-child { text-align: center; width: 40%; }
  .summary .baht { width: 12mm; text-align: right; }
  .summary .total td { font-weight: bold; padding-top: 1mm; }

  @media print { body { background: #fff; } }
  `;

  const sellerName = esc(data.seller.company_name || "");
  const isHQ = data.seller.company_branch === "00000" || data.seller.company_branch?.includes("สำนักงานใหญ่");
  const branchText = esc(isHQ ? " (สำนักงานใหญ่)" : (data.seller.company_branch ? ` (สาขา: ${data.seller.company_branch})` : ""));
  const address = esc(data.seller.company_address || "");
  const branchAfterTax = esc(isHQ ? ` | สาขา สำนักงานใหญ่` : (data.seller.company_branch ? ` | สาขา ${data.seller.company_branch}` : ""));
  const taxId = esc(data.seller.company_tax_id || "");
  const phoneBlock = data.seller.company_phone ? `<div class="seller-line">โทร ${esc(data.seller.company_phone)}</div>` : "";

  function renderHalfPage(sheet: typeof data.pages[0]["top"]) {
    const rowsHtml = sheet.rows.map((row, idx) => {
      const isEmpty = !row.label_th;
      return `
        <tr class="item-row">
          <td class="center">${isEmpty ? "&nbsp;" : String(idx + 1)}</td>
          <td><b>${isEmpty ? "&nbsp;" : esc(row.label_th)}</b></td>
          <td class="center">${isEmpty ? "&nbsp;" : esc(String(row.quantity))}</td>
          <td class="num">${isEmpty ? "&nbsp;" : fmtMoney(row.unit_price)}</td>
          <td class="num">${isEmpty ? "&nbsp;" : fmtMoney(row.amount)}</td>
        </tr>
      `;
    }).join("");

    return `
    <section class="invoice-copy">
      <div class="doc-head">
        <div class="seller">
          <div class="seller-main">${sellerName}${branchText}</div>
          <div class="seller-line">${address}</div>
          <div class="seller-line">เลขประจำตัวผู้เสียภาษี ${taxId}${branchAfterTax}</div>
          ${phoneBlock}
        </div>
        <div class="doc-title">
          <div class="th">ใบกำกับภาษีอย่างย่อ<br/>ใบเสร็จรับเงิน</div>
        </div>
      </div>

      <div class="party-row">
        <div class="party">
          <div style="margin-bottom: 0.8mm;"><b>ชื่อลูกค้า</b> &nbsp;&nbsp;&nbsp;เงินสด</div>
          <div style="margin-bottom: 0.8mm;"><b>ที่อยู่</b> &nbsp;&nbsp;&nbsp;- &nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp; <b>เลขประจำตัวผู้เสียภาษี</b> &nbsp;&nbsp;&nbsp;- &nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp; <b>โทร</b> &nbsp;&nbsp;&nbsp;-</div>
          <div><b>เข้าพักวันที่</b> ${esc(fmtDate(sheet.stay_date_from, "th"))} <b>ถึงวันที่</b> ${esc(fmtDate(sheet.stay_date_to, "th"))}</div>
        </div>
        <div class="meta">
          <div><span>เล่มที่</span><b>${esc(String(sheet.book_no))}</b></div>
          <div><span>เลขที่</span><b>${esc(sheet.invoice_no)}</b></div>
          <div><span>วันที่</span><b>${esc(fmtDate(sheet.issue_date, "th"))}</b></div>
        </div>
      </div>

      <table class="items" cellspacing="0" cellpadding="0">
        <thead>
          <tr>
            <th class="w-no">ลำดับ</th>
            <th>รายการ</th>
            <th class="w-qty">จำนวน</th>
            <th class="w-price">หน่วยละ</th>
            <th class="w-amt">รวมเงิน</th>
          </tr>
        </thead>
        <tbody>
          ${rowsHtml}
        </tbody>
      </table>

      <div class="bottom-section" style="margin-top: 3mm;">
        <div class="bottom-left"></div>
        <div class="bottom-right">
          <table class="summary" cellspacing="0" cellpadding="0">
            <tbody>
              <tr class="total"><td>รวมเป็นเงิน</td><td class="num">${fmtMoney(sheet.subtotal_inc_vat)}</td><td class="baht">บาท</td></tr>
            </tbody>
          </table>
        </div>
      </div>
    </section>`;
  }

  const papersHtml = data.pages.map((p) => {
    if (data.render_mode === "half_a4") {
      return `<main class="paper print-a4-half">
        <div class="sheet">${renderHalfPage(p.top)}</div>
      </main>`;
    }
    
    return `<main class="paper print-a4-full">
      <div class="sheet">${renderHalfPage(p.top)}</div>
      <div class="sheet ${p.bottom ? "" : "empty"}">${p.bottom ? renderHalfPage(p.bottom) : ""}</div>
    </main>`;
  }).join("");

  return `<!doctype html>
<html>
<head>
  <meta charset="utf-8" />
  <title>Abbreviated Invoice Print</title>
  <style>${css}</style>
</head>
<body onload="window.focus();">
  ${papersHtml}
</body>
</html>`;
}
