import { requireAdminRouteAccess } from "@/lib/guest-migration";
import { setTelegramWebhook } from "@/lib/telegram/client";
import type { TelegramWebhookRegisterRequest } from "@/lib/telegram/types";
import { NextRequest, NextResponse } from "next/server";

export const dynamic = "force-dynamic";
export const fetchCache = "force-no-store";

export async function POST(request: NextRequest) {
  const auth = await requireAdminRouteAccess(request);
  if (!auth.ok) return auth.response;

  const secret = String(process.env.TELEGRAM_WEBHOOK_SECRET ?? "").trim();
  if (!secret) {
    return NextResponse.json({ success: false, error: "TELEGRAM_WEBHOOK_SECRET is not configured." }, { status: 500 });
  }

  const body = (await request.json().catch(() => null)) as TelegramWebhookRegisterRequest | null;
  const webhookUrl =
    String(body?.webhook_url ?? "").trim() ||
    `${request.nextUrl.origin}/api/telegram/webhook/${secret}`;

  if (!/^https:\/\//i.test(webhookUrl)) {
    return NextResponse.json({ success: false, error: "Telegram webhook URL must be HTTPS." }, { status: 400 });
  }

  const result = await setTelegramWebhook({
    url: webhookUrl,
    secret_token: secret,
  });

  if (!result.success) {
    return NextResponse.json(result, { status: 502 });
  }

  return NextResponse.json({
    success: true,
    webhook_url: webhookUrl,
  });
}
