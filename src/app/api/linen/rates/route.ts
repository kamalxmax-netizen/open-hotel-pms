import { linenApiError, requireLinenAccess } from "@/lib/linen/api-auth";
import { normalizeEffectiveMonth } from "@/lib/linen/monthly";
import type { LinenItemRate } from "@/lib/types";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

export const dynamic = "force-dynamic";
export const fetchCache = "force-no-store";

const rateInputSchema = z.object({
  linen_item_id: z.coerce.number().int().positive(),
  effective_month: z.string().trim().min(7),
  rate_per_piece: z.coerce.number().min(0),
  note: z.string().trim().max(500).optional().nullable(),
});

const bodySchema = z.union([
  rateInputSchema,
  z.object({ rates: z.array(rateInputSchema).min(1) }),
]);

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

export async function GET(request: NextRequest) {
  try {
    const { supabase } = await requireLinenAccess(request);
    const monthParam = request.nextUrl.searchParams.get("month") ?? new Date().toISOString().slice(0, 7);
    const effectiveMonth = normalizeEffectiveMonth(monthParam);

    const [itemsRes, ratesRes] = await Promise.all([
      supabase
        .from("linen_items")
        .select("id, item_number, name_th, name_en")
        .order("item_number", { ascending: true }),
      supabase
        .from("linen_item_rates")
        .select("*, linen_items(item_number, name_th, name_en)")
        .lte("effective_month", effectiveMonth)
        .order("effective_month", { ascending: false })
        .order("created_at", { ascending: false }),
    ]);

    if (itemsRes.error) throw new Error(itemsRes.error.message);
    if (ratesRes.error) throw new Error(ratesRes.error.message);

    const latestByItem = new Map<number, LinenItemRate>();
    for (const row of (ratesRes.data ?? []) as any[]) {
      const itemId = Number(row.linen_item_id);
      if (!latestByItem.has(itemId)) latestByItem.set(itemId, mapRate(row));
    }

    const rates = ((itemsRes.data ?? []) as any[]).map((item) => {
      const existing = latestByItem.get(Number(item.id));
      if (existing) return existing;
      return {
        id: `fallback-${item.id}-${effectiveMonth}`,
        linen_item_id: Number(item.id),
        effective_month: effectiveMonth,
        rate_per_piece: 0,
        note: null,
        created_at: new Date(0).toISOString(),
        created_by: null,
        item_number: Number(item.item_number),
        name_th: String(item.name_th ?? ""),
        name_en: String(item.name_en ?? ""),
      } satisfies LinenItemRate;
    });

    return NextResponse.json(rates);
  } catch (error) {
    console.error("api/linen/rates GET failed", error);
    const { status, message } = linenApiError(error, "Failed to load linen rates.");
    return NextResponse.json({ success: false, error: message }, { status });
  }
}

export async function POST(request: NextRequest) {
  try {
    const { supabase, actor } = await requireLinenAccess(request);
    if (!actor.isAdmin) {
      return NextResponse.json({ success: false, error: "Forbidden" }, { status: 403 });
    }

    const body = await request.json().catch(() => ({}));
    const parsed = bodySchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { success: false, error: "Invalid payload.", details: parsed.error.flatten() },
        { status: 400 }
      );
    }

    const inputs = "rates" in parsed.data ? parsed.data.rates : [parsed.data];
    const rows = inputs.map((input) => ({
      linen_item_id: input.linen_item_id,
      effective_month: normalizeEffectiveMonth(input.effective_month),
      rate_per_piece: Number(input.rate_per_piece.toFixed(2)),
      note: input.note?.trim() || null,
      created_by: actor.userId,
    }));

    const { data, error } = await supabase
      .from("linen_item_rates")
      .upsert(rows, { onConflict: "linen_item_id,effective_month" })
      .select("*, linen_items(item_number, name_th, name_en)");

    if (error) throw new Error(error.message);
    const rates = ((data ?? []) as any[]).map(mapRate);

    return NextResponse.json({
      success: true,
      rate: rates[0] ?? null,
      rates,
    });
  } catch (error) {
    console.error("api/linen/rates POST failed", error);
    const { status, message } = linenApiError(error, "Failed to save linen rates.");
    return NextResponse.json({ success: false, error: message }, { status });
  }
}
