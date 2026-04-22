import type {
  TelegramSendResult,
  TelegramWebhookRegisterResponse,
} from "@/lib/telegram/types";

type TelegramRequestResult<T> = {
  ok: boolean;
  result?: T;
  description?: string;
};

type SendMessageParams = {
  chat_id: number | string;
  text: string;
  parse_mode?: "Markdown" | "MarkdownV2" | "HTML";
};

function getTelegramBotToken() {
  const token = String(process.env.TELEGRAM_BOT_TOKEN ?? "").trim();
  if (!token) {
    throw new Error("TELEGRAM_BOT_TOKEN is not configured.");
  }
  return token;
}

function getTelegramApiUrl(method: string) {
  return `https://api.telegram.org/bot${getTelegramBotToken()}/${method}`;
}

async function telegramRequest<T>(method: string, body: Record<string, unknown>) {
  const response = await fetch(getTelegramApiUrl(method), {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });

  const text = await response.text();
  let payload: TelegramRequestResult<T> | null = null;
  try {
    payload = text ? (JSON.parse(text) as TelegramRequestResult<T>) : null;
  } catch {
    payload = null;
  }

  if (!response.ok) {
    throw new Error(payload?.description || text || `Telegram API ${method} failed with ${response.status}.`);
  }

  if (!payload?.ok) {
    throw new Error(payload?.description || `Telegram API ${method} returned an error.`);
  }

  return payload.result as T;
}

export async function sendTelegramMessage(params: SendMessageParams): Promise<TelegramSendResult> {
  try {
    const result = await telegramRequest<{ message_id?: number }>("sendMessage", params);
    return {
      success: true,
      message_id: Number(result?.message_id ?? 0) || undefined,
    };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : "Failed to send Telegram message.",
    };
  }
}

export async function setTelegramWebhook(params: {
  url: string;
  secret_token?: string;
}): Promise<TelegramWebhookRegisterResponse> {
  try {
    await telegramRequest("setWebhook", {
      url: params.url,
      secret_token: params.secret_token,
      drop_pending_updates: false,
    });
    return { success: true };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : "Failed to register Telegram webhook.",
    };
  }
}
