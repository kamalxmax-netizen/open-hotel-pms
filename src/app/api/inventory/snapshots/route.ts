import { createServerSupabaseClient } from "@/lib/supabase/server";
import { getCurrentBusinessDate, isBusinessDate, listStockSnapshots, shiftBusinessDate } from "@/lib/stock-snapshot";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

export const dynamic = "force-dynamic";
export const fetchCache = "force-no-store";

const querySchema = z.object({
  date_from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  date_to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  tracking_mode: z.enum(["pos_main_only", "amenity_prepare", "amenity_direct", "all"]).optional(),
  category: z.enum(["pos", "amenity", "both", "all"]).optional(),
});

export async function GET(request: NextRequest) {
  try {
    const parsed = querySchema.safeParse({
      date_from: request.nextUrl.searchParams.get("date_from") ?? undefined,
      date_to: request.nextUrl.searchParams.get("date_to") ?? undefined,
      tracking_mode: request.nextUrl.searchParams.get("tracking_mode") ?? undefined,
      category: request.nextUrl.searchParams.get("category") ?? undefined,
    });

    if (!parsed.success) {
      return NextResponse.json(
        { success: false, error: "Invalid query.", details: parsed.error.flatten() },
        { status: 400 }
      );
    }

    const supabase = createServerSupabaseClient();
    const businessDate = await getCurrentBusinessDate(supabase);
    const dateTo = parsed.data.date_to ?? businessDate;
    const dateFrom = parsed.data.date_from ?? shiftBusinessDate(dateTo, -7);

    if (!isBusinessDate(dateFrom) || !isBusinessDate(dateTo) || dateFrom > dateTo) {
      return NextResponse.json({ success: false, error: "Invalid date range." }, { status: 400 });
    }

    const snapshots = await listStockSnapshots(supabase, {
      dateFrom,
      dateTo,
      trackingMode: parsed.data.tracking_mode ?? "all",
      category: parsed.data.category ?? "all",
    });

    const { data: dailyRows, error: dailyError } = await supabase
      .from("daily_snapshots")
      .select("business_date, stock_reconcile_status")
      .gte("business_date", dateFrom)
      .lte("business_date", dateTo);

    if (dailyError) throw new Error(dailyError.message);

    const statusByDate = new Map(
      ((dailyRows ?? []) as any[]).map((row) => [String(row.business_date), String(row.stock_reconcile_status ?? "pending")])
    );

    const snapshotsByDate: Record<
      string,
      {
        total_products: number;
        variance_count: number;
        clean_count: number;
        reconcile_status: string;
        products: typeof snapshots;
      }
    > = {};

    for (const row of snapshots) {
      const key = row.business_date;
      if (!snapshotsByDate[key]) {
        snapshotsByDate[key] = {
          total_products: 0,
          variance_count: 0,
          clean_count: 0,
          reconcile_status: statusByDate.get(key) ?? "pending",
          products: [],
        };
      }
      snapshotsByDate[key].products.push(row);
      snapshotsByDate[key].total_products += 1;
      if (row.variance_main !== 0 || row.variance_floor !== 0) {
        snapshotsByDate[key].variance_count += 1;
      } else {
        snapshotsByDate[key].clean_count += 1;
      }
    }

    return NextResponse.json({
      success: true,
      range: { date_from: dateFrom, date_to: dateTo },
      snapshots_by_date: snapshotsByDate,
    });
  } catch (err) {
    console.error("inventory/snapshots GET failed", err);
    const message = err instanceof Error ? err.message : "Internal server error";
    return NextResponse.json({ success: false, error: message }, { status: 500 });
  }
}
