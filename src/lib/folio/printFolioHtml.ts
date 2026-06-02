import { esc, fmtMoney } from "@/lib/tax-invoice/utils";

export interface FolioPrintLedgerRow {
  date: string | null;
  description: string | null;
  amount: number | null;
  kind: "charge" | "discount" | "payment" | "refund";
}

export interface FolioPrintData {
  reservation: {
    booking_code: string | null;
    status: string | null;
    checkin_date: string | null;
    checkout_date: string | null;
    nights: number | null;
    room_number: string | null;
    guest_name: string | null;
    guest_phone: string | null;
    guest_email: string | null;
    guest_address: string | null;
  };
  ledger_rows: FolioPrintLedgerRow[];
  total_charges: number;
  total_payments: number;
  balance_due: number;
  total_amount?: number;
}

const MAX_VISIBLE_ROWS = 16;
const MIN_TABLE_ROWS = 16;

function valueOrDash(value: unknown): string {
  const text = String(value ?? "").trim();
  return text || "-";
}

function fmtThaiDate(value: string | null): string {
  if (!value) return "-";
  const match = String(value).match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (match) {
    const year = Number(match[1]) + 543;
    return `${Number(match[3])}/${Number(match[2])}/${year}`;
  }
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return valueOrDash(value);
  return `${date.getDate()}/${date.getMonth() + 1}/${date.getFullYear() + 543}`;
}

function statusLabel(value: string | null): string {
  const normalized = String(value ?? "").trim().toLowerCase();
  if (!normalized) return "-";
  if (normalized === "active") return "ยืนยันแล้ว";
  if (normalized === "draft_checkin") return "รอเช็คอิน";
  if (normalized === "checked_out") return "เช็คเอาท์แล้ว";
  if (normalized === "cancelled") return "ยกเลิก";
  if (normalized === "no_show") return "ไม่เข้าพัก";
  return valueOrDash(value);
}

function fmtLedgerAmount(row: FolioPrintLedgerRow): string {
  if (row.amount === null) return "-";
  const amount = Math.abs(row.amount);
  if (row.kind === "payment" || row.kind === "discount") return `(${fmtMoney(amount)})`;
  if (row.amount < 0) return `(${fmtMoney(amount)})`;
  return fmtMoney(amount);
}

function renderRows(rows: FolioPrintLedgerRow[]): string {
  const visibleRows = rows.slice(0, MAX_VISIBLE_ROWS);
  const fillerCount = Math.max(0, MIN_TABLE_ROWS - visibleRows.length);
  const bodyRows = visibleRows.map((row, index) => `
    <tr class="${esc(row.kind)}-row">
      <td class="col-no">${index + 1}</td>
      <td class="col-date">${esc(fmtThaiDate(row.date))}</td>
      <td class="col-desc" colspan="2">${esc(valueOrDash(row.description))}</td>
      <td class="col-amount">${esc(fmtLedgerAmount(row))}</td>
    </tr>
  `).join("");
  const fillerRows = Array.from({ length: fillerCount }, () => `
    <tr class="empty-row">
      <td class="col-no">&nbsp;</td>
      <td class="col-date">&nbsp;</td>
      <td class="col-desc" colspan="2">&nbsp;</td>
      <td class="col-amount">&nbsp;</td>
    </tr>
  `).join("");
  return bodyRows + fillerRows;
}

export function renderFolioA4Html(data: FolioPrintData): string {
  const reservation = data.reservation;
  const checkin = fmtThaiDate(reservation.checkin_date);
  const checkout = fmtThaiDate(reservation.checkout_date);
  const nights = reservation.nights && reservation.nights > 0 ? String(reservation.nights) : "-";

  const css = `
  @font-face {
    font-family: "Sarabun";
    src: url("/fonts/THSarabunNew.ttf") format("truetype");
    font-weight: 400; font-style: normal; font-display: swap;
  }
  @font-face {
    font-family: "Sarabun";
    src: url("/fonts/THSarabunNew Bold.ttf") format("truetype");
    font-weight: 700; font-style: normal; font-display: swap;
  }
  @page { size: A4 portrait; margin: 0mm; }
  html, body { width: 210mm; height: 297mm; margin: 0; padding: 0; background: #fff; }
  * { box-sizing: border-box; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
  body {
    font-family: "Sarabun", Tahoma, Arial, sans-serif;
    color: #242124;
    font-size: 10.8pt;
    line-height: 1.24;
  }
  .paper {
    width: 210mm;
    height: 297mm;
    padding: 14.5mm 15mm 12mm;
    display: flex;
    flex-direction: column;
  }
  .header {
    display: grid;
    grid-template-columns: 1fr 54mm;
    gap: 12mm;
    min-height: 82mm;
  }
  .title-en {
    font-size: 19.8pt;
    line-height: 1;
    font-weight: 800;
    letter-spacing: 0;
  }
  .title-th {
    margin-top: 0.7mm;
    font-size: 17.6pt;
    line-height: 1.1;
    font-weight: 800;
  }
  .booking-meta {
    margin-top: 3.4mm;
    font-size: 14.5pt;
    line-height: 1.2;
  }
  .booking-meta b { font-weight: 700; }
  .stay-meta {
    margin-top: 4mm;
    font-size: 15.4pt;
    line-height: 1.18;
  }
  .guest-block {
    margin-top: 4mm;
    font-size: 14.8pt;
    line-height: 1.12;
    max-width: 116mm;
  }
  .guest-block b { font-weight: 700; }
  .brand {
    display: flex;
    flex-direction: column;
    align-items: flex-end;
  }
  .logo-image {
    display: block;
    width: 31mm;
    height: auto;
    margin: -3mm -2mm 4mm 0;
  }
  .brand-name {
    color: #e89062;
    font-size: 12.8pt;
    line-height: 1;
    font-weight: 700;
    letter-spacing: 0;
  }
  .brand-hotel {
    color: #e89062;
    font-size: 5.6pt;
    line-height: 1;
    margin-top: 0.8mm;
    font-weight: 700;
  }
  .hotel-info {
    margin-top: 4mm;
    font-size: 11pt;
    line-height: 1.25;
    text-align: right;
  }
  .hotel-info b { font-size: 12.6pt; font-weight: 800; }
  .ledger {
    width: 100%;
    border-collapse: collapse;
    table-layout: fixed;
    margin-top: 0;
    font-size: 11.2pt;
  }
  .ledger th,
  .ledger td {
    border: 0.25mm solid #aaa;
    height: 7.05mm;
    padding: 0.8mm 1.5mm;
    vertical-align: middle;
  }
  .ledger th {
    font-size: 12pt;
    line-height: 1.2;
    font-weight: 800;
    text-align: center;
  }
  .col-no { width: 14mm; text-align: center; }
  .col-date { width: 26mm; text-align: center; }
  .col-desc { width: auto; }
  .total-label { width: 35mm; text-align: center; }
  .col-amount { width: 23mm; text-align: right; }
  .ledger .total-label {
    font-weight: 900;
    font-size: 11.4pt;
    text-align: center;
  }
  .ledger .total-amount {
    text-align: right;
    font-weight: 900;
    font-size: 12.2pt;
  }
  .ledger .summary-row td {
    height: 6.55mm;
    padding-top: 0.55mm;
    padding-bottom: 0.55mm;
  }
  .ledger .payment-row .col-desc,
  .ledger .payment-row .col-amount {
    font-weight: 900;
  }
  .policy {
    margin-top: 8mm;
    font-size: 12pt;
    line-height: 1.12;
  }
  .policy-title {
    font-weight: 700;
    margin-bottom: 0.8mm;
  }
  .policy p { margin: 0; }
  .closing {
    margin-top: auto;
    margin-bottom: 3mm;
    display: grid;
    grid-template-columns: 1fr 68mm;
    gap: 10mm;
    align-items: end;
  }
  .responsibility {
    color: #7b7b7b;
    font-size: 8.6pt;
    line-height: 1.28;
  }
  .signature {
    height: 14mm;
    background: #f0f0f0;
    display: flex;
    align-items: flex-end;
    justify-content: flex-end;
    padding: 0 2mm 1.2mm 0;
    color: #6b6b6b;
    font-size: 8.2pt;
  }
  @media print { body { background: #fff; } }
  `;

  return `<!doctype html>
  <html>
    <head>
      <meta charset="utf-8" />
      <title>Guest Folio - ${esc(valueOrDash(reservation.booking_code))}</title>
      <style>${css}</style>
    </head>
    <body onload="window.focus();">
      <main class="paper">
        <section class="header">
          <div>
            <div class="title-en">GUEST FOLIO</div>
            <div class="title-th">ใบแจ้งรายการผู้เข้าพัก</div>

            <div class="booking-meta">
              <div><b>หมายเลขการจอง:</b> ${esc(valueOrDash(reservation.booking_code))}</div>
              <div><b>สถานะการจอง:</b> ${esc(statusLabel(reservation.status))}</div>
            </div>

            <div class="stay-meta">
              <div><b>เช็คอินวันที่:</b> ${esc(checkin)} <b>เช็คเอาท์วันที่:</b> ${esc(checkout)}</div>
              <div><b>จำนวนคืน:</b> ${esc(nights)} <b>ห้องพักเลขที่ :</b> ${esc(valueOrDash(reservation.room_number))}</div>
            </div>

            <div class="guest-block">
              <div><b>รายชื่อผู้เข้าพัก:</b> ${esc(valueOrDash(reservation.guest_name))}</div>
              <div><b>ที่อยู่ :</b> ${esc(valueOrDash(reservation.guest_address))}</div>
              <div><b>โทร :</b> ${esc(valueOrDash(reservation.guest_phone))} &nbsp; <b>E-mail :</b> ${esc(valueOrDash(reservation.guest_email))}</div>
            </div>
          </div>

          <aside class="brand">
            <div class="hotel-info">
              <b>โรงแรมตัวอย่าง</b><br />
              000/00 ซ.ตัวอย่าง13 ถ.ตัวอย่าง<br />
              ต.ตัวอย่าง อ.เมือง<br />
              จ.ตัวอย่าง 00000<br />
              โทร 000-000-0000
            </div>
          </aside>
        </section>

        <table class="ledger">
          <colgroup>
            <col style="width: 14mm;" />
            <col style="width: 26mm;" />
            <col />
            <col style="width: 35mm;" />
            <col style="width: 23mm;" />
          </colgroup>
          <thead>
            <tr>
              <th class="col-no">NO.</th>
              <th class="col-date">DATE</th>
              <th class="col-desc" colspan="2">DESCRIPTION (รายละเอียด)</th>
              <th class="col-amount">AMOUNT</th>
            </tr>
          </thead>
          <tbody>
            ${renderRows(data.ledger_rows)}
            <tr class="summary-row">
              <td colspan="3" style="border: none;"></td>
              <td class="total-label">ยอดรวมค่าใช้จ่ายทั้งหมด</td>
              <td class="total-amount">${esc(fmtMoney(data.total_charges))}</td>
            </tr>
            <tr class="summary-row">
              <td colspan="3" style="border: none;"></td>
              <td class="total-label">ยอดที่ชำระแล้ว</td>
              <td class="total-amount">${esc(`(${fmtMoney(Math.abs(data.total_payments))})`)}</td>
            </tr>
            <tr class="summary-row">
              <td colspan="3" style="border: none;"></td>
              <td class="total-label">ยอดเงินที่ยังไม่ได้ชำระ</td>
              <td class="total-amount">${esc(fmtMoney(data.balance_due))}</td>
            </tr>
          </tbody>
        </table>

        <section class="policy">
          <div class="policy-title">นโยบายการชำระเงิน และ เงินมัดจำ</div>
          <p>• โรงแรมขอสงวนสิทธิ์ในการเรียกเก็บเงิน 100% ของยอดเงินรวม ในช่วงเทศกาล หรือ 50% ในช่วงปกติ ล่วงหน้า 3 วัน</p>
          <p>• หากต้องการยกเลิกการจอง ต้องแจ้งล่วงหน้า 3 วัน หากน้อยกว่า 3 วัน การคืนเงินจะพิจารณาตามนโยบายของโรงแรม</p>
          <p>• เงินมัดจำกุญแจ 200 บาท/ห้อง จะได้รับคืน ตอนเช็คเอาท์</p>
        </section>

        <section class="closing">
          <div class="responsibility">
            ข้าพเจ้ายอมรับและตกลงว่าข้าพเจ้าจะเป็นผู้รับผิดชอบต่อค่าบริการทั้งหมดตามที่ระบุไว้และยินยอมรับผิดชอบ<br />
            เป็นการส่วนตัวในกรณีที่บุคคล บริษัท หรือองค์กรที่ระบุ ไม่ชำระค่าบริการทั้งหมดหรือบางส่วน
          </div>
          <div class="signature">ลายเซนต์</div>
        </section>
      </main>
    </body>
  </html>`;
}
