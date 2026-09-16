import { createServerSupabaseClient } from "@/lib/supabase/server";
import { requireStaffAuth } from "@/lib/server-auth";
import { NextRequest, NextResponse } from "next/server";
import { unstable_noStore as noStore } from "next/cache";

export const dynamic = "force-dynamic";

function toLocalDate(date: Date, tz = "Asia/Bangkok"): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: tz,
  }).format(date);
}

/*
 * GET — EOD status check
 *
 * Returns:
 * - needs_eod: true if business_date < today
 * - days_overdue: number of days behind
 * - business_date
 * - calendar_date
 *
 * Owner is explicitly allowed here because the Owner dashboard
 * needs the EOD status to load correctly.
 */
export async function GET(request: NextRequest) {
  noStore();

  try {
    const supabase = createServerSupabaseClient();

    const auth = await requireStaffAuth(supabase, request, {
      allowRoles: ["admin", "supervisor", "owner"],
    });

    if (auth.error) return auth.error;

    const { data: settings, error: settingsError } = await supabase
      .from("hotel_settings")
      .select(
        "business_date, eod_reminder_time, hotel_timezone, night_audit_popup_snooze_min"
      )
      .eq("id", 1)
      .maybeSingle();

    if (settingsError) {
      return NextResponse.json(
        { error: settingsError.message },
        { status: 500 }
      );
    }

    const tz = settings?.hotel_timezone ?? "Asia/Bangkok";

    const calendarDate = toLocalDate(new Date(), tz);

    const businessDate = settings?.business_date ?? calendarDate;

    const diff = Math.floor(
      (new Date(calendarDate).getTime() -
        new Date(businessDate).getTime()) /
        86400000
    );

    return NextResponse.json({
      success: true,
      business_date: businessDate,
      calendar_date: calendarDate,
      needs_eod: diff > 0,
      days_overdue: Math.max(0, diff),
      eod_reminder_time: settings?.eod_reminder_time ?? "02:00",
      night_audit_popup_snooze_min: Number(
        settings?.night_audit_popup_snooze_min ?? 30
      ),
    });
  } catch (err) {
    return NextResponse.json(
      {
        error: err instanceof Error ? err.message : String(err),
      },
      { status: 500 }
    );
  }
}
