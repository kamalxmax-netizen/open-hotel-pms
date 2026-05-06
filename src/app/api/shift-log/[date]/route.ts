import { HttpError } from "@/lib/logbook-api";
import { assertShiftLogDate, listShiftLogEntries } from "@/lib/shift-log-api";
import { requireStaffAuth } from "@/lib/server-auth";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

export const dynamic = "force-dynamic";
export const fetchCache = "force-no-store";

const paramsSchema = z.object({
  date: z.string(),
});

export async function GET(request: NextRequest, context: { params: { date: string } }) {
  try {
    const supabase = createServerSupabaseClient();
    const auth = await requireStaffAuth(supabase, request);
    if (auth.error) return auth.error;

    const params = paramsSchema.safeParse(context.params);
    if (!params.success) {
      return NextResponse.json(
        { success: false, error: "Invalid date.", details: params.error.flatten() },
        { status: 400 }
      );
    }

    const logDate = assertShiftLogDate(params.data.date);
    const entries = await listShiftLogEntries(supabase, logDate);

    return NextResponse.json({
      success: true,
      data: {
        log_date: logDate,
        entries,
      },
    });
  } catch (err) {
    if (err instanceof HttpError) {
      return NextResponse.json({ success: false, error: err.message }, { status: err.status });
    }
    console.error("api/shift-log/[date] GET failed", err);
    const message = err instanceof Error ? err.message : "Internal server error";
    return NextResponse.json({ success: false, error: message }, { status: 500 });
  }
}
