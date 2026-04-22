/**
 * Telegram alert types — Phase 72 Layer 0 (Lead-owned)
 *
 * Owner: Lead. Agents must NOT modify this file during Phase 72.
 */

export type TelegramAlertKind =
  | "ota_sync_stale"
  | "rate_floor_violation"
  | "bot_start";

export interface TelegramAlertPayload {
  kind: TelegramAlertKind;
  payload: Record<string, unknown>;
}

export interface TelegramSendResult {
  success: boolean;
  message_id?: number;
  error?: string;
}

export type TelegramSubscriberRole = "admin" | "fo" | "manager";

export interface TelegramSubscription {
  chat_id: number;
  role: TelegramSubscriberRole;
  is_active: boolean;
  created_at: string;
}

/**
 * Subset of Telegram Bot API Update payload — only what our webhook consumes.
 * Full shape: https://core.telegram.org/bots/api#update
 */
export interface TelegramUpdate {
  update_id: number;
  message?: {
    message_id: number;
    from?: { id: number; first_name?: string; username?: string };
    chat: { id: number; type: string };
    date: number;
    text?: string;
  };
}

export interface TelegramWebhookRegisterRequest {
  /** Full https URL Telegram will POST updates to. Must include the secret path component. */
  webhook_url: string;
}

export interface TelegramWebhookRegisterResponse {
  success: boolean;
  error?: string;
}
