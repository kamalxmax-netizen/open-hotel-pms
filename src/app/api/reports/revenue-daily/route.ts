import { createServerSupabaseClient } from "@/lib/supabase/server";
import { resolveBusinessDate } from "@/lib/folio-fees";
import {
  summarizeDailyRevenue,
  type RevenueExtraRow,
  type RevenueNightRow,
  type RevenuePosOrderRow,
  type RevenueRoomRow,
} from "@/lib/revenue-reporting";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

export const dynamic = "force-dynamic";
export const fetchCache = "force-no-store";

const dateRegex = /^\d{4}-\d{2}-\d{2}$/;
const querySchema = z.object({
  date: z.string().regex(dateRegex, "date must be YYYY-MM-DD").optional(),
});

function toBangkokDateString(date = new Date()): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Bangkok",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);
  const y = parts.find((p) => p.type === "year")?.value;
  const m = parts.find((p) => p.type === "month")?.value;
  const d = parts.find((p) => p.type === "day")?.value;
  if (!y || !m || !d) return new Date().toISOString().slice(0, 10);
  return `${y}-${m}-${d}`;
}

export async function GET(request: NextRequest) {
  try {
    const parsed = querySchema.safeParse({
      date: request.nextUrl.searchParams.get("date") ?? undefined,
    });
    if (!parsed.success) {
      return NextResponse.json(
        { success: false, error: "Invalid query.", details: parsed.error.flatten() },
        { status: 400 }
      );
    }

    const supabase = createServerSupabaseClient();
    const fallbackDate = toBangkokDateString();
    const resolvedBusinessDate = await resolveBusinessDate(supabase, fallbackDate);
    const businessDate = parsed.data.date ?? resolvedBusinessDate;

    const [roomsRes, nightsRes, posRes, extraRes] = await Promise.all([
      supabase
        .from("rooms")
        .select("id, room_number, floor_number, is_dayuse, closure_reason, is_sellable")
        .eq("is_sellable", true)
        .order("floor_number", { ascending: true, nullsFirst: false })
        .order("room_number", { ascending: true }),
      supabase
        .from("reservation_nights")
        .select(
          "room_id, stay_date, nightly_price, reservations!inner(id, guest_name, booking_code, source, checkin_date, checkout_date, is_dayuse, status)"
        )
        .eq("stay_date", businessDate)
        .is("cancelled_at", null)
        .neq("reservations.status", "cancelled"),
      supabase
        .from("pos_orders")
        .select("total, status")
        .eq("order_date", businessDate)
        .eq("status", "completed"),
      supabase
        .from("folio_payments")
        .select("id, paid_date, paid_at, tx_type, amount, note, revenue_category, is_record_only, is_correction, is_void_reversal, void_of")
        .eq("paid_date", businessDate)
        .eq("revenue_category", "extra_charge")
        .in("tx_type", ["payment", "refund"]),
    ]);

    if (roomsRes.error) {
      return NextResponse.json({ success: false, error: roomsRes.error.message }, { status: 500 });
    }
    if (nightsRes.error) {
      return NextResponse.json({ success: false, error: nightsRes.error.message }, { status: 500 });
    }
    if (posRes.error) {
      return NextResponse.json({ success: false, error: posRes.error.message }, { status: 500 });
    }
    if (extraRes.error) {
      return NextResponse.json({ success: false, error: extraRes.error.message }, { status: 500 });
    }

    const extraRows = (extraRes.data ?? []) as RevenueExtraRow[];
    const extraIds = extraRows.map((row) => String(row.id ?? "").trim()).filter(Boolean);
    const laterVoidedExtraOriginalIds = new Set<string>();
    if (extraIds.length > 0) {
      const { data: laterVoidRows, error: laterVoidError } = await supabase
        .from("folio_payments")
        .select("void_of")
        .eq("is_void_reversal", true)
        .in("void_of", extraIds);
      if (laterVoidError) {
        return NextResponse.json({ success: false, error: laterVoidError.message }, { status: 500 });
      }
      for (const row of laterVoidRows ?? []) {
        const originalId = String((row as { void_of?: string | null }).void_of ?? "").trim();
        if (originalId) laterVoidedExtraOriginalIds.add(originalId);
      }
    }

    const summary = summarizeDailyRevenue({
      rooms: (roomsRes.data ?? []) as RevenueRoomRow[],
      nights: (nightsRes.data ?? []) as RevenueNightRow[],
      extraRows,
      laterVoidedExtraOriginalIds,
      posOrders: (posRes.data ?? []) as RevenuePosOrderRow[],
      businessDate,
    });

    return NextResponse.json({
      success: true,
      business_date: businessDate,
      sellable_rooms: summary.sellableRooms,
      rooms: summary.rooms,
      dayuse: summary.dayuse,
      pos_total: summary.posRevenue,
      summary: {
        total_revenue: summary.totalRevenueExcludingPos,
        room_revenue: summary.roomRevenue,
        dayuse_revenue: summary.dayuseRevenue,
        extra_revenue: summary.extraRevenue,
        pos_revenue: summary.posRevenue,
        occupied_rooms: summary.occupiedRooms,
        occupancy_pct: summary.occupancyPct,
        adr: summary.adr,
        revpar: summary.revpar,
      },
    });
  } catch (err) {
    console.error("api/reports/revenue-daily GET failed", err);
    const message = err instanceof Error ? err.message : "Internal server error";
    return NextResponse.json({ success: false, error: message }, { status: 500 });
  }
}
