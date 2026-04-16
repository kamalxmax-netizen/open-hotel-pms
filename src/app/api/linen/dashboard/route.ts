import { getCurrentBusinessDate } from "@/lib/linen/expected-calc";
import { DAYUSE_TOWEL_THRESHOLD, getDayuseAccumulator } from "@/lib/linen/dayuse-accumulator";
import { linenApiError, requireLinenAccess } from "@/lib/linen/api-auth";
import { listPendingItems } from "@/lib/linen/pending-service";
import { NextRequest, NextResponse } from "next/server";

export const dynamic = "force-dynamic";
export const fetchCache = "force-no-store";

function sumReturnEvents(events: any[]): number {
  let total = 0;
  for (const event of events) {
    if (event.event_type !== "fo_return_counted") continue;
    const returns = Array.isArray(event.data?.returns) ? event.data.returns : [];
    for (const item of returns) total += Number(item.received_qty ?? 0);
    const resolved = Array.isArray(event.data?.resolved) ? event.data.resolved : [];
    for (const item of resolved) total += Number(item.qty ?? 0);
  }
  return total;
}

export async function GET(request: NextRequest) {
  try {
    const { supabase } = await requireLinenAccess(request);
    const businessDate = request.nextUrl.searchParams.get("business_date") ?? await getCurrentBusinessDate(supabase);

    const [batchesRes, itemsRes, eventsRes, pendingItems, dayuseRows] = await Promise.all([
      supabase.from("laundry_batches").select("*").eq("business_date", businessDate).order("pickup_round", { ascending: true }),
      supabase
        .from("laundry_batch_items")
        .select("sent_by_hotel, laundry_batches!inner(business_date)")
        .eq("laundry_batches.business_date", businessDate),
      supabase
        .from("laundry_batch_events")
        .select("event_type, data, laundry_batches!inner(business_date)")
        .eq("laundry_batches.business_date", businessDate),
      listPendingItems(supabase),
      getDayuseAccumulator(supabase),
    ]);

    if (batchesRes.error) throw new Error(batchesRes.error.message);
    if (itemsRes.error) throw new Error(itemsRes.error.message);
    if (eventsRes.error) throw new Error(eventsRes.error.message);

    const totalSent = (itemsRes.data ?? []).reduce((sum: number, row: any) => sum + Number(row.sent_by_hotel ?? 0), 0);
    const totalPending = pendingItems.reduce((sum: number, row: any) => sum + Number(row.pending_qty ?? 0), 0);
    const towel = dayuseRows.find((row: any) => Number(row.item_number) === 2);

    return NextResponse.json({
      success: true,
      data: {
        business_date: businessDate,
        batches_today: batchesRes.data ?? [],
        total_sent: totalSent,
        total_received: sumReturnEvents(eventsRes.data ?? []),
        total_pending: totalPending,
        pending_items: pendingItems,
        dayuse_accumulated: dayuseRows.map((row: any) => ({
          linen_item_id: row.linen_item_id,
          name_th: row.name_th,
          qty: row.qty_accumulated,
        })),
        dayuse_towel_count: Number((towel as any)?.qty_accumulated ?? 0),
        dayuse_threshold: DAYUSE_TOWEL_THRESHOLD,
      },
    });
  } catch (error) {
    console.error("api/linen/dashboard GET failed", error);
    const { status, message } = linenApiError(error, "Failed to load linen dashboard.");
    return NextResponse.json({ success: false, error: message }, { status });
  }
}
