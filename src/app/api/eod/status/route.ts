import { createServerSupabaseClient } from "@/lib/supabase/server";
import { requireStaffAuth } from "@/lib/server-auth";
import { NextRequest, NextResponse } from "next/server";
import { unstable_noStore as noStore } from "next/cache";

export const dynamic = "force-dynamic";

function toLocalDate(date: Date, tz = "Asia/Bangkok"): string {
    return new Intl.DateTimeFormat("en-CA", { timeZone: tz }).format(date);
}

/* ─── GET — EOD status check ─────────────────────── 
   Returns:
   - needs_eod: true if business_date < today
   - days_overdue: how many days behind
   - business_date / calendar_date
*/
export async function GET(request: NextRequest) {
    noStore(); // Completely disable Next.js caching
    try {
        const supabase = createServerSupabaseClient();
        const auth = await requireStaffAuth(supabase, request);
        if (auth.error) return auth.error;

        const { data: settings } = await supabase
            .from("hotel_settings")
            .select("business_date, eod_reminder_time, hotel_timezone, night_audit_popup_snooze_min")
            .eq("id", 1)
            .maybeSingle();

        const tz = settings?.hotel_timezone ?? "Asia/Bangkok";
        const calendarDate = toLocalDate(new Date(), tz);
        const businessDate = settings?.business_date ?? calendarDate;

        const diff = Math.floor(
            (new Date(calendarDate).getTime() - new Date(businessDate).getTime()) / 86400000
        );

        return NextResponse.json({
            success: true,
            business_date: businessDate,
            calendar_date: calendarDate,
            needs_eod: diff > 0,
            days_overdue: Math.max(0, diff),
            eod_reminder_time: settings?.eod_reminder_time ?? "02:00",
            night_audit_popup_snooze_min: Number(settings?.night_audit_popup_snooze_min ?? 30),
        });
    } catch (err) {
        return NextResponse.json({ error: String(err) }, { status: 500 });
    }
}
