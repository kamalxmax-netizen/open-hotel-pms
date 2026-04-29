import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { requireStaffAuth } from "@/lib/server-auth";
import { getAllowedScheduleMonths, getStaffScheduleView } from "@/lib/staff-schedule";

export const dynamic = "force-dynamic";
export const fetchCache = "force-no-store";

const querySchema = z.object({
  year: z.coerce.number().int().min(2000).max(2100).optional(),
  month: z.coerce.number().int().min(1).max(12).optional(),
});

function hasStaffSchedulePermission(allowedPages: unknown): boolean {
  const pages = Array.isArray(allowedPages) ? allowedPages.map((page) => String(page).trim()) : ["*"];
  return pages.some((page) => page === "*" || page === "/pms/staff-schedule" || page.startsWith("/pms/staff-schedule/"));
}

export async function GET(request: NextRequest) {
  try {
    const supabase = createServerSupabaseClient();
    const auth = await requireStaffAuth(supabase, request);
    if (auth.error) return auth.error;

    const { data: profile, error: profileError } = await supabase
      .from("profiles")
      .select("allowed_pages")
      .eq("user_id", auth.user.id)
      .maybeSingle();
    if (profileError) {
      return NextResponse.json({ success: false, error: profileError.message }, { status: 500 });
    }
    if (!hasStaffSchedulePermission(profile?.allowed_pages)) {
      return NextResponse.json({ success: false, error: "forbidden" }, { status: 403 });
    }

    const parsed = querySchema.safeParse({
      year: request.nextUrl.searchParams.get("year") ?? undefined,
      month: request.nextUrl.searchParams.get("month") ?? undefined,
    });
    if (!parsed.success) {
      return NextResponse.json(
        { success: false, error: "Invalid query.", details: parsed.error.flatten() },
        { status: 400 }
      );
    }
    if ((parsed.data.year && !parsed.data.month) || (!parsed.data.year && parsed.data.month)) {
      return NextResponse.json(
        { success: false, error: "year and month must be provided together." },
        { status: 400 }
      );
    }

    const defaultMonth = getAllowedScheduleMonths()[0];
    const year = parsed.data.year ?? defaultMonth.year;
    const month = parsed.data.month ?? defaultMonth.month;

    const data = await getStaffScheduleView(supabase, { year, month });
    return NextResponse.json({ success: true, data });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Internal server error";
    const status = message.includes("current month and next month") ? 400 : 500;
    console.error("api/staff/schedule-view GET failed", err);
    return NextResponse.json({ success: false, error: message }, { status });
  }
}
