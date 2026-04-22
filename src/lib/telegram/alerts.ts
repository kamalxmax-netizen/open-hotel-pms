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
  const supabase = params.supabase ?? createServerSupabaseClient();
  const chatId = await getTelegramAdminChatId(supabase);
  if (!chatId) {
    return { success: false, error: "telegram.admin_chat_id is not configured." };
  }

  const text = [
    "OTA sync alert",
    "",
    `${params.count} pending OTA sync task${params.count === 1 ? "" : "s"} are overdue.`,
    `Oldest pending task: ${params.oldestMinutes} minute${params.oldestMinutes === 1 ? "" : "s"}.`,
  ].join("\n");

  return sendTelegramMessage({
    chat_id: chatId,
    text,
  });
}
