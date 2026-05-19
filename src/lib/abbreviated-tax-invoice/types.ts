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

// Phase 71: Abbreviated invoice source discriminator.
// - room   → Phase 70: daily, per channel_group (ota / walkin_direct)
// - dayuse → Phase 71: monthly, Walk-in only (channel_group = null)
// - pos    → Phase 71: daily, Walk-in only (channel_group = null)
export type AbbreviatedSourceType = "room" | "dayuse" | "pos";

// Phase 71: which print template to render.
// - full_a4 → 2 half-pages per A4 (Phase 70 room; Phase 71 POS daily)
// - half_a4 → 1 half per A4        (Phase 71 Day Use monthly, printed alone)
export type AbbreviatedRenderMode = "full_a4" | "half_a4";

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
  // Phase 71: NULL for source_type='dayuse' | 'pos' (Walk-in only, no channel split)
  channel_group: ChannelGroup | null;
  // Phase 71: discriminator — room (Phase 70) | dayuse | pos
  source_type: AbbreviatedSourceType;
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
  // Phase 71: NULL for dayuse/pos lines (A-E applies only to rooms).
  tax_group: TaxGroup | null;
  label_th: string;
  quantity: number;
  unit_price: number;
  amount: number;
  // source_entry_ids semantics by parent invoice.source_type:
  //   - room   → monthly_audit_entries.id[]
  //   - dayuse → monthly_audit_entries.id[] (day-use folios)
  //   - pos    → pos_orders.id[]
  source_entry_ids: string[];
  shifted_from_date: string | null;
  shifted_reason: string | null;
};

// ============================================================
// Preview aggregation (pre-generate, no writes)
// ============================================================

export type AbbreviatedLineDraft = {
  // Phase 71: NULL for dayuse/pos lines (A-E applies only to rooms).
  tax_group: TaxGroup | null;
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

// Phase 71: POS daily line draft (one row per POS product sold that day).
// Aggregates multiple pos_orders of the same product into one line.
export type PosItemDraft = {
  product_id: string;
  label_th: string;                 // = products.name_th
  quantity: number;                 // sum across orders
  unit_price: number;               // = products.sale_price
  amount: number;                   // = unit_price * quantity
  source_order_ids: string[];       // pos_orders.id[]
  source_orders: {
    order_id: string;
    order_number: string;
    order_date: string;
    quantity: number;
  }[];
};

export type AbbreviatedInvoiceDraft = {
  // Phase 71: discriminator for downstream rendering + persistence
  source_type: AbbreviatedSourceType;
  render_mode: AbbreviatedRenderMode;
  issue_date: string;
  // NULL for source_type='dayuse' | 'pos' (Walk-in only)
  channel_group: ChannelGroup | null;
  tax_invoice_channel: BookingSource;
  predicted_invoice_no: string;
  book_no: number;
  stay_date_from: string;
  stay_date_to: string;
  // Room (Phase 70) + Day Use (Phase 71) share the line shape.
  lines: AbbreviatedLineDraft[];
  // Phase 71 POS-only: rendered as label_th rows (no tax_group).
  pos_items?: PosItemDraft[];
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

// Phase 71: POS daily preview response (/pms/preview/pos/[date]).
// One draft per day. No carry-over / no exclusions (POS = immediate sale).
export type AbbreviatedPosPreviewResponse = {
  date: string;                    // ISO date — YYYY-MM-DD
  draft: AbbreviatedInvoiceDraft | null;  // null if no POS walk-in sales that day
  summary: {
    total_orders: number;          // # of source pos_orders
    total_items: number;           // distinct product rows
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
  // Phase 71: NULL for dayuse/pos (Walk-in only, no channel split in header)
  channel_group: ChannelGroup | null;
  // Phase 71: discriminator for header + paper layout
  source_type: AbbreviatedSourceType;
  render_mode: AbbreviatedRenderMode;
  seller: TaxInvoiceSellerSnapshot;
  pages: AbbreviatedRenderPage[];
};

// Phase 71: Products admin row used by POS item master (ProductsTab).
// Extends the base `products` table with POS invoice label metadata.
export type PosProduct = {
  id: string;
  name: string;                           // English master name
  name_th: string | null;                 // Thai label printed on ใบกำกับภาษีอย่างย่อ
  sku: string | null;
  category: "amenity" | "pos" | "both";
  unit: string;
  sale_price: number | null;              // must be set before POS sale (enforced in RPC)
  is_active: boolean;
  pos_abbreviated_enabled: boolean;       // gate for POS abbreviated invoice aggregation
  created_at: string;
  updated_at: string;
};

// ============================================================
// Service-level helper types
// ============================================================

export type ChannelFlagWithEntry = MonthlyAuditChannelFlag & {
  default_channel: BookingSource; // from PMS when no flag row exists
};

export type GenerateResult = {
  invoices_created: number;
  invoices_updated: number;
  invoices_cancelled: number;
  invoice_ids: string[];
  warnings: string[];
};

export type RecalculateResult = {
  drafts_changed: number;
  new_total_inc_vat: number;
  changed_invoice_ids: string[];
  cancelled_invoice_ids: string[];
};

// ============================================================
// Constants
// ============================================================

export const ABBREVIATED_MAX_ROWS_PER_HALF_PAGE = 7;
export const ABBREVIATED_VAT_RATE = 7;
export const ABBREVIATED_BOOK_NO_BASE_BE_YEAR = 2561; // พ.ศ. 2561 = เล่ม 0; 2569 = เล่ม 8

// Invoice number prefixes (BE year is 2-digit, % 100).
//   Room OTA           → YYMM + monthly sequence       e.g. 690401
//   Room Walk-in/Dir.  → W + YYMM + monthly sequence   e.g. W690401
//   Day Use monthly    → DY + YY + MM                  e.g. DY6904 (one per audit period)
//   POS daily          → D + YYMM + monthly sequence   e.g. D690401
export const ABBREVIATED_INVOICE_NO_PREFIX = {
  ROOM_OTA: "",
  ROOM_WALKIN_DIRECT: "W",
  DAYUSE_MONTHLY: "DY",
  POS_DAILY: "D",
} as const;
