import { linenApiError, requireLinenAccess } from "@/lib/linen/api-auth";
import type { LinenItemRate } from "@/lib/types";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

export const dynamic = "force-dynamic";
export const fetchCache = "force-no-store";

const paramsSchema = z.object({
  itemId: z.coerce.number().int().positive(),
});

function numberValue(value: unknown): number {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) ? parsed : 0;
}

function mapRate(row: any): LinenItemRate {
  const item = Array.isArray(row.linen_items) ? row.linen_items[0] : row.linen_items;
  return {
    id: String(row.id),
    linen_item_id: Number(row.linen_item_id),
    effective_month: String(row.effective_month),
    rate_per_piece: numberValue(row.rate_per_piece),
    note: row.note ?? null,
    created_at: String(row.created_at),
    created_by: row.created_by ?? null,
    item_number: item?.item_number === undefined ? undefined : Number(item.item_number),
    name_th: item?.name_th ?? undefined,
    name_en: item?.name_en ?? undefined,
  };
}

export async function GET(
  request: NextRequest,
  { params }: { params: { itemId: string } }
) {
  try {
    const parsed = paramsSchema.safeParse(params);
    if (!parsed.success) {
      return NextResponse.json(
        { success: false, error: "Invalid params.", details: parsed.error.flatten() },
        { status: 400 }
      );
    }

    const { supabase } = await requireLinenAccess(request);
    const { data, error } = await supabase
      .from("linen_item_rates")
      .select("*, linen_items(item_number, name_th, name_en)")
      .eq("linen_item_id", parsed.data.itemId)
      .order("effective_month", { ascending: false })
      .order("created_at", { ascending: false });

    if (error) throw new Error(error.message);
    return NextResponse.json(((data ?? []) as any[]).map(mapRate));
  } catch (error) {
    console.error("api/linen/rates/[itemId]/history GET failed", error);
    const { status, message } = linenApiError(error, "Failed to load linen rate history.");
    return NextResponse.json({ success: false, error: message }, { status });
  }
}
