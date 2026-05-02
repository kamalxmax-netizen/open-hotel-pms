/**
 * Phase 40 — Government Document Export Types
 *
 * TM.30: Daily foreign guest accommodation report (Immigration)
 * รร.3: Monthly guest registration form (Hotel Registration)
 */

// ─── TM.30 ──────────────────────────────────────────────────

/** Formatted row ready for Excel export */
export interface TM30ExportRow {
  /** Required */
  first_name: string;
  /** Optional */
  middle_name: string;
  /** Optional */
  last_name: string;
  /** "M" | "F" | "" */
  gender: string;
  /** Required */
  passport_no: string;
  /** ISO 3166 alpha-3 code, e.g. THA, GBR */
  nationality: string;
  /** DD/MM/YYYY or empty */
  birth_date: string;
  /** DD/MM/YYYY or empty */
  checkout_date: string;
  /** Optional phone number */
  phone_no: string;
}

/** Raw guest record from database before formatting */
export interface TM30GuestRecord {
  guest_profile_id: string;
  reservation_id: string;
  first_name: string | null;
  last_name: string | null;
  gender: "M" | "F" | "Other" | null;
  id_type: "thai_id" | "passport" | "other" | null;
  passport_no: string | null;
  nationality_code: string | null;
  dob: string | null;
  checkin_date: string;
  checkout_date: string;
  role: "primary" | "accompanying";
  room_number: string | null;
  report_date: string;
  entry_kind: "checkin" | "late_added_duplicate";
  late_added_at: string | null;
  excluded_from_export: boolean;
}

/** Validation warning for a TM.30 guest record */
export interface TM30Validation {
  guest_profile_id: string;
  field: string;
  message: string;
}

// ─── รร.3 ──────────────────────────────────────────────────

/** Formatted row ready for Excel export */
export interface RR3ExportRow {
  /** เลขลำดับ (auto-increment) */
  seq_no: number;
  /** วันเวลาที่มาเข้าพัก */
  checkin_datetime: string;
  /** ห้องพักเลขที่ */
  room_number: string;
  /** ชื่อตัวและชื่อสกุล */
  full_name: string;
  /** สัญชาติ */
  nationality: string;
  /** เลขประจำตัวประชาชน / passport */
  id_or_passport: string;
  /** ที่อยู่ปัจจุบัน — foreigner: country, Thai: province */
  current_address: string;
  /** อาชีพ — always "รับจ้าง" */
  occupation: string;
  /** มาจาก — same logic as current_address */
  coming_from: string;
  /** จะไปที่ — always the default destination province */
  going_to: string;
  /** วันเวลาที่ออกไป */
  checkout_datetime: string;
  /** หมายเหตุ — auto-list missing required fields */
  remarks: string;
  /** ราคา — full folio total (primary only, accompanying = 0) */
  price: number;
}

/** Raw guest record from database before formatting */
export interface RR3GuestRecord {
  reservation_id: string;
  guest_profile_id: string;
  role: "primary" | "accompanying";
  first_name: string | null;
  last_name: string | null;
  nationality_code: string | null;
  country: string | null;
  province: string | null;
  id_type: "thai_id" | "passport" | "other" | null;
  id_number: string | null;
  passport_no: string | null;
  checkin_date: string;
  checkout_date: string;
  checked_in_at: string | null;
  checked_out_at: string | null;
  room_number: string | null;
  source: string;
  tax_invoice_requested: boolean;
  total_price: number;
  booking_code: string | null;
  rr3_override?: RR3RowOverrideFields | null;
}

export interface RR3PriceSummaryRow {
  unit_price: number;
  quantity: number;
  total: number;
}

export interface RR3PriceSummaryGroup {
  label: string;
  rows: RR3PriceSummaryRow[];
  total_quantity: number;
  total_amount: number;
  copy_text: string;
}

export interface RR3PriceSummary {
  ota_tax: RR3PriceSummaryGroup;
  walkin_direct: RR3PriceSummaryGroup;
}

export type RR3PrintGroupKey = "ota_tax" | "walkin_direct";

export interface RR3RowOverrideFields {
  checkin_datetime: string;
  room_number: string;
  full_name: string;
  nationality: string;
  id_or_passport: string;
  current_address: string;
  occupation: string;
  coming_from: string;
  going_to: string;
  checkout_datetime: string;
  remarks: string;
}

export interface RR3RowOverride extends RR3RowOverrideFields {
  id: string;
  period_id: string;
  reservation_id: string;
  guest_profile_id: string;
  created_at: string | null;
  updated_at: string | null;
}

export interface RR3PrintableRow {
  seq_no: number;
  checkin_datetime: string;
  room_number: string;
  full_name: string;
  nationality: string;
  id_or_passport: string;
  current_address: string;
  occupation: string;
  coming_from: string;
  going_to: string;
  checkout_datetime: string;
  remarks: string;
  row_kind: "system" | "override";
}

/** รร.3 filter parameters */
export interface RR3FilterParams {
  year: number;
  month: number;
  /** Source filter — OR logic with tax_invoice_only */
  sources: string[];
  /** Tax invoice filter — OR logic with sources */
  tax_invoice_only: boolean;
  /** Include accompanying guests (default: true) */
  include_accompanying: boolean;
}

/** Validation warning for a รร.3 guest record */
export interface RR3Validation {
  reservation_id: string;
  guest_profile_id: string;
  field: string;
  message: string;
}
