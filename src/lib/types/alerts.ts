// Phase 74 — Notification & Alarm System
// Canonical types. All Phase 74 code imports from this file.
// See WORK_ASSIGNMENT_PHASE74.md §3 + Amendment #1 for contract details.

export type AlertRuleTrigger = 'all_year' | 'date_range';
export type AlertRuleScope = 'all' | 'individual' | 'group';
export type AlertType = 'prepayment' | 'custom';

export type AlertStatus =
  | 'pending'
  | 'snoozed'
  | 'cleared_auto'
  | 'cleared_manual'
  | 'cleared_admin_override'
  | 'auto_cancelled_due_in';

export type BookingAlarmStatus =
  | 'active'
  | 'completed'
  | 'deleted'
  | 'auto_cancelled_due_in';

export interface AlertRule {
  id: string;
  name: string;
  is_active: boolean;
  trigger_mode: AlertRuleTrigger;
  date_start: string | null;
  date_end: string | null;
  occ_threshold: number;
  scope: AlertRuleScope;
  created_at: string;
  created_by: string | null;
  updated_at: string;
}

export interface AlertRuleInput {
  name: string;
  is_active: boolean;
  trigger_mode: AlertRuleTrigger;
  date_start: string | null;
  date_end: string | null;
  occ_threshold: number;
  scope: AlertRuleScope;
}

export interface BookingAlarm {
  id: string;
  reservation_id: string;
  alarm_date: string;
  note: string;
  status: BookingAlarmStatus;
  created_at: string;
  created_by: string | null;
  completed_at: string | null;
  completed_by: string | null;
  completion_note: string | null;
  deleted_at: string | null;
  deleted_by: string | null;
}

export interface BookingAlarmInput {
  reservation_id: string;
  alarm_date: string;
  note: string;
}

export interface AlertDailyStateRow {
  id: string;
  alert_date: string;
  reservation_id: string;
  alert_type: AlertType;
  source_id: string;
  status: AlertStatus;
  snoozed_from: string | null;
  snooze_note: string | null;
  cleared_at: string | null;
  cleared_by: string | null;
  clear_note: string | null;
  created_at: string;
}

export interface AlertJobLog {
  id: string;
  job_date: string;
  total_alerts: number;
  cleared_count: number;
  snoozed_count: number;
  finished_at: string;
  finished_by: string | null;
  telegram_sent_at: string | null;
  telegram_message: string | null;
  telegram_error: string | null;
  audit_trail: Array<{
    ts: string;
    action: string;
    by: string;
    note?: string;
  }>;
}

export interface AlertSettings {
  start_time: string;
  snooze_minutes: number;
  prepayment_lead_days: number;
}

export interface AlertItemBooking {
  id: string;
  booking_code: string | null;
  guest_name: string;
  has_phone: boolean;
  channel: string | null;
  nationality: string | null;
  is_thai: boolean;
  check_in_date: string;
  nights: number;
  total_amount: number;
  total_paid: number;
  room_label: string | null;
  booking_group_id: string | null;
}

export interface AlertItem {
  daily_state_id: string;
  alert_type: AlertType;
  status: AlertStatus;
  booking: AlertItemBooking;
  note: string | null;
  snoozed_from: string | null;
  cleared_at: string | null;
  cleared_by: string | null;
  clear_note: string | null;
}

export interface AlertsSummary {
  date: string;
  business_date: string;
  calendar_date: string;
  total: number;
  cleared: number;
  pending_prepayment: number;
  pending_custom: number;
  ready_to_finish: boolean;
  is_finished: boolean;
  finished_at: string | null;
  finished_by: string | null;
}

export interface AlertsTodayResponse {
  summary: AlertsSummary;
  items: AlertItem[];
}

export interface AlertsRangeDay {
  date: string;
  prepayment_count: number;
  custom_count: number;
  total: number;
}

export interface AlertsRangeResponse {
  from: string;
  to: string;
  days: AlertsRangeDay[];
}

export interface AlertRuleOverlapResult {
  ok: boolean;
  conflicts: Array<{ id: string; name: string; date_start: string | null; date_end: string | null }>;
}

export interface NightAuditAlertCheckResponse {
  business_date: string;
  pending: number;
  items: AlertItem[];
}
