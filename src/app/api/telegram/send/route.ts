import { requireAdminRouteAccess } from "@/lib/guest-migration";
import { sendTelegramMessage } from "@/lib/telegram/client";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

export const dynamic = "force-dynamic";
export const fetchCache = "force-no-store";

const bodySchema = z.object({
  chat_id: z.union([z.string().trim().min(1), z.number().int()]),
  text: z.string().trim().min(1).max(4000),
  parse_mode: z.enum(["Markdown", "MarkdownV2", "HTML"]).optional(),
});

export async function POST(request: NextRequest) {
  const auth = await requireAdminRouteAccess(request);
  if (!auth.ok) return auth.response;

  const parsed = bodySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json(
      { success: false, error: "Invalid payload.", details: parsed.error.flatten() },
      { status: 400 }
    );
  }

  const result = await sendTelegramMessage({
    chat_id: parsed.data.chat_id,
    text: parsed.data.text,
    parse_mode: parsed.data.parse_mode,
  });

  if (!result.success) {
    return NextResponse.json(result, { status: 502 });
  }

  return NextResponse.json(result);
}
