export type TaxInvoiceLanguage = "th" | "en";
export type TaxInvoiceStatus = "draft" | "issued" | "cancelled";
export type TaxInvoiceKind = "standard" | "prepayment" | "balance";

export type TaxInvoiceLineItemKind = "room_charge" | "extra_charge";

export type TaxInvoiceLineItem = {
  kind: TaxInvoiceLineItemKind;
  description: string;
  quantity: number;
  unit: string;
  unit_price: number;
  amount: number;
  gross_amount?: number;
  discount_amount?: number;
  room_count?: number;
  merged_reservation_ids?: string[];
  merged_line_sources?: Array<{
    reservation_id?: string | null;
    room_number?: string | null;
    gross_amount?: number;
    discount_amount?: number;
    amount?: number;
  }>;
  stay_dates?: string[];
  room_id?: string | null;
  room_number?: string | null;
  reservation_id?: string | null;
  merged_extra_charge_ids?: string[];
  merged_extra_charge_total?: number;
  fee_template_code?: string | null;
  note?: string | null;
};

export type TaxInvoiceAvailableExtraItem = {
  id: string;
  reservation_id: string;
  description: string;
  amount: number;
  paid_date: string | null;
  room_number: string | null;
  fee_template_code?: string | null;
  note?: string | null;
};

export type TaxInvoiceTotals = {
  subtotal: number;
  vat_rate: number;
  vat_amount: number;
  grand_total: number;
  discount: number;
};

export type TaxInvoiceBookingSnapshot = {
  booking_code: string | null;
  booking_codes?: string[];
  source: string | null;
  checkin_date: string | null;
  checkout_date: string | null;
  nights: number;
  room_numbers: string[];
  reservation_ids?: string[];
  booking_group_id?: string | null;
  invoice_kind?: TaxInvoiceKind;
  split_group_id?: string | null;
  coverage_amount?: number | null;
  coverage_note?: string | null;
  full_net_total?: number | null;
};

export type TaxInvoiceSellerSnapshot = {
  hotel_name: string | null;
  company_name: string | null;
  company_name_en: string | null;
  company_tax_id: string | null;
  company_address: string | null;
  company_address_en: string | null;
  company_branch: string | null;
  company_phone: string | null;
};

export type BuildLineItemsResult = {
  reservation: {
    id: string;
    reservation_ids: string[];
    booking_code: string | null;
    guest_name: string | null;
    source: string | null;
    checkin_date: string | null;
    checkout_date: string | null;
    tax_invoice_requested: boolean;
    guest_profile_id: string | null;
  };
  line_items: TaxInvoiceLineItem[];
  available_extra_items?: TaxInvoiceAvailableExtraItem[];
  totals: TaxInvoiceTotals;
  booking_snapshot: TaxInvoiceBookingSnapshot;
};
