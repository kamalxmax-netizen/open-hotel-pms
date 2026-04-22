import { notifyPendingOtaTasks, getOtaAlarmMinutes } from "@/lib/telegram/alerts";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { NextRequest, NextResponse } from "next/server";

export const dynamic = "force-dynamic";

function isAuthorizedCronRequest(request: NextRequest): boolean {
  const bearer = request.headers.get("authorization")?.match(/^Bearer\s+(.+)$/i)?.[1] ?? null;
  const cronSecret = String(process.env.OTA_ALARM_CRON_SECRET ?? process.env.CRON_SECRET ?? "").trim();
  if (cronSecret && bearer === cronSecret) return true;

  const queryToken = String(request.nextUrl.searchParams.get("token") ?? "").trim();
  if (cronSecret && queryToken === cronSecret) return true;

  const cronHeader = request.headers.get("x-vercel-cron");
  if (cronHeader && cronHeader.trim() === "1") return true;

  const userAgent = String(request.headers.get("user-agent") ?? "").toLowerCase();
  return userAgent.includes("vercel-cron");
}

export async function GET(request: NextRequest) {
  try {
    if (!isAuthorizedCronRequest(request)) {
      return NextResponse.json({ success: false, error: "Unauthorized" }, { status: 401 });
    }

    const supabase = createServerSupabaseClient();
    const alarmMinutes = await getOtaAlarmMinutes(supabase);
    const cutoffIso = new Date(Date.now() - alarmMinutes * 60_000).toISOString();

    const { data, error } = await supabase
      .from("ota_rate_sync_tasks")
      .select("id, created_at")
      .eq("status", "pending")
      .lt("created_at", cutoffIso)
      .order("created_at", { ascending: true })
      .limit(500);

    if (error) {
      return NextResponse.json({ success: false, error: error.message }, { status: 500 });
    }

    const staleRows = data ?? [];
    if (staleRows.length === 0) {
      return NextResponse.json({
        success: true,
        alarm_minutes: alarmMinutes,
        overdue_count: 0,
        notified: false,
      });
    }

    const oldestCreatedAt = String((staleRows[0] as any).created_at ?? "");
    const oldestMinutes = Math.max(0, Math.floor((Date.now() - new Date(oldestCreatedAt).getTime()) / 60000));
    const notifyResult = await notifyPendingOtaTasks({
      supabase,
      count: staleRows.length,
      oldestMinutes,
    });

    return NextResponse.json({
      success: notifyResult.success,
      alarm_minutes: alarmMinutes,
      overdue_count: staleRows.length,
      oldest_pending_minutes: oldestMinutes,
      notified: notifyResult.success,
      message_id: notifyResult.message_id,
      error: notifyResult.error,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Internal server error";
    return NextResponse.json({ success: false, error: message }, { status: 500 });
  }
}
