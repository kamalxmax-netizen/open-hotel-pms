/**
 * Rate Grid types — Phase 72 Layer 0 (Lead-owned)
 *
 * Owner: Lead. Agents must NOT modify this file during Phase 72.
 * If a type change is required, raise to Lead and Lead edits here before
 * re-dispatching work.
 */

/* ─── Existing shape (preserved from /api/rates) ────────────────── */

export type RoomRow = {
  room_id: string;
  room_number: string;
  rates: Record<string, number | null>; // date → price
};

export type RoomTypeGroup = {
  type_id: string;
  type_name: string;
  type_code: string;
  rooms: RoomRow[];
};

/* ─── Phase 72 additions ────────────────────────────────────────── */

export type OccupancyTier = "low" | "normal" | "high" | "peak";

export interface RoomTypeOcc {
  booked: number;
  total: number;
  pct: number; // 0..100
  tier: OccupancyTier;
}

export interface OccupancyBlock {
  per_room_type: Record<string, Record<string, RoomTypeOcc>>; // type_id → date → occ
  hotel_wide: Record<string, RoomTypeOcc>;                     // date → occ
}

export interface RateGridResponseV2 {
  success: boolean;
  start_date: string;
  end_date: string;
  days: string[];
  room_types: RoomTypeGroup[];
  occupancy: OccupancyBlock;
}

/* ─── Rate edit request/response ────────────────────────────────── */

export type RateEditMode = "room" | "type";

export interface RateSingleEditRequest {
  /** Required when mode === "room" */
  room_id?: string;
  /** Required when mode === "type" */
  room_type_id?: string;
  date: string;
  price: number;
  /** Default: "room" (backward-compat with Phase ≤71 callers) */
  mode?: RateEditMode;
  /** 60s TTL token from /api/admin/verify-pin — required to bypass min_rate_floor */
  override_token?: string;
}

export interface RateSingleEditResponse {
  success: boolean;
  error?: string;
  /** true when edit was blocked because price < room_type.min_rate_floor */
  floor_violation?: boolean;
  /** Included when floor_violation=true */
  floor?: number;
  /** room_ids actually updated (multiple when mode='type') */
  updated_room_ids?: string[];
}

/* ─── Admin settings ────────────────────────────────────────────── */

export interface AdminRateSettings {
  min_rate_floor: Record<string, number | null>; // room_type_id → floor
  price_delta_warn_threshold: number;             // 0.20 = 20%
  alarm_minutes: number;
}

export interface AdminSettingsPutRequest {
  key:
    | "rate.price_delta_warn_threshold"
    | "ota.alarm_minutes"
    | "telegram.admin_chat_id"
    | `room_type.${string}.min_rate_floor`;
  value: unknown;
}

/* ─── OCC tier helper (used by both UI heatmap and backend tagging) ─ */

export function occTier(pct: number): OccupancyTier {
  if (pct < 30) return "low";
  if (pct < 60) return "normal";
  if (pct < 85) return "high";
  return "peak";
}
