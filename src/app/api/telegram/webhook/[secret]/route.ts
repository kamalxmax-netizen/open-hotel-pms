import { createServerSupabaseClient } from "@/lib/supabase/server";
import { sendTelegramMessage } from "@/lib/telegram/client";
import type { TelegramUpdate } from "@/lib/telegram/types";
import { NextRequest, NextResponse } from "next/server";

export const dynamic = "force-dynamic";
export const fetchCache = "force-no-store";

function isValidWebhookSecret(request: NextRequest, secret: string) {
  const configured = String(process.env.TELEGRAM_WEBHOOK_SECRET ?? "").trim();
  if (!configured || secret !== configured) return false;

  const header = String(request.headers.get("x-telegram-bot-api-secret-token") ?? "").trim();
  return header === configured;
}

export async function POST(
  request: NextRequest,
  context: { params: Promise<{ secret: string }> }
) {
  const { secret } = await context.params;
  if (!isValidWebhookSecret(request, secret)) {
    return NextResponse.json({ success: false, error: "Unauthorized." }, { status: 401 });
  }

  const supabase = createServerSupabaseClient();
  const payload = (await request.json().catch(() => null)) as TelegramUpdate | null;
  if (!payload?.update_id) {
    return NextResponse.json({ success: false, error: "Invalid Telegram payload." }, { status: 400 });
  }

  const { error: insertError } = await supabase.from("telegram_webhook_events").insert({
    update_id: payload.update_id,
    raw_payload: payload,
  });

  if (insertError && insertError.code !== "23505") {
    return NextResponse.json({ success: false, error: insertError.message }, { status: 500 });
  }

  const text = String(payload.message?.text ?? "").trim();
  const chatId = payload.message?.chat?.id;
  if (text.startsWith("/start") && chatId != null) {
    await sendTelegramMessage({
      chat_id: chatId,
      text: `Your chat_id is ${chatId}.\nPaste it into Admin Settings to enable OTA alerts.`,
    });
  }

  return NextResponse.json({ success: true });
}
