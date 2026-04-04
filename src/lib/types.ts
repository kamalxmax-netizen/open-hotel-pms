export type UserRole = "admin" | "frontdesk" | "maid" | "supervisor";

export type BookingSource = "walkin" | "ota" | "direct" | "agent";

export type ReservationStatus = "active" | "draft_checkin" | "cancelled" | "checked_out" | "no_show";

export type LinkedStaySegment = {
  reservation_id: string;
  booking_code: string | null;
  source: string;          // "ota" | "walkin" | "direct" | "agent"
  checkin_date: string;
  checkout_date: string;
  status: string;          // "active" | "checked_out" | "cancelled"
  total_price: number;
  is_parent: boolean;
};

export type LinkedStay = {
  segments: LinkedStaySegment[];
  full_checkin: string;
  full_checkout: string;
  full_nights: number;
  active_segment_id: string;
  combined_total: number;
};

export type HousekeepingStatus = "dirty" | "in_progress" | "paused" | "cleaned" | "approved";

export type PaymentMethod = "cash" | "transfer" | "credit_card" | "other";
export type OperatorPaymentMethod = "cash" | "transfer" | "credit_card";

export type FolioLedgerRowType = "room_charge" | "discount" | "extra_charge" | "payment" | "refund" | "deposit";

export interface ReservationFolioSummary {
  room_charges_total: number;
  discount_total: number;
  extra_charges_total: number;
  grand_total: number;
  payments_total: number;
  refunds_total: number;
  deposit_held: number;
  outstanding_balance: number;
}

export interface ReservationFolioLedgerRow {
  id: string;
  occurred_at: string;
  type: FolioLedgerRowType;
  tx_type?: string | null;
  method: PaymentMethod | null;
  amount: number;
  revenue_category: string | null;
  fee_template_code: string | null;
  template_name: string | null;
  note: string | null;
  cashier_name: string | null;
  label: string;
  is_record_only?: boolean;
  is_void_reversal?: boolean;
  void_of?: string | null;
  is_correction?: boolean;
  correction_ref?: string | null;
  correction_reason?: string | null;
}

export interface ReservationFolioResponse {
  success: true;
  reservation_id: string;
  reservation: {
    id: string;
    booking_code: string | null;
    guest_name: string | null;
    source: string | null;
    status: string | null;
    room_number: string | null;
    checkin_date: string | null;
    checkout_date: string | null;
    checked_in_at: string | null;
    checked_out_at: string | null;
    deposit_note?: string | null;
    tax_invoice_requested?: boolean;
    folio_reopened?: boolean;
  };
  summary: ReservationFolioSummary;
  ledger: ReservationFolioLedgerRow[];
  linked_folios?: Array<{
    reservation_id: string;
    booking_code: string | null;
    source: string | null;
    checkin_date: string | null;
    checkout_date: string | null;
    summary: ReservationFolioSummary;
  }> | null;
  linked_stay?: LinkedStay | null;
}

// ── Admin Corrections (Phase 42) ──────────────────────────────

export type AdminCorrectionAction =
  | "void"
  | "adjustment"
  | "reinstate"
  | "reopen_folio"
  | "close_folio"
  | "transfer_payment";

export interface AdminCorrectionRecord {
  id: string;
  reservation_id: string;
  action: AdminCorrectionAction;
  actor_user_id: string;
  actor_name?: string;
  before_snapshot: Record<string, unknown>;
  after_snapshot: Record<string, unknown>;
  reason: string;
  related_payment_ids: string[];
  business_date: string;
  created_at: string;
}

/** Payload for void action */
export interface VoidPaymentPayload {
  payment_id: string;
  reason: string;
}

/** Payload for adjustment action */
export interface AdjustmentPayload {
  reservation_id: string;
  direction: "add_charge" | "reduce_charge";
  amount: number;
  method: PaymentMethod;
  original_payment_id?: string | null;
  reason: string;
}

/** Payload for reinstate action */
export interface ReinstatePayload {
  reservation_id: string;
  target_room_id?: string | null;
  reason: string;
}

/** Payload for reopen/close folio action */
export interface ReopenFolioPayload {
  reservation_id: string;
  reason: string;
}

/** Payload for transfer payment action */
export interface TransferPaymentPayload {
  source_reservation_id: string;
  destination_reservation_id: string;
  amount: number;
  method: PaymentMethod;
  reason: string;
}

/** Extended folio ledger row with correction metadata */
export interface FolioLedgerCorrectionMeta {
  is_void_reversal: boolean;
  void_of: string | null;
  is_correction: boolean;
  correction_ref: string | null;
  correction_reason: string | null;
}

// ── End Admin Corrections ─────────────────────────────────────

export type ExtraFeeCategory = "service" | "penalty" | "damage" | "policy";
export type RatePlanTierCode = "loyal" | "vip" | "longest";
export type RatePlanEligibilitySource = "public" | "tier" | "profile";

export interface RatePlanAccessSummary {
  is_public: boolean;
  tier_codes: RatePlanTierCode[];
  profile_ids: string[];
}

export interface ExtraFeeTemplate {
  code: string;
  name: string;
  default_price: number;
  category: ExtraFeeCategory;
  icon: string | null;
  is_active: boolean;
  sort_order: number;
  created_at: string;
}

export interface LoanCollectionItem {
  trace_id: string;
  item_code: string;
  item_name: string;
  item_icon: string;
  quantity: number;
  due_date: string | null;
  /** true when due_date <= today or checkout; false when still active but not yet due */
  is_due?: boolean;
}

export interface Room {
  id: string;
  room_number: string;
  is_sellable: boolean;
  is_visible_on_board: boolean;
  closure_reason: string | null;
}

export interface ReservationNight {
  id: string;
  reservation_id: string;
  room_id: string;
  stay_date: string;
  nightly_price: number;
  is_ota: boolean;
  cancelled_at: string | null;
}

// ── Housekeeping Phase 6 ──

export interface ChecklistItem {
  item: string;
  quantity: number;
  used: number;
  checked: boolean;
  category: string;
  product_id?: string | null;
}

export interface MaintenanceChecklistSubmission {
  assignment_id: string;
  items: Array<{
    item: string;
    checked: boolean;
    note?: string;
  }>;
}

export interface DailyPlanAssignment {
  room_id: string;
  room_number: string;
  room_type_code: string;
  assigned_maid: string;
  priority: number;
  cleaning_duration_min: number;
}

export interface HousekeepingTaskExtended {
  id: string;
  room_id: string;
  stay_date: string;
  status: HousekeepingStatus;
  assigned_maid_name: string | null;
  started_at: string | null;
  finished_at: string | null;
  approved_at: string | null;
  accumulated_ms: number;
  is_no_service: boolean;
  checklist_snapshot: ChecklistItem[] | null;
}

export type MaidRoomStatus = HousekeepingStatus | "no_service";

export interface MaidRoom {
  task_id: string | null;
  room_id: string;
  room_number: string;
  room_type_code: string;
  priority: number;
  status: MaidRoomStatus;
  is_no_service: boolean;
  no_service_note?: string | null;
  cleaning_duration_min?: number;
  target_duration_min?: number;
  accumulated_ms: number;
  started_at: string | null;
  finished_at: string | null;
  approved_at: string | null;
  guest_name: string | null;
  checkin_date?: string | null;
  checkout_date?: string | null;
  checklist_items?: ChecklistItem[];
  maintenance_assignments?: Array<{
    assignment_id: string;
    task_id: string;
    task_name: string;
    sync_to_housekeeper?: boolean;
    checklist_items: string[] | null;
    estimated_minutes: number;
    notes: string | null;
  }>;
  maintenance_minutes_total?: number;
  loan_collections?: LoanCollectionItem[];
  hk_traces?: Array<{
    id: string;
    text: string;
  }>;
}

// ── Phase 9: Extra Tasks ──

export interface ExtraTaskTemplate {
  id: string;
  name: string;
  duration_min: number;
  category: string;
  is_active: boolean;
  created_at: string;
}

export interface ExtraTaskAssignment {
  id: string;
  assignment_date: string;
  template_id: string | null;
  task_name: string;
  assigned_maid: string;
  status: 'pending' | 'in_progress' | 'paused' | 'done' | 'cancelled';
  priority: number;
  duration_min: number;
  started_at: string | null;
  finished_at: string | null;
  accumulated_ms: number;
  notes: string | null;
  created_at: string;
  updated_at: string;
}

// ── Phase 9: Maintenance Hub ──

export interface MaintenanceTask {
  id: string;
  name: string;
  description: string | null;
  threshold_count: number;
  warning_count: number | null;
  applicable_room_types: string[] | null;
  sync_to_housekeeper: boolean;
  checklist_items: string[] | null;
  maintenance_task_times?: Array<{
    room_type_code: string;
    estimated_minutes: number;
  }>;
  is_active: boolean;
  created_at: string;
}

export interface MaintenanceLog {
  id: string;
  room_id: string;
  room_number?: string;
  task_id: string;
  task_name?: string;
  performed_at: string;
  performed_by: string | null;
  stay_count_at_time: number;
  notes: string | null;
}

export interface MaintenanceNote {
  id: string;
  room_id: string;
  task_id: string;
  note: string;
  created_at: string;
  is_resolved: boolean;
  resolved_at: string | null;
}

export interface MaintenanceTaskTime {
  id: string;
  task_id: string;
  room_type_code: string;
  estimated_minutes: number;
}

export interface MaintenanceAssignment {
  id: string;
  room_id: string;
  room_number?: string;
  task_id: string;
  task_name?: string;
  assigned_at: string;
  assigned_by: string | null;
  assigned_date: string;
  status: 'pending' | 'completed' | 'cancelled';
  completed_at: string | null;
  notes: string | null;
}

export interface RoomMaintenanceStatus {
  room_id: string;
  room_number: string;
  room_type_code: string;
  task_id: string;
  task_name: string;
  threshold_count: number;
  warning_count: number | null;
  applicable_room_types: string[] | null;
  total_stays: number;
  last_stay_at: string | null;
  last_done_at: string | null;
  last_done_at_stay: number;
  stays_since_last: number;
  status: 'OK' | 'WARNING' | 'OVERDUE';
  sync_to_housekeeper?: boolean;
  checklist_items?: string[] | null;
}

// ── Phase 10: POS + Inventory ──

export interface Product {
  id: string;
  name: string;
  sku: string | null;
  category: 'amenity' | 'pos' | 'both';
  fulfillment_mode: 'standard' | 'daily_prepare';
  unit: string;
  sale_price: number | null;
  display_order: number;
  is_active: boolean;
  main_stock_quantity?: number;
  created_at: string;
  updated_at: string;
}

export interface MainStock {
  id: string;
  product_id: string;
  product_name?: string;
  quantity: number;
  reorder_level: number;
  updated_at: string;
}

export interface FloorStock {
  id: string;
  floor_number: number;
  product_id: string;
  product_name?: string;
  quantity: number;
  updated_at: string;
}

export interface StockTransaction {
  id: string;
  transaction_date: string;
  product_id: string;
  product_name?: string;
  action: 'use' | 'transfer_out' | 'transfer_in' | 'sale' | 'receive' | 'adjust' | 'return';
  quantity_change: number;
  from_location: string | null;
  to_location: string | null;
  reference_type: string | null;
  reference_id: string | null;
  room_number: string | null;
  floor_number: number | null;
  performed_by: string | null;
  note: string | null;
  created_at: string;
}

export interface PosOrder {
  id: string;
  order_number: string;
  order_type: 'walkin' | 'guest_charge';
  reservation_id: string | null;
  guest_name: string | null;
  status: 'pending' | 'completed' | 'voided';
  subtotal: number;
  total: number;
  payment_method: string | null;
  note: string | null;
  created_by: string | null;
  order_date: string;
  created_at: string;
  updated_at: string;
}

export interface PosOrderItem {
  id: string;
  order_id: string;
  product_id: string;
  product_name: string;
  quantity: number;
  unit_price: number;
  line_total: number;
  created_at: string;
}

// ── Phase 11: Transportation & Transfer ──

export interface BoatCompany {
  id: string;
  name: string;
  contact_phone: string | null;
  contact_line: string | null;
  contact_whatsapp: string | null;
  website: string | null;
  notes: string | null;
  is_active: boolean;
  piers?: BoatPier[];
  created_at: string;
  updated_at: string;
}

export interface BoatPier {
  id: string;
  company_id: string;
  name: string;
  location_note: string | null;
  sort_order: number;
  is_active: boolean;
  created_at?: string;
}

export interface BoatRoute {
  id: string;
  company_id: string;
  company_name?: string;
  departure_pier_id: string | null;
  departure_pier_name?: string;
  origin: string;
  destination: string;
  boat_type: string;
  departure_times: string[];
  duration_minutes: number | null;
  ticket_price: number | null;
  cost_price: number | null;
  includes_pickup: boolean;
  pickup_fee: number | null;
  season_label: string | null;
  notes: string | null;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

export type TransferType = "airport_pickup" | "airport_dropoff" | "hotel_to_anywhere" | "bus_ferry_pickup" | "ticket_only";
export type ServiceMode = "company_pickup" | "hotel_arrange" | "ticket_only" | "driver_only";
export type TransferStatus = "pending" | "confirmed" | "driver_assigned" | "in_progress" | "completed" | "cancelled" | "no_show";
export type PaymentStatus = "unpaid" | "paid_to_hotel" | "paid_to_driver" | "settled";

export interface Driver {
  id: string;
  name: string;
  phone: string | null;
  license_type: string | null;
  company: string | null;
  photo_url: string | null;
  rating_avg: number;
  total_trips: number;
  is_active: boolean;
  notes: string | null;
  created_at: string;
  updated_at: string;
}

export interface Vehicle {
  id: string;
  plate_number: string;
  vehicle_type: string;
  capacity: number;
  color: string | null;
  default_driver_id: string | null;
  default_driver_name?: string;
  is_active: boolean;
  notes: string | null;
  created_at?: string;
  updated_at?: string;
}

export interface Transfer {
  id: string;
  reservation_id: string;
  guest_name: string;
  guest_phone: string | null;
  booking_code?: string;
  room_number?: string;
  transfer_type: TransferType;
  service_mode: ServiceMode;
  pickup_datetime: string;
  pickup_location: string;
  dropoff_location: string;
  pax: number;
  luggage_count: number;
  driver_id: string | null;
  driver_name?: string;
  driver_phone?: string;
  vehicle_id: string | null;
  vehicle_info?: string;
  boat_company_id: string | null;
  boat_company_name?: string;
  boat_route_id: string | null;
  route_description?: string;
  selling_price: number | null;
  cost_price: number | null;
  driver_fee: number | null;
  driver_commission: number;
  net_commission: number | null;
  actual_price: number | null;
  payment_status: PaymentStatus;
  payment_method: string | null;
  status: TransferStatus;
  staff_note: string | null;
  guest_note: string | null;
  voucher_note: string | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
}

export interface DriverRating {
  id: string;
  transfer_id: string;
  driver_id: string;
  driver_name?: string;
  score_punctuality: number;
  score_value: number;
  score_service: number;
  comment: string | null;
  rated_by: string | null;
  created_at: string;
}

export interface TransferNotification {
  id: string;
  transfer_id: string;
  notification_type: string;
  channel: string;
  message: string | null;
  sent_at: string | null;
  status: string;
  created_at: string;
}

export interface TransferVoucher {
  id: string;
  transfer_id: string;
  voucher_number: string;
  guest_name: string;
  route_description: string | null;
  departure_time: string | null;
  pier_name: string | null;
  boat_company_name: string | null;
  pickup_time: string | null;
  pickup_location: string | null;
  driver_name: string | null;
  driver_phone: string | null;
  vehicle_info: string | null;
  special_instructions: string | null;
  printed_at: string | null;
}

// ── Phase 11A: Accounting Backbone ──

// extra_charge covers manual service/damage fees and policy fees (cancel/shorten/early/late)
export type HotelRevenueCategory = "room_revenue" | "pos_revenue" | "extra_charge" | "deposit" | "no_show_fee" | "dayuse_revenue";

export interface TransferTransaction {
  id: string;
  transfer_id: string;
  reservation_id: string | null;
  guest_profile_id: string | null;
  tx_type: "charge" | "refund" | "adjustment";
  amount: number;
  selling_price: number | null;
  cost_price: number | null;
  margin: number | null;
  payment_method: "cash" | "transfer" | "credit_card" | "other" | null;
  cashier_name: string | null;
  note: string | null;
  transaction_date: string;
  created_at: string;
}

export interface CommissionEntry {
  id: string;
  transfer_id: string;
  reservation_id: string | null;
  guest_profile_id: string | null;
  staff_name: string;
  rule_type: "pct_sell" | "pct_margin" | "fixed";
  rule_value: number;
  base_amount: number;
  commission_amount: number;
  status: "pending" | "approved" | "paid" | "reversed";
  payout_cycle: "monthly" | "bimonthly";
  approved_by: string | null;
  approved_at: string | null;
  paid_at: string | null;
  reversal_reason: string | null;
  reversed_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface TipEntry {
  id: string;
  tip_type: "unassigned" | "manual_staff";
  reservation_id: string | null;
  guest_profile_id: string | null;
  transfer_id: string | null;
  amount: number;
  payment_method: "cash" | "transfer" | "credit_card" | "other";
  assigned_to: string | null;
  recorded_by: string | null;
  status: "pending" | "approved" | "paid" | "reversed";
  approved_at: string | null;
  paid_at: string | null;
  reversal_reason: string | null;
  reversed_at: string | null;
  note: string | null;
  created_at: string;
  updated_at: string;
}

// ── Phase 11B: Profile Lifecycle + Duplicate Control ──

export interface GuestProfile {
  id: string;
  member_no: string | null;
  first_name: string | null;
  last_name: string;
  gender: "M" | "F" | "Other" | null;
  nationality: string | null;
  nationality_code: string | null;
  country: string | null;
  province: string | null;
  city: string | null;
  address: string | null;
  address_line1: string | null;
  address_line2: string | null;
  postal_code: string | null;
  id_type: "thai_id" | "passport" | "other" | null;
  id_number: string | null;
  id_card_number: string | null;
  passport_no: string | null;
  dob: string | null;
  phone: string | null;
  email: string | null;
  whatsapp: string | null;
  line_id: string | null;
  car_registration: string | null;
  vip_tier: string | null;
  preferences: string | null;
  notes: string | null;
  blacklisted: boolean;
  profile_status: "draft" | "verified" | "merged" | "blacklisted";
  merged_into: string | null;
  do_not_merge: boolean;
  stay_count: number;
  night_count?: number | null;
  main_stay_count?: number | null;
  main_night_count?: number | null;
  accompanying_stay_count?: number | null;
  accompanying_night_count?: number | null;
  legacy_night_count?: number | null;
  last_stay_date: string | null;
  booking_names?: string[];
  active_primary_reservation_count?: number | null;
  _masked?: boolean;
  _masked_fields?: string[];
  created_at: string;
  updated_at: string;
}

export interface ProfileMatchScore {
  id: string;
  profile_a: string;
  profile_b: string;
  score: number;
  match_fields: Record<string, unknown>;
  status: "pending" | "merged" | "dismissed" | "do_not_merge";
  reviewed_by: string | null;
  reviewed_at: string | null;
  created_at: string;
}

export interface ReservationGuest {
  id: string;
  reservation_id: string;
  guest_profile_id: string;
  role: "primary" | "accompanying";
  display_order: number;
  created_at: string;
}

export interface ReservationGuestWithProfile extends ReservationGuest {
  guest_profile: Pick<
    GuestProfile,
    "id" | "first_name" | "last_name" | "phone" | "nationality_code" | "country" | "profile_status"
  > | null;
}

export interface GuestHistorySummary {
  total_stays: number;
  primary_stay_count: number;
  primary_night_count?: number;
  accompanying_stay_count: number;
  accompanying_night_count?: number;
  legacy_stay_count?: number;
  legacy_night_count?: number;
  total_transfer_spend: number;
  total_tips: number;
}

export interface GuestHistoryStay {
  reservation_id: string;
  booking_code: string | null;
  guest_name: string | null;
  room_number: string | null;
  status: string | null;
  checkin_date: string | null;
  checkout_date: string | null;
  checked_in_at: string | null;
  checked_out_at: string | null;
  source: string | null;
  created_at: string | null;
  total_price: number | null;
  role: "primary" | "accompanying";
  display_order: number;
}

export interface GuestProfileListItem {
  id: string;
  member_no: string | null;
  first_name: string | null;
  last_name: string;
  email: string | null;
  phone: string | null;
  nationality: string | null;
  nationality_code: string | null;
  country: string | null;
  vip_tier: string | null;
  blacklisted: boolean;
  profile_status: GuestProfile["profile_status"] | null;
  stay_count: number;
  last_stay_date: string | null;
  booking_names?: string[];
}

export interface GuestProfileListSummary {
  matched: number;
  verified: number;
  draft: number;
  vip: number;
}

export interface GuestProfileListResponse {
  success: boolean;
  requires_search: boolean;
  profiles: GuestProfileListItem[];
  summary: GuestProfileListSummary;
  total: number;
  page: number;
  page_size: number;
  total_pages: number;
}

export interface GuestStaySummary {
  reservation_id: string;
  booking_code: string | null;
  room_number: string | null;
  role: "primary" | "accompanying";
  status: string | null;
  source: string | null;
  checkin_date: string | null;
  checkout_date: string | null;
  checked_in_at: string | null;
  checked_out_at: string | null;
  room_revenue: number;
  dayuse_revenue: number;
  pos_total: number;
  transfer_total: number;
  tip_total: number;
  deposit_received: number;
  deposit_refunded: number;
  visible_total: number;
}

export interface GuestStaySummaryResponse {
  success: boolean;
  summary: GuestStaySummary;
}

export interface TravelPartyMember {
  guest_profile_id: string;
  full_name: string;
  role: "primary" | "accompanying";
  display_order: number;
  profile_status: GuestProfile["profile_status"] | null;
}

export interface GuestTravelPartyHistoryEntry {
  reservation_id: string;
  booking_code: string | null;
  checkin_date: string | null;
  checkout_date: string | null;
  role: "primary" | "accompanying";
  party: TravelPartyMember[];
}

export interface GuestHistoryResponse {
  success: boolean;
  summary: GuestHistorySummary;
  primary_stays: GuestHistoryStay[];
  accompanying_stays: GuestHistoryStay[];
  travel_party_history: GuestTravelPartyHistoryEntry[];
}

export type CheckinPolicy = {
  first_name: boolean;
  last_name: boolean;
  gender: boolean;
  nationality_code: boolean;
  id_type: boolean;
  id_number: boolean;
  country: boolean;
  province: boolean;
  phone: boolean;
};

// ── Phase 12A: Staff Directory ──

export interface Department {
  id: string;
  code: "FO" | "HK" | "MNT" | "FB" | "SEC";
  name: string;
  line_group_id: string | null;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

export interface Staff {
  id: string;
  employee_code: string;
  display_name: string;
  nickname: string | null;
  department_id: string | null;
  department?: Pick<Department, "id" | "code" | "name"> | null;
  is_active: boolean;
  hk_lane_enabled: boolean;
  hk_lane_order: number;
  line_user_id: string | null;
  line_display_name: string | null;
  line_picture_url: string | null;
  line_bound_at: string | null;
  created_at: string;
  updated_at: string;
}

export type StaffPublic = Pick<
  Staff,
  | "id"
  | "employee_code"
  | "display_name"
  | "nickname"
  | "department_id"
  | "is_active"
  | "hk_lane_enabled"
  | "hk_lane_order"
> & {
  department: Pick<Department, "code" | "name"> | null;
};

export interface LineBindingToken {
  token: string;
  staff_id: string;
  expires_at: string;
  used_at: string | null;
  created_at: string;
}

export type ShiftType = "morning" | "afternoon" | "night" | "off";

export interface StaffShift {
  id: string;
  staff_id: string;
  shift_date: string;
  shift_type: ShiftType;
  started_at: string | null;
  ended_at: string | null;
  is_on_duty: boolean;
  created_at: string;
  staff?: Pick<StaffPublic, "id" | "employee_code" | "display_name" | "nickname"> & {
    department: Pick<Department, "code" | "name"> | null;
  };
}

export interface RosterStaffConfig {
  staff_id: string;
  nickname: string;
  regular_day_off: number; // 0=Sun..6=Sat
  shift_preference: "morning_fixed" | "rotate";
  night_rotation_order: number | null;
  extra_day_offs_per_month: number;
}

export interface GeneratedShiftEntry {
  staff_id: string;
  shift_date: string; // YYYY-MM-DD
  shift_type: "morning" | "afternoon" | "night";
}

export interface RosterGenerateResult {
  shifts: GeneratedShiftEntry[];
  summary: Record<
    string,
    { work: number; off: number; morning: number; afternoon: number; night: number }
  >;
  warnings: string[];
}

// ── Phase 12C: Logbook ──

export type LogbookNoteType = 'general' | 'task' | 'urgent' | 'stock' | 'vip';
export type LogbookPriority = 'low' | 'normal' | 'high' | 'urgent';
export type LogbookStatus = 'open' | 'in_progress' | 'resolved';
export type LogbookBoardMode = 'minimized' | 'middle';
export type LogbookRichTextSize = 's' | 'm' | 'l';

export type LogbookLinkType = 'room' | 'guest' | 'stock' | 'staff';
export type LogbookRoomLinkMode = 'static' | 'dynamic';

export interface LogbookRichBody {
  html: string;
  styles: {
    bold: boolean;
    color: string;
    size: LogbookRichTextSize;
  };
}

export interface LogbookNoteLink {
  id: string;
  note_id: string;
  link_type: LogbookLinkType;
  ref_id: string | null;
  ref_code: string | null;
  room_link_mode?: LogbookRoomLinkMode;
  label: string;
  created_at: string;
}

export type LogbookMentionType = 'staff' | 'group_all' | 'group_frontdesk';

export interface LogbookMention {
  id: string;
  note_id: string;
  mention_type: LogbookMentionType;
  staff_id: string | null;
  is_acknowledged: boolean;
  created_at: string;
  staff?: Pick<StaffPublic, "id" | "display_name">;
}

export interface LogbookNote {
  id: string;
  title: string;
  body: string;
  body_rich: LogbookRichBody | null;
  note_type: LogbookNoteType;
  status: LogbookStatus;
  priority: LogbookPriority;
  x: number;
  y: number;
  width: number;
  height: number;
  z_index: number;
  is_minimized: boolean;
  board_mode: LogbookBoardMode;
  remind_at: string | null;
  archived_at: string | null;
  archived_by: string | null;
  created_by: string;
  created_at: string;
  updated_at: string;

  links?: LogbookNoteLink[];
  mentions?: LogbookMention[];
  author?: Pick<StaffPublic, "id" | "display_name" | "nickname" | "employee_code">;
}

// ── Phase 13: Night Audit + No-Show + Dashboard KPI ──

export interface NoShowPending {
  id: string;
  booking_code: string;
  guest_name: string;
  phone: string | null;
  source: BookingSource;
  checkin_date: string;
  checkout_date: string;
  total_price: number;
  no_show_fee: number | null;
  nights_count: number;
  room_number: string | null;
}

export interface PreCheckResult {
  business_date: string;
  can_run: boolean;
  blockers: PreCheckItem[];
  warnings: PreCheckItem[];
  summary: {
    total_arrivals: number;
    checked_in: number;
    total_departures: number;
    checked_out: number;
    no_shows_resolved: number;
    no_shows_pending: number;
    group_checkin_wizard_drafts_pending?: number;
  };
}

export interface PreCheckItem {
  type: string;
  count: number;
  message: string;
}

export interface NightAuditSnapshot {
  total_revenue: number;
  occupied_nights: number;
  room_nights: number;
  occupancy_pct: number;
  adr: number;
  revpar: number;
  by_source: Record<string, { nights: number; revenue: number; share_pct: number }>;
  payment_total: number;
  payment_cash: number;
  payment_transfer: number;
  payment_card: number;
  payment_other: number;
  transfer_revenue: number;
  transfer_cost: number;
  transfer_margin: number;
  tip_total: number;
  commission_liability: number;
  deposit_received: number;
  deposit_refunded: number;
  pos_revenue: number;
  no_show_count: number;
  no_show_fee_total: number;
}

export interface DashboardKPI {
  business_date: string;
  calendar_date: string;
  needs_eod: boolean;
  live: {
    arrivals: number;
    arrivals_checked_in: number;
    departures: number;
    departures_checked_out: number;
    in_house: number;
    no_show_pending: number;
    dirty_rooms: number;
    sellable_rooms: number;
    occupancy_pct: number;
  };
  revenue: {
    total: number;
    adr: number;
    revpar: number;
    occupied_nights: number;
    by_source: Record<string, { nights: number; revenue: number; pct: number }>;
  };
  payments: {
    total: number;
    cash: number;
    transfer: number;
    credit_card: number;
    other: number;
    deposits_received: number;
    deposits_refunded: number;
  };
  trend: Array<{
    date: string;
    revenue: number;
    occupancy_pct: number;
    adr: number;
    payment_total: number;
  }>;
  extras: {
    transfer_revenue: number;
    transfer_margin: number;
    tip_total: number;
    pos_revenue: number;
    dayuse_revenue: number;
    dayuse_sessions: number;
  };
}

export interface EodStatusResponse {
  success: boolean;
  business_date: string;
  calendar_date: string;
  needs_eod: boolean;
  days_overdue: number;
  eod_reminder_time: string;
  night_audit_popup_snooze_min: number;
}

// ── Phase 14: Day Use ──

export type DayUseTimerState = "green" | "yellow" | "red" | "overdue";

export interface DayUseReservation {
  id: string;
  booking_code: string;
  guest_name: string;
  phone: string | null;
  status: "active" | "checked_out";
  checked_in_at: string;
  dayuse_expires_at: string;
  total_price: number;
  rate: number;
}

export interface DayUseRoomStatus {
  room_id: string;
  room_number: string;
  is_available: boolean;
  current_reservation: DayUseReservation | null;
  hk_status: HousekeepingStatus | null;
  sessions_today: number;
  timer_state: DayUseTimerState | null;
}

export interface DayUseSettings {
  dayuse_rate: number;
  dayuse_duration_min: number;
  dayuse_extend_rate: number;
  dayuse_extend_min: number;
}

// ── Calendar & Room Planner (Phase 43) ─────────────────────────

export type CalendarReservation = {
    reservation_id: string;
    booking_code: string;
    booking_group_id?: string | null;
    parent_reservation_id?: string | null;
    linked_root_id?: string | null;
    linked_reservation_ids?: string[];
    per_night_rooms?: Record<string, string>;
    group_code?: string | null;
    group_name?: string | null;
    guest_name: string;
    phone: string | null;
    source: string;
    status: string;           // 'active' | 'checked_out'
    checked_in_at?: string | null;
    checkin_date: string;
    checkout_date: string;
    total_price: number;
    note: string | null;
    nights: string[];
    alert_count?: number;
    first_alert_message?: string | null;
    alert_severity?: "info" | "warning" | "critical" | null;
    room_type_id: string;
    room_type: string;
    do_not_move?: boolean; // added for Room Planner
    // Computed client-side for linked stay resize guards
    is_linked_first?: boolean;
    is_linked_last?: boolean;
    ghost_nights?: string[];
    solid_nights?: string[];
};

export type CalendarRoom = {
    room_id: string;
    room_type_id: string;
    room_number: string;
    room_type: string;
    room_type_code: string;
    is_sellable: boolean;
    closure_reason: string | null;
    is_dayuse?: boolean;
    hk_status?: string | null; // "dirty" | "in_progress" | "paused" | "approved" | "available" | null
    reservations: CalendarReservation[];
};

export type CalendarRoomBlock = {
    id: string;
    room_id: string;
    block_type: "OOO" | "OOS";
    start_date: string;
    end_date: string;
    reason: string;
};

export type CalendarPlannedMove = {
    id: string;
    reservation_id: string;
    booking_code: string | null;
    guest_name: string | null;
    checkin_date: string | null;
    checkout_date: string | null;
    booking_group_id?: string | null;
    group_code?: string | null;
    group_name?: string | null;
    start_date: string;
    end_date: string;
    from_room_id_snapshot: string | null;
    from_room_number: string | null;
    to_room_id: string;
    to_room_number: string | null;
    to_room_type_id: number;
    move_reason: string | null;
    pricing_policy: string;
    do_not_move: boolean;
    status: string;
};

export type CalendarData = {
    success: boolean;
    start_date: string;
    end_date: string;
    rooms: CalendarRoom[];
    unassigned?: CalendarReservation[];
    blocks?: CalendarRoomBlock[];
    planned_moves?: CalendarPlannedMove[];
};

export type DraftActionType = "MOVE_WHOLE" | "ASSIGN" | "UNASSIGN" | "MOVE_NIGHTS" | "EXTEND" | "SHORTEN";

export type DraftAction = {
    id: string;                    // unique draft action ID
    type: DraftActionType;
    reservation_id: string;
    // MOVE_WHOLE & ASSIGN & MOVE_NIGHTS
    from_room_id?: string;
    to_room_id?: string;
    // MOVE_NIGHTS
    affected_nights?: string[];    // specific nights moved
    // EXTEND / SHORTEN
    new_checkout_date?: string;
    new_checkin_date?: string;     // front-shorten
    // OTA Pricing
    ota_night_overrides?: { stay_date: string; price: number }[];
    // metadata
    created_at: number;            // timestamp for ordering
    swap_pair_id?: string;
};

export type DraftOverride = {
    reservation_id: string;
    type: "ghost" | "solid";
    room_id: string;
    nights?: string[];             // NEW: if present, only these nights are overridden
};

// ── Phase 56: Lost & Found ──────────────────────────────────

export type LostFoundCategory = "general" | "electronics" | "clothing" | "documents" | "valuables" | "other";

/** Display status — 'expired' is virtual (query-time: found_date + 1yr < now) */
export type LostFoundStatus = "pending" | "claimed" | "cleared";

export interface LostFoundItem {
  id: string;
  room_id: string;
  room_number: string;
  reservation_id: string | null;
  guest_profile_id: string | null;
  booking_code: string | null;
  guest_name: string | null;
  checkin_date: string | null;
  checkout_date: string | null;
  description: string;
  photo_path: string | null;
  /** Signed URL for display — populated by API, not stored */
  photo_url?: string | null;
  category: LostFoundCategory;
  status: LostFoundStatus;
  found_date: string;
  found_by: string;
  reported_by_user_id: string | null;
  location_detail: string | null;
  claim_note: string | null;
  claimed_at: string | null;
  claimed_by: string | null;
  cleared_at: string | null;
  cleared_by: string | null;
  /** Virtual — true when found_date + 1 year < today AND status = 'pending' */
  is_expired?: boolean;
  created_at: string;
  updated_at: string;
}

export interface LostFoundGuestAlert {
  guest_profile_id: string;
  guest_name: string | null;
  items: Array<{
    id: string;
    description: string;
    room_number: string;
    booking_code: string | null;
    found_date: string;
    category: LostFoundCategory;
  }>;
}
