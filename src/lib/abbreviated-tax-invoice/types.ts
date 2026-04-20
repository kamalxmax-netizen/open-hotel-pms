import type { TaxInvoiceSellerSnapshot } from "@/lib/tax-invoice/types";
import type { BookingSource } from "@/lib/types";

// ============================================================
// Enums / discriminants
// ============================================================

export type AbbreviatedInvoiceStatus = "draft" | "issued" | "cancelled";

export type ChannelGroup = "ota" | "walkin_direct";

export type NightOverrideDecision =
  | "include_this_month"
  | "carry_to_next"
  | "excluded_full_tax";

export type TaxGroup = "A" | "B" | "C" | "D" | "E";

export type RowShiftSource = "auto" | "manual";

// ============================================================
// Room group map (seed)
// ============================================================

export type RoomGroupMap = {
  id: number;
  room_type_code: string;
  tax_group: TaxGroup;
  label_th: string;
  sort_order: number;
  created_at: string;
};

// ============================================================
// Monthly Audit channel flag (D3 / D16)
// ============================================================

export type MonthlyAuditChannelFlag = {
  id: string;
  audit_period_id: string;
  entry_id: string;
  actual_channel: BookingSource;
  tax_invoice_channel: BookingSource;
  reason: string | null;
  flagged_by_user_id: string | null;
  flagged_at: string;
};

export type ChannelFlagUpdateInput = {
  entry_id: string;
  actual_channel: BookingSource;
  tax_invoice_channel: BookingSource;
  reason?: string;
};

// ============================================================
// Pre-generate override tables
// ============================================================

export type NightOverride = {
  id: string;
  audit_period_id: string;
  entry_id: string;
  night_date: string;
  decision: NightOverrideDecision;
  reason: string | null;
  set_by_user_id: string | null;
  set_at: string;
};

export type NightOverrideInput = {
  entry_id: string;
  night_date: string;
  decision: NightOverrideDecision;
  reason?: string;
};

export type RowShiftOverride = {
  id: string;
  audit_period_id: string;
  entry_id: string;
  tax_group: TaxGroup;
  unit_price: number;
  quantity: number;
  original_date: string;
  target_date: string;
  reason: string | null;
  set_by_user_id: string | null;
  set_at: string;
};

export type RowShiftInput = {
  entry_id: string;
  tax_group: TaxGroup;
  unit_price: number;
  quantity: number;
  original_date: string;
  target_date: string;
  reason?: string;
};

export type RowShiftBatchInput = {
  shifts: RowShiftInput[];
};

// ============================================================
// Persisted invoice (head + lines)
// ============================================================

export type AbbreviatedInvoice = {
  id: string;
  invoice_no: string;
  book_no: number;
  issue_date: string;
  channel_group: ChannelGroup;
  tax_invoice_channel: BookingSource;
  audit_period_id: string;
  stay_date_from: string;
  stay_date_to: string;
  subtotal_inc_vat: number;
  subtotal_ex_vat: number;
  vat_rate: number;
  vat_amount: number;
  seller_snapshot: TaxInvoiceSellerSnapshot;
  status: AbbreviatedInvoiceStatus;
  generated_by_user_id: string | null;
  generated_at: string;
  cancelled_reason: string | null;
  cancelled_at: string | null;
};

export type AbbreviatedInvoiceLine = {
  id: string;
  invoice_id: string;
  line_order: number;
  tax_group: TaxGroup;
  label_th: string;
  quantity: number;
  unit_price: number;
  amount: number;
  source_entry_ids: string[];
  shifted_from_date: string | null;
  shifted_reason: string | null;
};

// ============================================================
// Preview aggregation (pre-generate, no writes)
// ============================================================

export type AbbreviatedLineDraft = {
  tax_group: TaxGroup;
  label_th: string;
  quantity: number;
  unit_price: number;
  amount: number;
  source_entry_ids: string[];
  source_entries: {
    entry_id: string;
    guest_name: string;
    checkin_date: string;
    checkout_date: string;
    quantity: number;
  }[];
  shifted_from_date: string | null;
  shift_source: RowShiftSource | null;
};

export type AbbreviatedInvoiceDraft = {
  issue_date: string;
  channel_group: ChannelGroup;
  tax_invoice_channel: BookingSource;
  predicted_invoice_no: string;
  book_no: number;
  lines: AbbreviatedLineDraft[];
  subtotal_inc_vat: number;
  subtotal_ex_vat: number;
  vat_rate: number;
  vat_amount: number;
  warning?: string;
};

export type CarriedFolioInfo = {
  entry_id: string;
  reservation_id: string;
  guest_name: string;
  checkin_date: string;
  checkout_date: string;
  nights_carried: number;
  night_dates: string[];
  reason: "outstanding" | "cross_month" | "manual";
};

export type ExcludedFolioInfo = {
  entry_id: string;
  reservation_id: string;
  guest_name: string;
  reason: "full_tax_invoice_issued" | "dayuse" | "cancelled";
  full_tax_invoice_id?: string;
};

export type AbbreviatedPreviewResponse = {
  period: { year: number; month: number; audit_period_id: string };
  drafts: AbbreviatedInvoiceDraft[];
  carried: CarriedFolioInfo[];
  excluded: ExcludedFolioInfo[];
  summary: {
    total_invoices: number;
    ota_count: number;
    walkin_direct_count: number;
    grand_total_inc_vat: number;
    grand_total_ex_vat: number;
    vat_total: number;
  };
};

// ============================================================
// Render data (print HTML)
// ============================================================

export type AbbreviatedRenderRow = {
  line_order: number;
  label_th: string;
  quantity: number;
  unit_price: number;
  amount: number;
};

export type AbbreviatedRenderHalfPage = {
  invoice_no: string;
  book_no: number;
  issue_date: string;
  stay_date_from: string;
  stay_date_to: string;
  rows: AbbreviatedRenderRow[]; // exactly 7 (pad with blank if fewer)
  subtotal_inc_vat: number;
};

export type AbbreviatedRenderPage = {
  top: AbbreviatedRenderHalfPage;
  bottom: AbbreviatedRenderHalfPage | null; // null = last odd invoice
};

export type AbbreviatedRenderData = {
  channel_group: ChannelGroup;
  seller: TaxInvoiceSellerSnapshot;
  pages: AbbreviatedRenderPage[];
};

// ============================================================
// Service-level helper types
// ============================================================

export type ChannelFlagWithEntry = MonthlyAuditChannelFlag & {
  default_channel: BookingSource; // from PMS when no flag row exists
};

export type GenerateResult = {
  invoices_created: number;
  invoice_ids: string[];
  warnings: string[];
};

export type RecalculateResult = {
  drafts_changed: number;
  new_total_inc_vat: number;
  changed_invoice_ids: string[];
};

// ============================================================
// Constants
// ============================================================

export const ABBREVIATED_MAX_ROWS_PER_HALF_PAGE = 7;
export const ABBREVIATED_VAT_RATE = 7;
export const ABBREVIATED_BOOK_NO_BASE_BE_YEAR = 2561; // พ.ศ. 2561 = เล่ม 0; 2569 = เล่ม 8
