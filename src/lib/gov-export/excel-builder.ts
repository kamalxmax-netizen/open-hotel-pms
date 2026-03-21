/**
 * Excel Builder — Generate .xls (TM.30) and .xlsx (รร.3) files
 *
 * Uses SheetJS (xlsx) library for both formats.
 * TM.30 must be .xls (BIFF8) to match immigration system requirements.
 */

import * as XLSX from "xlsx";
import {
  TM30_COLUMNS,
  TM30_SHEET_NAME,
  RR3_COLUMNS,
  toThaiGovDate,
  genderDisplay,
} from "./constants";
import { getCountryByCode, getDemonymByCode } from "../nationality-map";
import type { TM30GuestRecord, TM30ExportRow, RR3ExportRow, RR3GuestRecord } from "./types";
import {
  RR3_DEFAULT_OCCUPATION,
  RR3_DEFAULT_DESTINATION,
  toThaiGovDatetime,
} from "./constants";

// ─── TM.30 ──────────────────────────────────────────────────

/**
 * Convert raw TM30GuestRecord to formatted TM30ExportRow
 */
export function formatTM30Row(record: TM30GuestRecord): TM30ExportRow {
  return {
    first_name: record.first_name ?? "",
    middle_name: "",
    last_name: record.last_name ?? "",
    passport_no: record.passport_no ?? "",
    gender: genderDisplay(record.gender),
    nationality: String(record.nationality_code ?? "").toUpperCase(),
    birth_date: record.dob ? toThaiGovDate(record.dob) : "",
    checkout_date: "", // intentionally empty — guest may extend
    phone_no: "",
  };
}

/**
 * Build TM.30 Excel workbook as .xls Buffer
 */
export function buildTM30Workbook(records: TM30GuestRecord[]): Buffer {
  const rows = records.map(formatTM30Row);

  const wsData: (string | number)[][] = [
    [...TM30_COLUMNS],
    ...rows.map((r) => [
      r.first_name,
      r.middle_name,
      r.last_name,
      r.gender,
      r.passport_no,
      r.nationality,
      r.birth_date,
      r.checkout_date,
      r.phone_no,
    ]),
  ];

  const wb = XLSX.utils.book_new();
  const ws = XLSX.utils.aoa_to_sheet(wsData);
  XLSX.utils.book_append_sheet(wb, ws, TM30_SHEET_NAME);

  return Buffer.from(
    XLSX.write(wb, { type: "buffer", bookType: "xls" })
  );
}

// ─── รร.3 ──────────────────────────────────────────────────

/**
 * Resolve address field:
 * - Thai national (THA) → province
 * - Foreign → country name
 */
function resolveAddress(record: RR3GuestRecord): string {
  const natCode = String(record.nationality_code ?? "").toUpperCase();
  if (natCode === "THA") {
    return record.province ?? "";
  }
  // Foreign: use country name
  return getCountryByCode(record.nationality_code) ?? record.country ?? "";
}

/**
 * Build missing-field remarks for a guest
 */
function buildRemarks(record: RR3GuestRecord): string {
  const missing: string[] = [];
  if (!record.first_name && !record.last_name) missing.push("ชื่อ-สกุล");
  if (!record.nationality_code) missing.push("สัญชาติ");
  if (!record.id_number && !record.passport_no) missing.push("เลขบัตร/passport");
  if (!record.room_number) missing.push("ห้องพัก");
  if (!record.checkin_date) missing.push("วันเข้าพัก");
  if (missing.length === 0) return "";
  return `ขาด: ${missing.join(", ")}`;
}

/**
 * Convert raw RR3GuestRecord to formatted RR3ExportRow
 */
export function formatRR3Row(record: RR3GuestRecord, seqNo: number): RR3ExportRow {
  const fullName = [record.first_name, record.last_name].filter(Boolean).join(" ");
  const natDisplay = getDemonymByCode(record.nationality_code) ?? getCountryByCode(record.nationality_code) ?? "";
  const idOrPassport = record.passport_no || record.id_number || "";
  const address = resolveAddress(record);

  return {
    seq_no: seqNo,
    checkin_datetime: record.checked_in_at
      ? toThaiGovDatetime(record.checked_in_at)
      : toThaiGovDate(record.checkin_date),
    room_number: record.room_number ?? "",
    full_name: fullName,
    nationality: natDisplay,
    id_or_passport: idOrPassport,
    current_address: address,
    occupation: RR3_DEFAULT_OCCUPATION,
    coming_from: address,
    going_to: RR3_DEFAULT_DESTINATION,
    checkout_datetime: toThaiGovDate(record.checkout_date),
    remarks: buildRemarks(record),
    price: record.role === "primary" ? Math.round(record.total_price * 100) / 100 : 0,
  };
}

/**
 * Build รร.3 Excel workbook as .xlsx Buffer
 */
export function buildRR3Workbook(records: RR3GuestRecord[]): Buffer {
  const rows = records.map((r, i) => formatRR3Row(r, i + 1));

  const wsData: (string | number)[][] = [
    [...RR3_COLUMNS],
    ...rows.map((r) => [
      r.seq_no,
      r.checkin_datetime,
      r.room_number,
      r.full_name,
      r.nationality,
      r.id_or_passport,
      r.current_address,
      r.occupation,
      r.coming_from,
      r.going_to,
      r.checkout_datetime,
      r.remarks,
      r.price,
    ]),
  ];

  const wb = XLSX.utils.book_new();
  const ws = XLSX.utils.aoa_to_sheet(wsData);
  XLSX.utils.book_append_sheet(wb, ws, "Sheet1");

  return Buffer.from(
    XLSX.write(wb, { type: "buffer", bookType: "xlsx" })
  );
}
