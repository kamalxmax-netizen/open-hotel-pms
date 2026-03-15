import { createServerSupabaseClient } from "@/lib/supabase/server";
import { NextResponse } from "next/server";
import { unstable_noStore as noStore } from "next/cache";

export const dynamic = "force-dynamic";

/* ─── GET /api/alert-codes ───────────────────────────────────
   Return all predefined alert codes
─────────────────────────────────────────────────────────── */
export async function GET() {
    noStore();
    try {
        const supabase = createServerSupabaseClient();
        const { data, error } = await supabase
            .from("alert_codes")
            .select("*")
            .order("code");

        if (error) return NextResponse.json({ error: error.message }, { status: 500 });
        return NextResponse.json({ success: true, codes: data ?? [] });
    } catch (err) {
        return NextResponse.json({ error: String(err) }, { status: 500 });
    }
}
