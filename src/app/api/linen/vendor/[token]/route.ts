import { getLaundryBatchDetail } from "@/lib/linen/batch-service";
import { listPendingItems } from "@/lib/linen/pending-service";
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

export async function GET(_request: NextRequest, { params }: { params: { token: string } }) {
  try {
    const supabase = createServerSupabaseClient();
    const tokenRow = await validateVendorToken(supabase, params.token);
    const detail = await getLaundryBatchDetail(supabase, String(tokenRow.batch_id));
    const pendingItems = await listPendingItems(supabase);
    const { data: settings } = await supabase.from("hotel_settings").select("hotel_name, company_name").limit(1).maybeSingle();

    const items = detail.items.filter((item: any) => Number(item.sent_by_hotel ?? 0) > 0);
    const todayReceivedTotal = items.reduce((sum: number, item: any) => sum + Number(item.sent_by_hotel ?? 0), 0);

    return NextResponse.json({
      success: true,
      data: {
        batch: detail.batch,
        items,
        rewash_items: detail.rewash_events.filter((item: any) => Number(item.qty ?? 0) > 0),
        return_items: detail.items.filter((item: any) => Number(item.received_back ?? 0) > 0),
        pending_items: pendingItems,
        today_received_total: todayReceivedTotal,
        status: (detail.batch as any).status,
        hotel_name: String((settings as any)?.hotel_name ?? (settings as any)?.company_name ?? "Hotel"),
      },
    });
  } catch (error) {
    console.error("api/linen/vendor/[token] GET failed", error);
    return vendorError(error, "Failed to load vendor linen view.");
  }
}
