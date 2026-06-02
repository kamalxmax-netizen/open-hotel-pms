import { formatRR3Row } from "./excel-builder";
import type { RR3GuestRecord, RR3PrintableRow, RR3PrintGroupKey } from "./types";
import { rr3PrintGroupLabel } from "./rr3-row-overrides";

type RR3PrintData = {
  year: number;
  month: number;
  group?: RR3PrintGroupKey;
  group_label?: string;
  entries: RR3GuestRecord[];
};

const MONTHS_TH = [
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

const ROWS_PER_PAGE = 22;

function esc(value: unknown): string {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function chunkRows<T>(rows: T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let i = 0; i < rows.length; i += size) {
    chunks.push(rows.slice(i, i + size));
  }
  return chunks.length > 0 ? chunks : [[]];
}

function toPrintableRows(entries: RR3GuestRecord[]): RR3PrintableRow[] {
  return entries.map((entry, index) => {
    const row = formatRR3Row(entry, index + 1);
    return {
      seq_no: row.seq_no,
      checkin_datetime: row.checkin_datetime,
      room_number: row.room_number,
      full_name: row.full_name,
      nationality: row.nationality,
      id_or_passport: row.id_or_passport,
      current_address: row.current_address,
      occupation: row.occupation,
      coming_from: row.coming_from,
      going_to: row.going_to,
      checkout_datetime: row.checkout_datetime,
      remarks: row.remarks,
      row_kind: entry.rr3_override ? "override" as const : "system" as const,
    };
  });
}

function renderEmptyCells(count: number) {
  return Array.from({ length: count })
    .map(
      () => `
        <tr class="empty-row">
          <td></td><td></td><td></td><td></td><td></td><td></td>
          <td></td><td></td><td></td><td></td><td></td><td></td>
        </tr>`
    )
    .join("");
}

function renderRows(rows: RR3PrintableRow[]) {
  return rows
    .map(
      (row) => `
        <tr class="${row.row_kind === "override" ? "manual-row" : ""}">
          <td class="seq">${row.seq_no}</td>
          <td>${esc(row.checkin_datetime)}</td>
          <td>${esc(row.room_number)}</td>
          <td class="name">${esc(row.full_name)}</td>
          <td>${esc(row.nationality)}</td>
          <td class="id-col">${esc(row.id_or_passport)}</td>
          <td>${esc(row.current_address)}</td>
          <td>${esc(row.occupation)}</td>
          <td>${esc(row.coming_from)}</td>
          <td>${esc(row.going_to)}</td>
          <td>${esc(row.checkout_datetime)}</td>
          <td>${esc(row.remarks)}</td>
        </tr>`
    )
    .join("");
}

export function renderRR3LandscapeHtml(data: RR3PrintData): string {
  const rows = toPrintableRows(data.entries);
  const pages = chunkRows(rows, ROWS_PER_PAGE);
  const buddhistYear = data.year + 543;
  const monthLabel = MONTHS_TH[data.month - 1] ?? String(data.month);
  const groupLabel = data.group_label ?? (data.group ? rr3PrintGroupLabel(data.group) : "");

  return `<!doctype html>
<html lang="th">
<head>
  <meta charset="utf-8" />
  <title>${esc(groupLabel)} ${esc(monthLabel)} ${buddhistYear}</title>
  <style>
    @font-face {
      font-family: "TH Sarabun New";
      src: url("/fonts/THSarabunNew.ttf") format("truetype");
      font-weight: 400;
      font-style: normal;
    }
    @font-face {
      font-family: "TH Sarabun New";
      src: url("/fonts/THSarabunNew Bold.ttf") format("truetype");
      font-weight: 700;
      font-style: normal;
    }
    @page { size: A4 landscape; margin: 0mm; }
    * { box-sizing: border-box; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
    html, body {
      margin: 0;
      padding: 0;
      background: #d8d8d8;
      color: #000;
      font-family: "TH Sarabun New", "Sarabun", Tahoma, Arial, sans-serif;
      font-size: 10.8pt;
      line-height: 1.05;
    }
    .page {
      width: 297mm;
      height: 210mm;
      margin: 0 auto 8mm;
      padding: 10mm 15mm 8mm;
      background: #fff;
      page-break-after: always;
      overflow: hidden;
    }
    .page:last-child { page-break-after: auto; }
    .title {
      height: 18mm;
      text-align: center;
      font-weight: 700;
      font-size: 17.6pt;
      line-height: 1.1;
      padding-top: 0mm;
    }
    .title .sub {
      margin-top: 0.84mm;
      font-size: 14pt;
      font-weight: 700;
    }
    table {
      width: 100%;
      border-collapse: collapse;
      table-layout: fixed;
      border: 0.8pt solid #000;
    }
    th, td {
      border: 0.65pt solid #000;
      padding: 0.3mm 0.6mm;
      text-align: center;
      vertical-align: middle;
      overflow: hidden;
      word-break: break-word;
    }
    th {
      height: 20mm;
      font-size: 10.5pt;
      font-weight: 700;
      line-height: 1.1;
    }
    td {
      height: 5.8mm;
      font-size: 10.5pt;
      line-height: 1;
    }
    .seq { width: 8.5mm; }
    .name { text-align: left; padding-left: 1.7mm; }
    .id-col { font-size: 9.5pt; }
    .manual-row td { background: #fff; }
    .empty-row td { color: transparent; }
    .c-seq { width: 8.5mm; }
    .c-date { width: 14mm; }
    .c-room { width: 12mm; }
    .c-name { width: 54.5mm; }
    .c-nat { width: 16.5mm; }
    .c-id { width: 28mm; }
    .c-address { width: 24mm; }
    .c-job { width: 15mm; }
    .c-from { width: 20mm; }
    .c-to { width: 20mm; }
    .c-out { width: 18mm; }
    .c-note { width: 18mm; }
    .footer {
      position: relative;
      height: 22mm;
      margin-top: 4mm;
      font-size: 12pt;
    }
    .cert {
      position: absolute;
      right: 0;
      top: 0;
      width: 83mm;
      text-align: center;
      line-height: 1.55;
    }
    .cert-name {
      margin-top: -4mm;
    }
    .signature-line {
      position: relative;
      height: 10mm;
      line-height: 10mm;
    }
    .signature-img {
      position: absolute;
      left: 50%;
      top: -3mm;
      width: 23.7mm;
      height: auto;
      max-height: 13.6mm;
      transform: translateX(-50%);
      object-fit: contain;
      pointer-events: none;
    }
    .page-no {
      position: absolute;
      left: 0;
      bottom: 0;
      font-size: 9pt;
    }
    @media print {
      html, body { background: #fff; }
      .page { margin: 0; box-shadow: none; }
    }
  </style>
</head>
<body>
  ${pages
    .map((pageRows, pageIndex) => {
      const emptyCount = Math.max(0, ROWS_PER_PAGE - pageRows.length);
      return `
        <main class="page">
          <div class="title">
            <div>ทะเบียนผู้พักใน โรงแรมตัวอย่าง</div>
            <div class="sub">ประจำเดือน ${esc(monthLabel)} ${buddhistYear}</div>
          </div>
          <table>
            <colgroup>
              <col class="c-seq" /><col class="c-date" /><col class="c-room" /><col class="c-name" />
              <col class="c-nat" /><col class="c-id" /><col class="c-address" /><col class="c-job" />
              <col class="c-from" /><col class="c-to" /><col class="c-out" /><col class="c-note" />
            </colgroup>
            <thead>
                <th>เลขลำดับ</th>
                <th>วันเวลาพัก</th>
                <th>ห้องพัก</th>
                <th>ชื่อตัวและชื่อสกุล</th>
                <th>สัญชาติ</th>
                <th>เลขประจำตัวประชาชน<br/>หรือ ใบสำคัญประจำตัว<br/>คนต่างด้าว หรือ<br/>หนังสือเดินทาง</th>
                <th>ที่อยู่ปัจจุบัน ตำบล อำเภอ จังหวัด หรือ ประเทศใด</th>
                <th>อาชีพ</th>
                <th>มาจาก ตำบล อำเภอ จังหวัด หรือ ประเทศใด</th>
                <th>จะไปที่ ตำบล อำเภอ จังหวัด หรือ ประเทศใด</th>
                <th>วัน เวลาออก</th>
                <th>หมายเหตุ</th>
            </thead>
            <tbody>
              ${renderRows(pageRows)}
              ${renderEmptyCells(emptyCount)}
            </tbody>
          </table>
          <div class="footer">
            <div class="page-no">หน้า ${pageIndex + 1} / ${pages.length}</div>
            <div class="cert">
              <div>ขอรับรองว่าเป็นความจริงทุกประการ</div>
              <div class="signature-line">
                ลงชื่อ....................................................ผู้จัดการ
              </div>
              <div class="cert-name">นาย ตัวอย่าง สมมุติ</div>
            </div>
          </div>
        </main>`;
    })
    .join("")}
</body>
</html>`;
}
