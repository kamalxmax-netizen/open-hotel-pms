import { finishAlertJob, getBusinessDateContext, requireAlertsReadAccess, updateAlertJobTelegramStatus } from "@/lib/alerts/service";
import { sendAlertJobFinished } from "@/lib/telegram/alerts";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

export const dynamic = "force-dynamic";
export const fetchCache = "force-no-store";

const schema = z.object({
  date: z.string().date().optional(),
});

export async function POST(request: NextRequest) {
  const auth = await requireAlertsReadAccess(request);
  if (!auth.ok) {
    return NextResponse.json({ success: false, error: auth.error }, { status: auth.error === "Unauthorized." ? 401 : 403 });
  }

  const parsed = schema.safeParse(await request.json().catch(() => ({})));
  if (!parsed.success) {
    return NextResponse.json({ success: false, error: "Invalid payload.", details: parsed.error.flatten() }, { status: 400 });
  }

  try {
    const context = await getBusinessDateContext(auth.supabase);
    const businessDate = parsed.data.date ?? context.businessDate;
    const summary = await finishAlertJob(auth.supabase, auth.actor.userId, businessDate);

    const telegramResult = await sendAlertJobFinished({
      supabase: auth.supabase,
      summary,
    });

    const jobLogId = String((summary as any).job_log_id ?? "").trim();
    if (jobLogId) {
      await updateAlertJobTelegramStatus({
        supabase: auth.supabase,
        jobLogId,
        messageText: telegramResult.messageText ?? null,
        sentAt: telegramResult.success ? new Date().toISOString() : null,
        errorText: telegramResult.success ? null : telegramResult.error ?? "Failed to send Telegram alert.",
      });
    }

    return NextResponse.json({
      success: true,
      summary,
      telegram: {
        success: telegramResult.success,
        error: telegramResult.error ?? null,
      },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unexpected error.";
    return NextResponse.json(
      { success: false, error: message },
      { status: message.includes("pending alerts remain") || message.includes("already finished") ? 409 : 400 }
    );
  }
}
