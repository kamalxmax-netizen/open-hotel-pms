import { createServerSupabaseClient } from "@/lib/supabase/server";
import { sendTelegramMessage } from "@/lib/telegram/client";
import type { TelegramSendResult } from "@/lib/telegram/types";
import type { SupabaseClient } from "@supabase/supabase-js";

function toNumber(value: unknown, fallback: number) {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim()) {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return fallback;
}

async function readAppSetting(supabase: SupabaseClient, key: string) {
  const { data, error } = await supabase
    .from("app_settings")
    .select("value_json")
    .eq("key", key)
    .maybeSingle();

  if (error) throw new Error(error.message);
  return (data as any)?.value_json;
}

export async function getOtaAlarmMinutes(supabase: SupabaseClient) {
  return toNumber(await readAppSetting(supabase, "ota.alarm_minutes"), 120);
}

export async function getDynamicSuggestionStaleMinutes(supabase: SupabaseClient) {
  return toNumber(await readAppSetting(supabase, "rate.dynamic_suggestion_stale_minutes"), 120);
}

export async function getTelegramAdminChatId(supabase: SupabaseClient) {
  const dbValue = await readAppSetting(supabase, "telegram.admin_chat_id");
  const normalized = String(dbValue ?? "").trim();
  if (normalized) return normalized;

  const envValue = String(process.env.TELEGRAM_ADMIN_CHAT_ID ?? "").trim();
  return envValue || null;
}

export async function notifyPendingOtaTasks(params: {
  count: number;
  oldestMinutes: number;
  supabase?: SupabaseClient;
}): Promise<TelegramSendResult> {
  return notifyRateSystemAlerts({
    supabase: params.supabase,
    ota: {
      count: params.count,
      oldestMinutes: params.oldestMinutes,
    },
  });
}

function formatMinutesLabel(totalMinutes: number) {
  const safeMinutes = Math.max(0, Math.floor(totalMinutes));
  if (safeMinutes < 60) return `${safeMinutes}m`;
  const hours = Math.floor(safeMinutes / 60);
  const minutes = safeMinutes % 60;
  return `${hours}h ${minutes}m`;
}

export async function notifyRateSystemAlerts(params: {
  ota?: {
    count: number;
    oldestMinutes: number;
  };
  suggestions?: {
    count: number;
    oldestMinutes: number;
  };
  supabase?: SupabaseClient;
}): Promise<TelegramSendResult> {
  const supabase = params.supabase ?? createServerSupabaseClient();
  const chatId = await getTelegramAdminChatId(supabase);
  if (!chatId) {
    return { success: false, error: "telegram.admin_chat_id is not configured." };
  }

  const sections: string[] = [];
  if (params.ota && params.ota.count > 0) {
    sections.push(
      "📤 OTA Sync (Booking.com)",
      `  ${params.ota.count} task${params.ota.count === 1 ? "" : "s"} pending · oldest ${formatMinutesLabel(params.ota.oldestMinutes)}`
    );
  }
  if (params.suggestions && params.suggestions.count > 0) {
    sections.push(
      "🎯 Dynamic Suggestions",
      `  ${params.suggestions.count} pending · oldest ${formatMinutesLabel(params.suggestions.oldestMinutes)}`
    );
  }

  if (sections.length === 0) {
    return { success: true };
  }

  const text = [
    "🔔 Rate System Alerts",
    ...sections,
    "",
    "→ Open PMS: /pms/ota-sync · /pms/rates/suggestions",
  ].join("\n");

  return sendTelegramMessage({
    chat_id: chatId,
    text,
  });
}

type AlertJobFinishedSummary = {
  job_date?: string;
  total?: number;
  cleared?: number;
  snoozed?: number;
  prepayment?: {
    paid?: number;
    snoozed?: number;
    admin_override?: number;
  };
  custom?: {
    done?: number;
    snoozed?: number;
  };
};

export async function sendAlertJobFinished(params: {
  summary: AlertJobFinishedSummary;
  supabase?: SupabaseClient;
}): Promise<TelegramSendResult & { messageText?: string | null }> {
  const supabase = params.supabase ?? createServerSupabaseClient();
  const chatId = await getTelegramAdminChatId(supabase);
  if (!chatId) {
    return { success: false, error: "telegram.admin_chat_id is not configured.", messageText: null };
  }

  const summary = params.summary ?? {};
  const text = [
    "✅ Finish Alarm Job",
    `Date: ${String(summary.job_date ?? "-")}`,
    `Total: ${toNumber(summary.total, 0)}`,
    `Cleared: ${toNumber(summary.cleared, 0)}`,
    `Snoozed: ${toNumber(summary.snoozed, 0)}`,
    "",
    "💰 Pre-payment",
    `  Paid: ${toNumber(summary.prepayment?.paid, 0)}`,
    `  Snoozed: ${toNumber(summary.prepayment?.snoozed, 0)}`,
    `  Admin override: ${toNumber(summary.prepayment?.admin_override, 0)}`,
    "",
    "⏰ Custom",
    `  Done: ${toNumber(summary.custom?.done, 0)}`,
    `  Snoozed: ${toNumber(summary.custom?.snoozed, 0)}`,
    "",
    "→ Open PMS: /pms/alerts",
  ].join("\n");

  const result = await sendTelegramMessage({
    chat_id: chatId,
    text,
  });

  return { ...result, messageText: text };
}
