import { getLaundryBatchDetail } from "@/lib/linen/batch-service";
import { createMonthlyVendorToken, getLatestMonthlyVendorName } from "@/lib/linen/monthly-vendor-token";
import { listPendingItems } from "@/lib/linen/pending-service";
import { toAdjustedPendingSummaryRows, toReturnSummaryRows } from "@/lib/linen/rewash-summary";
import { validateVendorToken, LinenVendorTokenError } from "@/lib/linen/vendor-token";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { NextRequest, NextResponse } from "next/server";

export const dynamic = "force-dynamic";
export const fetchCache = "force-no-store";

function vendorError(error: unknown, fallback: string) {
  const status = error instanceof LinenVendorTokenError ? error.status : 500;
  const message = error instanceof Error ? error.message : fallback;
  return NextResponse.json({ success: false, error: message }, { status });
}

function firstDayStatementMonth(businessDate: unknown) {
  const match = String(businessDate ?? "").match(/^(\d{4})-(\d{2})-01$/);
  if (!match) return null;
  return { year: Number(match[1]), month: Number(match[2]) };
}

export async function GET(_request: NextRequest, { params }: { params: { token: string } }) {
  try {
    const supabase = createServerSupabaseClient();
    const tokenRow = await validateVendorToken(supabase, params.token);
    const detail = await getLaundryBatchDetail(supabase, String(tokenRow.batch_id));
    const pendingItems = await listPendingItems(supabase);
    const { data: settings } = await supabase.from("hotel_settings").select("hotel_name, company_name").limit(1).maybeSingle();

    const items = detail.items.filter((item: any) => Number(item.sent_by_hotel ?? 0) > 0);
    const todayReceivedTotal = items.reduce((sum: number, item: any) => sum + Number(item.sent_by_hotel ?? 0), 0);
    const returnSummary = toReturnSummaryRows(detail.events ?? [], [
      ...(detail.items ?? []),
      ...(detail.return_sources ?? []),
    ]);
    let monthlyVendor: Awaited<ReturnType<typeof createMonthlyVendorToken>> | null = null;
    const statementMonth = firstDayStatementMonth((detail.batch as any).business_date);
    if (statementMonth) {
      const vendorName = await getLatestMonthlyVendorName(supabase, statementMonth.year, statementMonth.month);
      monthlyVendor = await createMonthlyVendorToken(supabase, statementMonth.year, statementMonth.month, {
        vendorName: vendorName ?? (tokenRow as any).vendor_name ?? (detail.batch as any).vendor_name ?? null,
        baseUrl: _request.nextUrl.origin,
        reuseActive: true,
      });
    }
    const adjustedPendingItems = toAdjustedPendingSummaryRows(pendingItems, detail.events ?? [], [
      ...(detail.items ?? []),
      ...(detail.return_sources ?? []),
    ]).map((item) => ({
      id: item.id,
      source_batch_id: item.source_batch_id,
      linen_item_id: item.linen_item_id,
      pending_qty: item.qty,
      resolved_batch_id: null,
      resolved_at: null,
      reason: null,
      created_at: "",
      source_batch_date: item.sourceDate,
      source_pickup_round: item.sourceRound ? Number(item.sourceRound) : undefined,
      name_th: item.name,
    }));

    return NextResponse.json({
      success: true,
      data: {
        batch: detail.batch,
        items,
        rewash_items: detail.rewash_events.filter((item: any) => Number(item.qty ?? 0) > 0),
        rewash_return_items: (detail.resolved_rewash_events ?? []).filter((item: any) => Number(item.resolved_qty ?? item.qty ?? 0) > 0),
        return_items: detail.items.filter((item: any) => Number(item.received_back ?? 0) > 0),
        return_summary: returnSummary,
        pending_items: adjustedPendingItems,
        today_received_total: todayReceivedTotal,
        status: (detail.batch as any).status,
        hotel_name: String((settings as any)?.hotel_name ?? (settings as any)?.company_name ?? "Hotel"),
        monthly_vendor: monthlyVendor,
      },
    });
  } catch (error) {
    console.error("api/linen/vendor/[token] GET failed", error);
    return vendorError(error, "Failed to load vendor linen view.");
  }
}
