import { createServerSupabaseClient } from "@/lib/supabase/server";
import { getProductSnapshotTransactions, getStockSnapshotDetail, isBusinessDate } from "@/lib/stock-snapshot";
import { NextResponse } from "next/server";
import { z } from "zod";

export const dynamic = "force-dynamic";
export const fetchCache = "force-no-store";

const paramsSchema = z.object({
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  productId: z.string().uuid(),
});

export async function GET(
  _request: Request,
  { params }: { params: { date: string; productId: string } }
) {
  try {
    const parsed = paramsSchema.safeParse(params);
    if (!parsed.success || !isBusinessDate(params.date)) {
      return NextResponse.json({ success: false, error: "Invalid params." }, { status: 400 });
    }

    const supabase = createServerSupabaseClient();
    const [detail, transactions] = await Promise.all([
      getStockSnapshotDetail(supabase, params.date),
      getProductSnapshotTransactions(supabase, params.date, params.productId),
    ]);
    const snapshot = detail.snapshots.find((row) => row.product_id === params.productId) ?? null;

    return NextResponse.json({
      success: true,
      business_date: params.date,
      product_id: params.productId,
      snapshot,
      transactions,
    });
  } catch (err) {
    console.error("inventory/snapshots product GET failed", err);
    const message = err instanceof Error ? err.message : "Internal server error";
    return NextResponse.json({ success: false, error: message }, { status: 500 });
  }
}
