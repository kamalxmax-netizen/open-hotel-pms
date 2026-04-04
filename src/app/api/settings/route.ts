import { createServerSupabaseClient } from "@/lib/supabase/server";
import { normalizeTransportAlertLeadMinutes } from "@/lib/transport-alert-settings";
import { NextRequest, NextResponse } from "next/server";
import { unstable_noStore as noStore } from "next/cache";

export const dynamic = "force-dynamic";

function toLocalDate(date: Date, tz = "Asia/Bangkok"): string {
    return new Intl.DateTimeFormat("en-CA", { timeZone: tz }).format(date);
}

/* ─── GET — fetch hotel settings ─────────────────── */
export async function GET() {
    noStore(); // Completely disable all Next.js caching for this request
    try {
        const supabase = createServerSupabaseClient();
        const { data, error } = await supabase
            .from("hotel_settings")
            .select("*")
            .eq("id", 1)
            .maybeSingle();

        if (error) return NextResponse.json({ error: error.message }, { status: 500 });

        const localToday = toLocalDate(new Date());

        // Database time fields return as 'HH:mm:ss' (e.g., '14:00:00'). 
        // We slice to 5 chars ('14:00') since the frontend dropdown only has 'HH:mm' values.
        const settings = {
            hotel_name: data?.hotel_name ?? "My Hotel",
            hotel_timezone: data?.hotel_timezone ?? "Asia/Bangkok",
            sellable_rooms: data?.sellable_rooms ?? 0,
            business_date: data?.business_date ?? localToday,
            eod_reminder_time: (data?.eod_reminder_time ?? "02:00").slice(0, 5),
            night_audit_popup_snooze_min: Number(data?.night_audit_popup_snooze_min ?? 30),
            check_in_time: (data?.check_in_time ?? "14:00").slice(0, 5),
            check_out_time: (data?.check_out_time ?? "12:00").slice(0, 5),
            late_checkout_fee: data?.late_checkout_fee ?? 0,
            transport_alert_lead_min: normalizeTransportAlertLeadMinutes(data?.transport_alert_lead_min),
            dayuse_rate: Number(data?.dayuse_rate ?? 200),
            dayuse_duration_min: Number(data?.dayuse_duration_min ?? 120),
            dayuse_extend_rate: Number(data?.dayuse_extend_rate ?? 100),
            dayuse_extend_min: Number(data?.dayuse_extend_min ?? 60),
            identity_alert_under18_thai_id_enabled: data?.identity_alert_under18_thai_id_enabled ?? true,
            identity_alert_under18_passport_enabled: data?.identity_alert_under18_passport_enabled ?? true,
            identity_alert_over18_thai_id_enabled: data?.identity_alert_over18_thai_id_enabled ?? true,
            identity_alert_over18_passport_enabled: data?.identity_alert_over18_passport_enabled ?? true,
            identity_alert_birthday_enabled: data?.identity_alert_birthday_enabled ?? true,
        };

        return NextResponse.json(
            { success: true, settings },
            { headers: { "Cache-Control": "no-store, no-cache, must-revalidate, proxy-revalidate", "Pragma": "no-cache" } }
        );
    } catch (err) {
        return NextResponse.json({ error: String(err) }, { status: 500 });
    }
}

/* ─── PUT — update hotel settings ────────────────── */
export async function PUT(request: NextRequest) {
    try {
        const supabase = createServerSupabaseClient();
        const body = await request.json();

        const allowed = [
            "hotel_name", "hotel_timezone", "sellable_rooms",
            "eod_reminder_time", "check_in_time", "check_out_time",
            "late_checkout_fee", "night_audit_popup_snooze_min",
            "transport_alert_lead_min",
            "dayuse_rate", "dayuse_duration_min", "dayuse_extend_rate", "dayuse_extend_min",
            "identity_alert_under18_thai_id_enabled",
            "identity_alert_under18_passport_enabled",
            "identity_alert_over18_thai_id_enabled",
            "identity_alert_over18_passport_enabled",
            "identity_alert_birthday_enabled"
        ];

        const updates: Record<string, unknown> = { updated_at: new Date().toISOString() };
        for (const key of allowed) {
            if (!(key in body)) continue;
            updates[key] = key === "transport_alert_lead_min"
                ? normalizeTransportAlertLeadMinutes(body[key])
                : body[key];
        }

        const { data, error } = await supabase
            .from("hotel_settings")
            .upsert({ id: 1, ...updates })
            .select("*")
            .maybeSingle();

        if (error) return NextResponse.json({ error: error.message }, { status: 500 });

        return NextResponse.json({ success: true, settings: data });
    } catch (err) {
        return NextResponse.json({ error: String(err) }, { status: 500 });
    }
}
