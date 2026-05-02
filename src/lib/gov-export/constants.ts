/**
 * Phase 40 — Government Document Export Constants
 *
 * Column definitions and default values for TM.30 and รร.3 exports.
 * These MUST match the government templates exactly.
 */

// ─── TM.30 ──────────────────────────────────────────────────

/**
 * TM.30 column headers — must match the immigration import template.
 * Template file: Template-InformAccom-ImportExcel.xls
 *
 * Note: DepartureDate column is present but left empty
 * because guest may extend their stay.
 */
export const TM30_COLUMNS = [
  "ชื่อ\nFirst Name *",
  "ชื่อกลาง\nMiddle Name",
  "นามสกุล\nLast Name",
  "เพศ\nGender *",
  "เลขหนังสือเดินทาง\nPassport No. *",
  "สัญชาติ\nNationality *",
  "วัน เดือน ปี เกิด\nBirth Date\nDD/MM/YYYY(ค.ศ. / A.D.) \nเช่น 17/06/1985 หรือ 10/00/1985 หรือ 00/00/1985",
  "วันที่แจ้งออกจากที่พัก\nCheck-out Date\nDD/MM/YYYY(ค.ศ. / A.D.) \nเช่น 14/06/2023",
  "เบอร์โทรศัพท์\nPhone No.",
] as const;

/** Sheet name must match the template */
export const TM30_SHEET_NAME = "แบบแจ้งที่พัก Inform Accom";

/** TM.30 filename pattern: TM30-YYYY-MM-DD.xls */
export function tm30Filename(date: string): string {
  return `TM30-${date}.xls`;
}

// ─── รร.3 ──────────────────────────────────────────────────

/**
 * รร.3 column headers (Thai) — must match the hotel registration template.
 * Template file: Guest RR3.xlsx
 */
export const RR3_COLUMNS = [
  "เลขลำดับ",
  "วันเวลาที่มาเข้าพัก",
  "ห้องพักเลขที่",
  "ชื่อตัวและชื่อสกุล",
  "สัญชาติ",
  "เลขประจำตัวประชาชน หรือ ใบสำคัญประจำตัวคนต่างด้าว หรือ หนังสือเดินทาง",
  "ที่อยู่ปัจจุบัน อยุ่ที่ ตำบล อำเภอ จังหวัด หรือประเทศใด",
  "อาชีพ",
  "มาจาก ตำบล อำเภอ จังหวัด หรือ ประเทศใด",
  "จะไปที่ ตำบล อำเภอ จังหวัด หรือ ประเทศใด",
  "วัน เวลาที่ ออกไป",
  "หมายเหตุ",
  "ราคา",
] as const;

/** Default occupation for all guests */
export const RR3_DEFAULT_OCCUPATION = "รับจ้าง";

/** Default destination — hotel is in Example Province */
export const RR3_DEFAULT_DESTINATION = "ตัวอย่าง";

/** รร.3 filename pattern: RR3-YYYY-MM.xlsx */
export function rr3Filename(year: number, month: number): string {
  return `RR3-${year}-${String(month).padStart(2, "0")}.xlsx`;
}

// ─── Shared ─────────────────────────────────────────────────

/**
 * Format YYYY-MM-DD → DD/MM/YYYY (Thai government date format)
 * Returns empty string for invalid input.
 */
export function toThaiGovDate(isoDate: string | null | undefined): string {
  if (!isoDate) return "";
  const parts = isoDate.split("-");
  if (parts.length !== 3) return "";
  return `${parts[2]}/${parts[1]}/${parts[0]}`;
}

function toBuddhistYear(year: number): number {
  return year >= 2400 ? year : year + 543;
}

/**
 * Format YYYY-MM-DD → DD/MM/BBBB for รร.3 print/edit output.
 */
export function toThaiGovBuddhistDate(isoDate: string | null | undefined): string {
  if (!isoDate) return "";
  const parts = isoDate.slice(0, 10).split("-");
  if (parts.length !== 3) return "";
  const year = Number(parts[0]);
  if (!Number.isFinite(year)) return "";
  return `${parts[2]}/${parts[1]}/${toBuddhistYear(year)}`;
}

/**
 * Normalize stored RR3 date text to date-only DD/MM/BBBB.
 * Supports old overrides saved as DD/MM/YYYY HH:mm or ISO timestamps.
 */
export function normalizeThaiGovBuddhistDateText(value: string | null | undefined): string {
  const trimmed = String(value ?? "").trim();
  if (!trimmed) return "";
  if (/^\d{4}-\d{2}-\d{2}/.test(trimmed)) {
    return toThaiGovBuddhistDate(trimmed.slice(0, 10));
  }
  const dateOnly = trimmed.split(/\s+/)[0]?.replace(/,$/, "") ?? trimmed;
  const slash = dateOnly.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (!slash) return dateOnly;
  const [, day, month, rawYear] = slash;
  const year = Number(rawYear);
  if (!Number.isFinite(year)) return dateOnly;
  return `${day}/${month}/${toBuddhistYear(year)}`;
}

/**
 * Format ISO datetime → DD/MM/YYYY HH:mm
 * For checked_in_at / checked_out_at timestamps.
 */
export function toThaiGovDatetime(
  isoDatetime: string | null | undefined
): string {
  if (!isoDatetime) return "";
  try {
    const d = new Date(isoDatetime);
    if (isNaN(d.getTime())) return "";
    const bkk = new Intl.DateTimeFormat("en-GB", {
      timeZone: "Asia/Bangkok",
      day: "2-digit",
      month: "2-digit",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    }).format(d);
    return bkk;
  } catch {
    return "";
  }
}

/** Gender code for TM.30 template */
export function genderDisplay(
  code: "M" | "F" | "Other" | null | undefined
): string {
  if (code === "M") return "M";
  if (code === "F") return "F";
  return "";
}
