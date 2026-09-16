import { createServerSupabaseClient } from "@/lib/supabase/server";
import { requireStaffAuth } from "@/lib/server-auth";
import { NextRequest, NextResponse } from "next/server";
import { unstable_noStore as noStore } from "next/cache";
import { addDays } from "@/lib/dates";
import {
  attachTemplateFallback,
  filterAlertsForSurface,
  mapEffectiveReservationAlert,
  normalizeAlertCodeKey,
  summarizeAlerts,
} from "@/lib/reservation-alerts";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  noStore();

  try {
    const supabase = createServerSupabaseClient();

    // IMPORTANT:
    // Owner is allowed to view the Calendar / Board.
    const auth = await requireStaffAuth(supabase, request, {
      allowRoles: ["admin", "supervisor", "owner"],
    });

    if (auth.error) return auth.error;

    const sp = request.nextUrl.searchParams;

    // Default: today → today+14
    const today = new Intl.DateTimeFormat("en-CA", {
      timeZone: "Asia/Bangkok",
    }).format(new Date());

    const defaultEnd = new Intl.DateTimeFormat("en-CA", {
      timeZone: "Asia/Bangkok",
    }).format(new Date(Date.now() + 14 * 86400000));

    const startDate = sp.get("start") ?? today;
    const endDate = sp.get("end") ?? defaultEnd;

    // ... KEEP THE REST OF YOUR EXISTING CALENDAR CODE UNCHANGED ...
