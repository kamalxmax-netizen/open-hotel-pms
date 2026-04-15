import { createServerSupabaseClient } from "@/lib/supabase/server";
import { getStockSnapshotDetail, isBusinessDate } from "@/lib/stock-snapshot";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

export const dynamic = "force-dynamic";
export const fetchCache = "force-no-store";

const querySchema = z.object({
  tracking_mode: z.enum(["pos_main_only", "amenity_prepare", "amenity_direct", "all"]).optional(),
  category: z.enum(["pos", "amenity", "both", "all"]).optional(),
});

export async function GET(
  request: NextRequest,
  { params }: { params: { date: string } }
) {
  try {
    if (!isBusinessDate(params.date)) {
      return NextResponse.json({ success: false, error: "Invalid business date." }, { status: 400 });
    }

    const parsed = querySchema.safeParse({
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
    const detail = await getStockSnapshotDetail(supabase, params.date, {
      trackingMode: parsed.data.tracking_mode ?? "all",
      category: parsed.data.category ?? "all",
    });

    return NextResponse.json({ success: true, ...detail });
  } catch (err) {
    console.error("inventory/snapshots/[date] GET failed", err);
    const message = err instanceof Error ? err.message : "Internal server error";
    return NextResponse.json({ success: false, error: message }, { status: 500 });
  }
}
