/**
 * Dynamic Rate Rules Engine — Phase 73 Layer 0 (Lead-owned)
 *
 * Owner: Lead. Agents must NOT modify this file during Phase 73.
 * If a type change is required, raise to Lead and Lead edits here before
 * re-dispatching work.
 *
 * Carries forward Phase 72 conventions:
 *   - room_type_id serialized as string at API boundary (DB is bigint;
 *     RPC casts via ::text).
 *   - Money as number (THB, NUMERIC(10,2) at DB).
 *   - Dates as ISO "YYYY-MM-DD" strings.
 */

/* ─── Rule model ─────────────────────────────────────────────────── */

export type RuleTriggerScope =
  | "hotel_wide"
  | "group_aggregate"
  | "per_room_type";

export type RuleMode = "suggest_only" | "auto_apply";

export type RuleActionType =
  | "percent"
  | "fixed_thb"
  | "step"
  | "override";

export type RoundingMode =
  | "none"
  | "nearest_10"
  | "nearest_50"
  | "nearest_100";

export type RuleTriggerMetric = "occ_percent" | "occ_rooms_booked";

export interface RateRuleGroup {
  id: string;
  name: string;
  priority: number;
  trigger_scope: RuleTriggerScope;
  mode: RuleMode;
  is_active: boolean;
  effective_from: string | null;
  effective_to: string | null;
  applies_to_dow: number[] | null;
  members: RateRuleGroupMember[];
  tiers: RateRuleTier[];
  created_at?: string;
  updated_at?: string;
}

export interface RateRuleGroupMember {
  room_type_id: string;
  /** Joined at read time; not persisted in rate_rule_group_members. */
  room_type_name?: string;
  action_type: RuleActionType;
  action_value: number;
  rounding: RoundingMode;
}

export interface RateRuleTier {
  id: string;
  trigger_metric: RuleTriggerMetric;
  trigger_threshold: number;
  tier_order: number;
}

/* ─── Preview (suggestion queue) row ─────────────────────────────── */

export type PreviewDirection = "up" | "down" | "same";

export type PreviewStatus =
  | "suggested"
  | "applied"
  | "rejected"
  | "superseded"
  | "expired";

export interface DynamicPreviewRow {
  id: string;
  stay_date: string;
  room_type_id: string;
  room_type_name?: string;
  base_price: number;
  suggested_price: number;
  /** suggested - base */
  delta_thb: number;
  /** (suggested - base) / base — fraction, not percent */
  delta_pct: number;
  direction: PreviewDirection;
  /** true when direction='down' (forced into queue regardless of rule.mode) */
  requires_confirmation: boolean;
  clamped_to_floor: boolean;
  clamped_to_max: boolean;
  /** true when rule.mode='auto_apply' but direction='down' forced to queue (B12) */
  direction_override: boolean;
  applied_rule_group_id: string;
  applied_rule_group_name?: string;
  applied_tier_id: string;
  status: PreviewStatus;
  /** superseded_by points to row of higher-priority group in same eval_run (B21) */
  superseded_by: string | null;
  eval_run_id: string;
  created_at: string;
  actioned_at: string | null;
  actioned_by: string | null;
  reject_reason: string | null;
}

/* ─── Applied log row (for 1-hour undo) ──────────────────────────── */

export type ApplyMethod = "auto" | "confirmed" | "manual_run";

export type UndoDivergenceReason =
  | "none"
  | "price_changed"
  | "window_expired"
  | "already_undone";

export interface AppliedLogRow {
  id: string;
  preview_id: string | null;
  stay_date: string;
  room_type_id: string;
  room_type_name?: string;
  previous_price: number;
  new_price: number;
  applied_at: string;
  /** NULL when auto-applied by scheduler (no session actor). */
  applied_by: string | null;
  apply_method: ApplyMethod;
  reversible_until: string;
  undone_at: string | null;
  undone_by: string | null;
  affected_room_ids: string[];
  affected_room_count: number;
  /**
   * Server-computed. True when:
   *   - undone_at IS NULL, AND
   *   - now() < reversible_until, AND
   *   - current rate_templates.price == new_price for ALL affected_room_ids
   */
  is_undoable: boolean;
  /** Populated only when is_undoable=false — explains why. */
  divergence_reason: UndoDivergenceReason;
  /** Present when divergence_reason='price_changed'. */
  current_prices?: Record<string, number>;
}

/* ─── Evaluator API shapes ───────────────────────────────────────── */

export interface EvaluateRequest {
  start_date: string;
  end_date: string;
}

export interface EvaluateStats {
  evaluated_dates: number;
  groups_fired: number;
  suggestions: number;
  applied: number;
  /** B22: rows that reduced to base after rounding+clamp and were skipped. */
  no_op_count: number;
  clamped_floor: number;
  clamped_max: number;
}

export interface EvaluateResponse {
  success: boolean;
  error?: string;
  eval_run_id?: string;
  stats?: EvaluateStats;
}

/* ─── Simulation (dry-run — never writes) ─────────────────────────── */

export interface SimulationRequest {
  stay_date: string;
  /** When provided: sandbox mode for this one group only.
   *  When omitted: full-system dry-run (all active groups, priority rules). */
  group_id?: string;
}

export interface ProjectedRow {
  room_type_id: string;
  room_type_name?: string;
  base_price: number;
  projected_price: number;
  delta_thb: number;
  delta_pct: number;
  direction: PreviewDirection;
  requires_confirmation: boolean;
  clamped_to_floor: boolean;
  clamped_to_max: boolean;
  direction_override: boolean;
  /** Which group would win for this (type, date). */
  applied_rule_group_id: string;
  applied_rule_group_name?: string;
  applied_tier_id: string;
  /** In full-system mode: other groups that also fired but lost on priority. */
  superseded_group_ids?: string[];
}

export interface SimulationResponse {
  success: boolean;
  error?: string;
  scope: "all_groups" | "single_group";
  group_id?: string;
  stay_date: string;
  projected_rows: ProjectedRow[];
}

/* ─── Bulk actions on preview queue ──────────────────────────────── */

export interface BulkActionRequest {
  preview_ids: string[];
  action: "approve" | "reject";
  reject_reason?: string;
}

export interface BulkActionResponse {
  success: boolean;
  error?: string;
  approved_count?: number;
  rejected_count?: number;
  /** IDs that failed validation (e.g. already actioned, stale). */
  failed_ids?: string[];
}

/* ─── Undo ───────────────────────────────────────────────────────── */

export interface UndoRequest {
  applied_log_id: string;
}

export type UndoErrorCode =
  | "DIVERGED"       // current price(s) != applied_log.new_price
  | "WINDOW_EXPIRED" // now() >= reversible_until
  | "ALREADY_UNDONE"
  | "NOT_FOUND";

export interface UndoResponse {
  success: boolean;
  error_code?: UndoErrorCode;
  error?: string;
  /** Present on DIVERGED: map of room_id → current price. */
  current_prices?: Record<string, number>;
  /** Present on DIVERGED: expected price from applied_log. */
  expected_price?: number;
}

/* ─── Impact summary (UI pre-confirm modal) ──────────────────────── */

export interface SuggestionImpactSummary {
  total_rows: number;
  price_up_rows: number;
  price_down_rows: number;
  /** Sum across rows of (delta_thb × affected_room_nights). */
  estimated_revenue_delta_thb: number;
  distinct_dates: number;
  distinct_room_types: number;
  clamped_floor_count: number;
  clamped_max_count: number;
  /** Estimate of ota_rate_sync_tasks rows that will be generated by Phase 72
   *  trigger when these approvals flow through. */
  ota_sync_tasks_that_will_generate: number;
}

/* ─── App settings keys added in Phase 73 ────────────────────────── */

export type Phase73SettingKey =
  | "rate.dynamic_max_multiplier"
  | "rate.dynamic_eval_window_days"
  | "rate.dynamic_undo_window_minutes"
  | "rate.dynamic_suggestion_stale_minutes";

export interface DynamicEngineSettings {
  dynamic_max_multiplier: number;       // default 1.5
  dynamic_eval_window_days: number;     // default 60
  dynamic_undo_window_minutes: number;  // default 60
  dynamic_suggestion_stale_minutes: number; // default 120
}
