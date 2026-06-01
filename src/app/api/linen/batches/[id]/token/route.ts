import { getLaundryBatchDetail } from "@/lib/linen/batch-service";
import { linenApiError, requireLinenAccess } from "@/lib/linen/api-auth";
import { createMonthlyVendorToken, getLatestMonthlyVendorName } from "@/lib/linen/monthly-vendor-token";
import { createVendorToken } from "@/lib/linen/vendor-token";
import { NextRequest, NextResponse } from "next/server";

export const dynamic = "force-dynamic";
export const fetchCache = "force-no-store";

function firstDayStatementMonth(businessDate: unknown) {
  const match = String(businessDate ?? "").match(/^(\d{4})-(\d{2})-01$/);
  if (!match) return null;
  return { year: Number(match[1]), month: Number(match[2]) };
}

export async function POST(request: NextRequest, { params }: { params: { id: string } }) {
  try {
    const { supabase, actor } = await requireLinenAccess(request);
    const detail = await getLaundryBatchDetail(supabase, params.id);
    const origin = request.nextUrl.origin;
    const data = await createVendorToken(supabase, params.id, {
      vendorName: (detail.batch as any).vendor_name,
      baseUrl: origin,
    });

    let monthlyVendor: Awaited<ReturnType<typeof createMonthlyVendorToken>> | null = null;
    const statementMonth = firstDayStatementMonth((detail.batch as any).business_date);
    if (statementMonth) {
      const vendorName = await getLatestMonthlyVendorName(supabase, statementMonth.year, statementMonth.month);
      monthlyVendor = await createMonthlyVendorToken(supabase, statementMonth.year, statementMonth.month, {
        vendorName: vendorName ?? (detail.batch as any).vendor_name ?? null,
        baseUrl: origin,
        createdBy: actor.userId,
        reuseActive: true,
      });
    }

    return NextResponse.json({ success: true, data: { ...data, monthly_vendor: monthlyVendor } });
  } catch (error) {
    console.error("api/linen/batches/[id]/token POST failed", error);
    const { status, message } = linenApiError(error, "Failed to create vendor token.");
    return NextResponse.json({ success: false, error: message }, { status });
  }
}
