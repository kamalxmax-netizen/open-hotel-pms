import { createLaundryBatch, listLaundryBatches } from "@/lib/linen/batch-service";
import { linenApiError, requireLinenAccess } from "@/lib/linen/api-auth";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

export const dynamic = "force-dynamic";
export const fetchCache = "force-no-store";

const createSchema = z.object({
  business_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  pickup_round: z.coerce.number().int().positive().default(1),
  vendor_name: z.string().trim().optional().nullable(),
  notes: z.string().trim().optional().nullable(),
  items: z.array(z.object({
    linen_item_id: z.coerce.number().int().positive(),
    is_dayuse: z.boolean().optional(),
    estimated_qty: z.coerce.number().int().min(0),
    sent_by_hotel: z.coerce.number().int().min(0),
  })).min(1),
  rewash_items: z.array(z.object({
    linen_item_id: z.coerce.number().int().positive(),
    is_dayuse: z.boolean().default(false),
    qty: z.coerce.number().int().positive(),
    photo_keys: z.array(z.string().trim().min(1)).optional(),
    photos: z.array(z.string().trim().min(1)).optional(),
    note: z.string().trim().optional().nullable(),
  }).transform((item) => ({
    linen_item_id: item.linen_item_id,
    is_dayuse: item.is_dayuse,
    qty: item.qty,
    photo_keys: item.photo_keys ?? item.photos ?? [],
    note: item.note ?? null,
  })).refine((item) => item.photo_keys.length > 0, {
    message: "At least one rewash photo is required.",
    path: ["photo_keys"],
  })).optional().default([]),
});

export async function GET(request: NextRequest) {
  try {
    const { supabase } = await requireLinenAccess(request);
    const data = await listLaundryBatches(supabase, {
      dateFrom: request.nextUrl.searchParams.get("date_from") ?? undefined,
      dateTo: request.nextUrl.searchParams.get("date_to") ?? undefined,
      status: request.nextUrl.searchParams.get("status"),
      linenItemId: request.nextUrl.searchParams.get("linen_item_id") ? Number(request.nextUrl.searchParams.get("linen_item_id")) : null,
      hasExtras: request.nextUrl.searchParams.has("has_extras") ? request.nextUrl.searchParams.get("has_extras") === "1" || request.nextUrl.searchParams.get("has_extras") === "true" : null,
      hasRewash: request.nextUrl.searchParams.has("has_rewash") ? request.nextUrl.searchParams.get("has_rewash") === "1" || request.nextUrl.searchParams.get("has_rewash") === "true" : null,
      hasEdits: request.nextUrl.searchParams.has("has_edits") ? request.nextUrl.searchParams.get("has_edits") === "1" || request.nextUrl.searchParams.get("has_edits") === "true" : null,
      search: request.nextUrl.searchParams.get("search"),
    });
    return NextResponse.json({ success: true, data });
  } catch (error) {
    console.error("api/linen/batches GET failed", error);
    const { status, message } = linenApiError(error, "Failed to list linen batches.");
    return NextResponse.json({ success: false, error: message }, { status });
  }
}

export async function POST(request: NextRequest) {
  try {
    const { supabase, actor } = await requireLinenAccess(request);
    const body = await request.json().catch(() => ({}));
    const parsed = createSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json({ success: false, error: "Invalid payload.", details: parsed.error.flatten() }, { status: 400 });
    }

    const data = await createLaundryBatch(supabase, { ...parsed.data, created_by: actor.userId });
    return NextResponse.json({ success: true, data });
  } catch (error) {
    console.error("api/linen/batches POST failed", error);
    const { status, message } = linenApiError(error, "Failed to create linen batch.");
    return NextResponse.json({ success: false, error: message }, { status });
  }
}
