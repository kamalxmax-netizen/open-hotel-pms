import { checkFoCanReturn, getFoPrepareBatchDetail } from "@/lib/fo-prepare";
import { amenityReconApiError, requireFoPrepareAccess } from "@/lib/amenity/reconciliation";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

const paramsSchema = z.object({
  batchId: z.string().uuid("Invalid batch id"),
});

const returnPayloadSchema = z.object({
  returned_by: z.string().trim().max(120).optional(),
  note: z.string().trim().max(500).optional(),
  force: z.boolean().optional().default(false),
  override_note: z.string().trim().max(500).optional(),
  items: z
    .array(
      z.object({
        item_id: z.string().uuid(),
        return_qty: z.number().int().min(0),
        damaged_qty: z.number().int().min(0).optional().default(0),
        note: z.string().trim().max(500).optional(),
      })
    )
    .default([]),
});

type ReturnPayload = z.infer<typeof returnPayloadSchema>;

async function ensureMainStockRow(supabase: any, productId: string, nowIso: string) {
  const { data: existing, error: readError } = await supabase
    .from("main_stock")
    .select("product_id")
    .eq("product_id", productId)
    .maybeSingle();
  if (readError) throw new Error(readError.message);
  if (existing) return;

  const { error: insertError } = await supabase
    .from("main_stock")
    .insert({ product_id: productId, quantity: 0, reorder_level: 10, updated_at: nowIso });
  if (insertError && insertError.code !== "23505") throw new Error(insertError.message);
}

async function submitFoPrepareReturnInApp(
  supabase: any,
  batchId: string,
  detail: NonNullable<Awaited<ReturnType<typeof getFoPrepareBatchDetail>>>,
  body: ReturnPayload,
  recordedBy: string | null
) {
  const nowIso = new Date().toISOString();
  const actorName = body.returned_by?.trim() || null;
  const note = body.note?.trim() || null;

  const { error: deleteReturnError } = await supabase
    .from("fo_prepare_batch_returns")
    .delete()
    .eq("batch_id", batchId);
  if (deleteReturnError) throw new Error(deleteReturnError.message);

  let processedCount = 0;
  let totalReturned = 0;
  let totalDamaged = 0;
  const returnRowsByProduct = new Map<
    string,
    {
      product_id: string;
      prepared_qty: number;
      returned_qty: number;
      damaged_qty: number;
      note: string | null;
    }
  >();

  for (const payloadItem of body.items) {
    const line = detail.items.find((item) => item.id === payloadItem.item_id);
    if (!line) throw new Error(`Batch item not found: ${payloadItem.item_id}`);

    const returnQty = Math.max(Number(payloadItem.return_qty ?? 0), 0);
    const damagedQty = Math.max(Number(payloadItem.damaged_qty ?? 0), 0);
    const itemNote = payloadItem.note?.trim() || null;
    const totalMoveQty = returnQty + damagedQty;

    const { data: floorRow, error: floorReadError } = await supabase
      .from("floor_stock")
      .select("quantity")
      .eq("floor_number", line.floor_number)
      .eq("product_id", line.product_id)
      .maybeSingle();
    if (floorReadError) throw new Error(floorReadError.message);
    const floorCurrentQty = Math.max(Number(floorRow?.quantity ?? 0), 0);
    if (totalMoveQty > floorCurrentQty && !itemNote && !note) {
      throw new Error(
        `reason is required when returning more than system floor stock for ${line.product_name} floor ${line.floor_number}`
      );
    }

    if (returnQty > 0) {
      await ensureMainStockRow(supabase, line.product_id, nowIso);

      const { data: mainRow, error: mainReadError } = await supabase
        .from("main_stock")
        .select("quantity")
        .eq("product_id", line.product_id)
        .maybeSingle();
      if (mainReadError) throw new Error(mainReadError.message);

      const { error: floorUpdateError } = await supabase
        .from("floor_stock")
        .update({ quantity: Math.max(floorCurrentQty - totalMoveQty, 0), updated_at: nowIso })
        .eq("floor_number", line.floor_number)
        .eq("product_id", line.product_id);
      if (floorUpdateError) throw new Error(floorUpdateError.message);

      const { error: mainUpdateError } = await supabase
        .from("main_stock")
        .update({ quantity: Number(mainRow?.quantity ?? 0) + returnQty, updated_at: nowIso })
        .eq("product_id", line.product_id);
      if (mainUpdateError) throw new Error(mainUpdateError.message);

      const { error: txError } = await supabase.from("stock_transactions_v2").insert({
        transaction_date: detail.batch.business_date,
        product_id: line.product_id,
        action: "return",
        quantity_change: returnQty,
        from_location: `floor_${line.floor_number}`,
        to_location: "main",
        reference_type: "fo_prepare_return",
        reference_id: batchId,
        floor_number: line.floor_number,
        performed_by: actorName,
        note: itemNote ?? note ?? "FO prepare return remaining stock",
        created_at: nowIso,
      });
      if (txError) throw new Error(txError.message);
    } else if (damagedQty > 0) {
      const { error: floorUpdateError } = await supabase
        .from("floor_stock")
        .update({ quantity: Math.max(floorCurrentQty - damagedQty, 0), updated_at: nowIso })
        .eq("floor_number", line.floor_number)
        .eq("product_id", line.product_id);
      if (floorUpdateError) throw new Error(floorUpdateError.message);
    }

    if (damagedQty > 0) {
      const { error: damagedTxError } = await supabase.from("stock_transactions_v2").insert({
        transaction_date: detail.batch.business_date,
        product_id: line.product_id,
        action: "adjust",
        quantity_change: -damagedQty,
        from_location: `floor_${line.floor_number}`,
        to_location: "write_off",
        reference_type: "fo_prepare_damaged",
        reference_id: batchId,
        floor_number: line.floor_number,
        performed_by: actorName,
        note: itemNote ?? note ?? "FO prepare damaged/write-off",
        created_at: nowIso,
      });
      if (damagedTxError) throw new Error(damagedTxError.message);
    }

    const existingReturnRow = returnRowsByProduct.get(line.product_id);
    returnRowsByProduct.set(line.product_id, {
      product_id: line.product_id,
      prepared_qty: (existingReturnRow?.prepared_qty ?? 0) + line.prepared_qty,
      returned_qty: (existingReturnRow?.returned_qty ?? 0) + returnQty,
      damaged_qty: (existingReturnRow?.damaged_qty ?? 0) + damagedQty,
      note: [existingReturnRow?.note, itemNote ?? note].filter(Boolean).join(" | ") || null,
    });

    const { error: itemUpdateError } = await supabase
      .from("fo_prepare_batch_items")
      .update({
        used_qty: line.used_qty,
        remaining_qty: Math.max(line.suggested_remaining - returnQty - damagedQty, 0),
        returned_qty: returnQty,
        return_note: itemNote ?? line.return_note,
        updated_at: nowIso,
      })
      .eq("id", line.id);
    if (itemUpdateError) throw new Error(itemUpdateError.message);

    totalReturned += returnQty;
    totalDamaged += damagedQty;
    processedCount += 1;
  }

  if (returnRowsByProduct.size > 0) {
    const returnRows = Array.from(returnRowsByProduct.values()).map((row) => ({
      batch_id: batchId,
      product_id: row.product_id,
      // Current DB constraint requires returned + damaged <= prepared.
      // EOD can legitimately return more than FO prepared when Maid app
      // sends guest-returned stock back to the floor during the same day.
      prepared_qty: Math.max(row.prepared_qty, row.returned_qty + row.damaged_qty),
      returned_qty: row.returned_qty,
      damaged_qty: row.damaged_qty,
      note: row.note,
      recorded_by: recordedBy,
      recorded_at: nowIso,
    }));

    const { error: returnRowsError } = await supabase
      .from("fo_prepare_batch_returns")
      .insert(returnRows);
    if (returnRowsError) throw new Error(returnRowsError.message);
  }

  const { error: batchUpdateError } = await supabase
    .from("fo_prepare_batches")
    .update({
      status: "returned",
      return_status: "reconciled",
      returned_at: nowIso,
      returned_by: actorName,
      return_note: note,
      return_override_note: body.force ? body.override_note?.trim() || null : null,
      updated_at: nowIso,
    })
    .eq("id", batchId)
    .eq("status", "prepared");
  if (batchUpdateError) throw new Error(batchUpdateError.message);

  return {
    batch_id: batchId,
    item_count: processedCount,
    returned_count: processedCount,
    total_returned: totalReturned,
    total_damaged: totalDamaged,
    total_consumed: 0,
  };
}

export const dynamic = "force-dynamic";
export const fetchCache = "force-no-store";

export async function GET(
  request: NextRequest,
  { params }: { params: { batchId: string } }
) {
  try {
    const parsedParams = paramsSchema.safeParse(params);
    if (!parsedParams.success) {
      return NextResponse.json(
        { success: false, error: parsedParams.error.issues[0]?.message ?? "Invalid batch id" },
        { status: 400 }
      );
    }

    const { supabase } = await requireFoPrepareAccess(request);
    const detail = await getFoPrepareBatchDetail(supabase as any, parsedParams.data.batchId);
    if (!detail) {
      return NextResponse.json({ success: false, error: "Batch not found." }, { status: 404 });
    }

    const { data: returnRows, error } = await supabase
      .from("fo_prepare_batch_returns")
      .select("id, batch_id, product_id, prepared_qty, returned_qty, damaged_qty, consumed_qty, note, recorded_by, recorded_at, products(name)")
      .eq("batch_id", parsedParams.data.batchId)
      .order("recorded_at", { ascending: false });

    if (error) {
      return NextResponse.json({ success: false, error: error.message }, { status: 500 });
    }

    return NextResponse.json({
      success: true,
      batch_id: parsedParams.data.batchId,
      status: detail.batch.return_status ?? (detail.batch.status === "returned" ? "legacy" : "pending"),
      batch_detail: detail,
      items: (returnRows ?? []).map((row: any) => ({
        id: String(row.id),
        batch_id: String(row.batch_id),
        product_id: String(row.product_id),
        product_name: String(row.products?.name ?? ""),
        prepared_qty: Number(row.prepared_qty ?? 0),
        returned_qty: Number(row.returned_qty ?? 0),
        damaged_qty: Number(row.damaged_qty ?? 0),
        consumed_qty: Number(row.consumed_qty ?? 0),
        note: row.note ?? null,
        recorded_by: row.recorded_by ?? null,
        recorded_at: String(row.recorded_at ?? ""),
      })),
    });
  } catch (err) {
    console.error("stock/fo-prepare/[batchId]/return GET failed", err);
    const { status, message } = amenityReconApiError(err);
    return NextResponse.json({ success: false, error: message }, { status });
  }
}

export async function POST(
  request: NextRequest,
  { params }: { params: { batchId: string } }
) {
  try {
    const parsedParams = paramsSchema.safeParse(params);
    if (!parsedParams.success) {
      return NextResponse.json(
        { success: false, error: parsedParams.error.issues[0]?.message ?? "Invalid batch id" },
        { status: 400 }
      );
    }

    const json = await request.json().catch(() => null);
    const parsedBody = returnPayloadSchema.safeParse(json);
    if (!parsedBody.success) {
      return NextResponse.json(
        { success: false, error: "Invalid payload.", details: parsedBody.error.flatten() },
        { status: 400 }
      );
    }

    const { supabase, actor } = await requireFoPrepareAccess(request);
    const detail = await getFoPrepareBatchDetail(supabase as any, parsedParams.data.batchId);
    if (!detail) {
      return NextResponse.json({ success: false, error: "Batch not found." }, { status: 404 });
    }
    if (detail.batch.status !== "prepared") {
      return NextResponse.json(
        { success: false, error: `Batch status must be prepared (current: ${detail.batch.status})` },
        { status: 409 }
      );
    }

    const body = parsedBody.data;
    const expectedItems = detail.items.filter((item) => item.prepared_qty > 0);
    // Recovery path for legacy/empty batches where prepared_qty ended up 0 for all items.
    // Nothing needs to move back to main stock, so we close the batch directly.
    if (expectedItems.length === 0) {
      const nowIso = new Date().toISOString();
      const { error: closeError } = await supabase
        .from("fo_prepare_batches")
        .update({
          status: "returned",
          returned_at: nowIso,
          returned_by: body.returned_by?.trim() || null,
          return_note: body.note?.trim() || "Auto-closed empty prepare batch (no prepared items).",
          return_override_note: body.force ? body.override_note?.trim() || null : null,
          return_status: "legacy",
          updated_at: nowIso,
        })
        .eq("id", parsedParams.data.batchId)
        .eq("status", "prepared");

      if (closeError) {
        return NextResponse.json({ success: false, error: closeError.message }, { status: 500 });
      }

      const updatedDetail = await getFoPrepareBatchDetail(supabase, parsedParams.data.batchId);
      return NextResponse.json({
        success: true,
        result: {
          batch_id: parsedParams.data.batchId,
          item_count: 0,
          returned_count: 0,
          total_returned: 0,
          auto_closed_empty_batch: true,
        },
        batch_detail: updatedDetail,
      });
    }

    const payloadIds = new Set(body.items.map((item) => item.item_id));
    if (payloadIds.size !== body.items.length) {
      return NextResponse.json(
        { success: false, error: "Duplicate item_id in return payload." },
        { status: 400 }
      );
    }
    if (expectedItems.length !== body.items.length) {
      return NextResponse.json(
        {
          success: false,
          error: `Return payload incomplete. Expected ${expectedItems.length} items, got ${body.items.length}.`,
        },
        { status: 400 }
      );
    }

    const expectedItemMap = new Map(expectedItems.map((item) => [item.id, item]));
    for (const payloadItem of body.items) {
      const expected = expectedItemMap.get(payloadItem.item_id);
      if (!expected) {
        return NextResponse.json(
          { success: false, error: `Invalid batch item: ${payloadItem.item_id}` },
          { status: 400 }
        );
      }
      if ((payloadItem.damaged_qty ?? 0) > 0 && !(payloadItem.note && payloadItem.note.trim().length > 0)) {
        return NextResponse.json(
          {
            success: false,
            error: `Damage note is required for ${expected.product_name} floor ${expected.floor_number}.`,
          },
          { status: 400 }
        );
      }
      const accountedQty = payloadItem.return_qty + (payloadItem.damaged_qty ?? 0);
      if (accountedQty < expected.suggested_remaining) {
        return NextResponse.json(
          {
            success: false,
            error: `End-of-day return must clear all floor stock for ${expected.product_name} floor ${expected.floor_number}.`,
          },
          { status: 400 }
        );
      }
      if (accountedQty > expected.suggested_remaining && !(payloadItem.note && payloadItem.note.trim().length > 0)) {
        return NextResponse.json(
          {
            success: false,
            error: `Reason is required when return/damaged qty exceeds system floor stock for ${expected.product_name} floor ${expected.floor_number}.`,
          },
          { status: 400 }
        );
      }
    }

    const canReturn = await checkFoCanReturn(supabase, detail.batch.business_date);
    if (!canReturn.all_rooms_finished && !body.force) {
      return NextResponse.json(
        {
          success: false,
          error: "Not all rooms are finished for this business date.",
          can_return: canReturn,
        },
        { status: 409 }
      );
    }

    if (body.force && !(body.override_note && body.override_note.trim().length > 0)) {
      return NextResponse.json(
        { success: false, error: "override_note is required when force=true." },
        { status: 400 }
      );
    }

    const result = await submitFoPrepareReturnInApp(
      supabase,
      parsedParams.data.batchId,
      detail,
      body,
      actor.userId ?? null
    );

    const updatedDetail = await getFoPrepareBatchDetail(supabase as any, parsedParams.data.batchId);
    return NextResponse.json({
      success: true,
      result,
      batch_detail: updatedDetail,
    });
  } catch (err) {
    console.error("stock/fo-prepare/[batchId]/return POST failed", err);
    const { status, message } = amenityReconApiError(err);
    return NextResponse.json({ success: false, error: message }, { status });
  }
}
