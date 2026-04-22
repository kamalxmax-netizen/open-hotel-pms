/**
 * OTA Sync types — Phase 72 Layer 0 (Lead-owned)
 *
 * Owner: Lead. Agents must NOT modify this file during Phase 72.
 */

export type OtaChannelCode = "BOOKING";
// Future: | "AGODA" | "EXPEDIA" (schema-ready but inactive in Phase 72)

export type OtaMarkupType = "none" | "percent" | "fixed";

export type OtaSyncMethod = "manual" | "api";

export interface OtaChannel {
  code: OtaChannelCode;
  name_en: string;
  markup_type: OtaMarkupType;
  markup_value: number;
  is_active: boolean;
  sync_method: OtaSyncMethod;
}

export type OtaSyncTaskStatus =
  | "pending"
  | "synced"
  | "superseded"
  | "skipped";

export interface OtaMarkupSnapshot {
  type: OtaMarkupType;
  value: number;
}

export interface OtaSyncTask {
  id: string;
  channel_code: OtaChannelCode;
  room_type_id: string;
  /** Joined at read time — not stored in ota_rate_sync_tasks */
  room_type_name?: string;
  stay_date: string;
  old_price: number | null;
  new_price: number;
  calculated_ota_price: number;
  markup_snapshot: OtaMarkupSnapshot;
  status: OtaSyncTaskStatus;
  superseded_by: string | null;
  reason: string | null;
  created_at: string;
  /** NULL when task was inserted by a DB trigger (no session actor). */
  created_by: string | null;
  acked_at: string | null;
  /** NOT NULL when status ∈ {"synced","skipped"} — enforced at API layer. */
  acked_by: string | null;
  staff_note: string | null;
}

/* ─── API request/response shapes ───────────────────────────────── */

export interface OtaSyncListQuery {
  channel_code?: OtaChannelCode;
  status?: OtaSyncTaskStatus | "all";
  from_date?: string;
  to_date?: string;
}

export interface OtaSyncListResponse {
  success: boolean;
  tasks: OtaSyncTask[];
  total_pending: number;
  oldest_pending_minutes: number | null;
}

export interface OtaSyncAckRequest {
  task_id: string;
  action: "synced" | "skipped";
  staff_note?: string;
}

export interface OtaSyncAckResponse {
  success: boolean;
  error?: string;
  task?: OtaSyncTask;
}
