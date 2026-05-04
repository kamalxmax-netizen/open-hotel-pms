import { HttpError } from "@/lib/logbook-api";
import { assertShiftLogDate, assertShiftLogHour, upsertShiftLogEntry } from "@/lib/shift-log-api";
import { requireStaffAuth } from "@/lib/server-auth";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

export const dynamic = "force-dynamic";
export const fetchCache = "force-no-store";

const paramsSchema = z.object({
  date: z.string(),
  hour: z.string(),
});

const bodySchema = z.object({
  body: z.string().max(10000),
  body_rich: z.record(z.string(), z.any()).nullable().optional(),
});

export async function PATCH(
  request: NextRequest,
  context: { params: { date: string; hour: string } }
) {
  try {
    const supabase = createServerSupabaseClient();
    const auth = await requireStaffAuth(supabase, request);
    if (auth.error) return auth.error;

    const params = paramsSchema.safeParse(context.params);
    if (!params.success) {
      return NextResponse.json(
        { success: false, error: "Invalid params.", details: params.error.flatten() },
        { status: 400 }
      );
    }

    const json = await request.json().catch(() => null);
    const parsed = bodySchema.safeParse(json);
    if (!parsed.success) {
      return NextResponse.json(
        { success: false, error: "Invalid payload.", details: parsed.error.flatten() },
        { status: 400 }
      );
    }

    const entry = await upsertShiftLogEntry(supabase, {
      userId: auth.user.id,
      logDate: assertShiftLogDate(params.data.date),
      hourSlot: assertShiftLogHour(params.data.hour),
      body: parsed.data.body,
      body_rich: parsed.data.body_rich ?? null,
    });

    return NextResponse.json({ success: true, data: entry });
  } catch (err) {
    if (err instanceof HttpError) {
      return NextResponse.json({ success: false, error: err.message }, { status: err.status });
    }
    console.error("api/shift-log/[date]/[hour] PATCH failed", err);
    const message = err instanceof Error ? err.message : "Internal server error";
    return NextResponse.json({ success: false, error: message }, { status: 500 });
  }
}
