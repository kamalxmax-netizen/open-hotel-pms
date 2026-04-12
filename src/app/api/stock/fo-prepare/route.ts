import {
  buildFoPrepareSuggestions,
  checkFoCanReturn,
  getBusinessDate,
  getFoPrepareBatchByDate,
  getFoPrepareBatchDetail,
  getOldestOpenFoPrepareBatch,
} from "@/lib/fo-prepare";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

export const dynamic = "force-dynamic";
export const fetchCache = "force-no-store";

const querySchema = z.object({
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
});

const preparePayloadSchema = z.object({
  business_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  prepared_by: z.string().trim().max(120).optional(),
  note: z.string().trim().max(500).optional(),
  items: z
    .array(
      z.object({
        floor_number: z.number().int().min(1),
        product_id: z.string().uuid(),
        suggested_qty: z.number().int().min(0).default(0),
        prepare_qty: z.number().int().min(0),
      })
    )
    .min(1),
});

function isFoPrepareRpcMissing(error: { code?: string | null; message?: string | null } | null): boolean {
  const msg = String(error?.message ?? "").toLowerCase();
  return (
    error?.code === "42883" ||
    msg.includes("could not find the function") ||
    msg.includes("fo_prepare_daily_stock") ||
    msg.includes("schema cache")
  );
}

export async function GET(request: NextRequest) {
  try {
    const parsed = querySchema.safeParse({
      date: request.nextUrl.searchParams.get("date") ?? undefined,
    });
    if (!parsed.success) {
      return NextResponse.json(
        { success: false, error: "Invalid query.", details: parsed.error.flatten() },
        { status: 400 }
      );
    }

    const supabase = createServerSupabaseClient();
    const businessDate = await getBusinessDate(supabase, parsed.data.date);
    const [{ rooms, suggestions }, existingBatch, oldestOpenBatch] = await Promise.all([
      buildFoPrepareSuggestions(supabase, businessDate),
      getFoPrepareBatchByDate(supabase, businessDate),
      getOldestOpenFoPrepareBatch(supabase, businessDate),
    ]);

    const returnTargetBatch =
      existingBatch?.status === "prepared"
        ? existingBatch
        : oldestOpenBatch;

    let canReturn = null;
    let batchDetail = null;
    if (returnTargetBatch) {
      const [detail, returnCheck] = await Promise.all([
        getFoPrepareBatchDetail(supabase, returnTargetBatch.id),
        checkFoCanReturn(supabase, returnTargetBatch.business_date),
      ]);
      batchDetail = detail;
      canReturn = returnCheck;
    }

    return NextResponse.json({
      success: true,
      business_date: businessDate,
      target_rooms_count: rooms.length,
      suggestions,
      existing_batch: existingBatch,
      return_target_batch: returnTargetBatch,
      batch_detail: batchDetail,
      can_return: canReturn,
    });
  } catch (err) {
    console.error("stock/fo-prepare GET failed", err);
    const message = err instanceof Error ? err.message : "Internal server error";
    return NextResponse.json({ success: false, error: message }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const json = await request.json().catch(() => null);
    const parsed = preparePayloadSchema.safeParse(json);
    if (!parsed.success) {
      return NextResponse.json(
        { success: false, error: "Invalid payload.", details: parsed.error.flatten() },
        { status: 400 }
      );
    }

    const supabase = createServerSupabaseClient();
    const businessDate = await getBusinessDate(supabase, parsed.data.business_date);
    const payloadItems = parsed.data.items
      .map((item) => ({
        floor_number: item.floor_number,
        product_id: item.product_id,
        suggested_qty: Math.max(item.suggested_qty ?? 0, 0),
        requested_qty: Math.max(item.prepare_qty ?? 0, 0),
      }))
      .filter((item) => item.requested_qty > 0);

    if (payloadItems.length === 0) {
      return NextResponse.json(
        { success: false, error: "At least one item with prepare_qty > 0 is required." },
        { status: 400 }
      );
    }

    // Hard-block policy: if main stock is insufficient for any requested product,
    // reject the whole prepare action and do not create a batch.
    const requestedByProduct = new Map<string, number>();
    for (const item of payloadItems) {
      requestedByProduct.set(
        item.product_id,
        (requestedByProduct.get(item.product_id) ?? 0) + item.requested_qty
      );
    }
    const requestedProductIds = Array.from(requestedByProduct.keys());
    if (requestedProductIds.length > 0) {
      const [{ data: stockRows, error: stockError }, { data: productRows, error: productError }] =
        await Promise.all([
          supabase.from("main_stock").select("product_id, quantity").in("product_id", requestedProductIds),
          supabase.from("products").select("id, name").in("id", requestedProductIds),
        ]);

      if (stockError) {
        return NextResponse.json({ success: false, error: stockError.message }, { status: 500 });
      }
      if (productError) {
        return NextResponse.json({ success: false, error: productError.message }, { status: 500 });
      }

      const stockByProduct = new Map<string, number>();
      for (const row of stockRows ?? []) {
        const id = String((row as any).product_id ?? "");
        if (!id) continue;
        stockByProduct.set(id, Number((row as any).quantity ?? 0));
      }
      const productNameById = new Map<string, string>();
      for (const row of productRows ?? []) {
        const id = String((row as any).id ?? "");
        if (!id) continue;
        productNameById.set(id, String((row as any).name ?? id));
      }

      const shortages = requestedProductIds
        .map((productId) => {
          const requested = requestedByProduct.get(productId) ?? 0;
          const available = Math.max(stockByProduct.get(productId) ?? 0, 0);
          return {
            product_id: productId,
            product_name: productNameById.get(productId) ?? productId,
            requested_qty: requested,
            available_qty: available,
          };
        })
        .filter((row) => row.requested_qty > row.available_qty);

      if (shortages.length > 0) {
        const shortageText = shortages
          .map((row) => `${row.product_name} (need ${row.requested_qty}, have ${row.available_qty})`)
          .join(", ");
        return NextResponse.json(
          {
            success: false,
            error: `Insufficient main stock. Prepare is blocked for this request: ${shortageText}.`,
            shortages,
          },
          { status: 409 }
        );
      }
    }

    const { data: rpcData, error: rpcError } = await supabase.rpc("fo_prepare_daily_stock", {
      p_business_date: businessDate,
      p_prepared_by: parsed.data.prepared_by?.trim() || null,
      p_prepare_note: parsed.data.note?.trim() || null,
      p_items: payloadItems,
    });

    if (rpcError) {
      if (isFoPrepareRpcMissing(rpcError)) {
        return NextResponse.json(
          {
            success: false,
            error:
              "FO prepare flow requires latest DB migration. Please apply migration 20260302_phase10_fo_prepare_flow.sql and reload schema.",
            details: rpcError.message,
          },
          { status: 500 }
        );
      }
      const message = String(rpcError.message ?? "FO prepare failed.");
      const statusCode = message.toLowerCase().includes("already exists") ? 409 : 500;
      return NextResponse.json({ success: false, error: message }, { status: statusCode });
    }

    const batchId = String((rpcData as any)?.batch_id ?? "");
    const detail = batchId ? await getFoPrepareBatchDetail(supabase, batchId) : null;
    const canReturn = await checkFoCanReturn(supabase, businessDate);

    return NextResponse.json({
      success: true,
      business_date: businessDate,
      result: rpcData,
      batch_detail: detail,
      can_return: canReturn,
    });
  } catch (err) {
    console.error("stock/fo-prepare POST failed", err);
    const message = err instanceof Error ? err.message : "Internal server error";
    return NextResponse.json({ success: false, error: message }, { status: 500 });
  }
}
