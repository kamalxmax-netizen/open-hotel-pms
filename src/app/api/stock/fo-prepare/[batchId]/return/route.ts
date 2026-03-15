import { checkFoCanReturn, getFoPrepareBatchDetail } from "@/lib/fo-prepare";
import { createServerSupabaseClient } from "@/lib/supabase/server";
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
        note: z.string().trim().max(500).optional(),
      })
    )
    .default([]),
});

function isFoReturnRpcMissing(error: { code?: string | null; message?: string | null } | null): boolean {
  const msg = String(error?.message ?? "").toLowerCase();
  return (
    error?.code === "42883" ||
    msg.includes("could not find the function") ||
    msg.includes("fo_return_daily_stock") ||
    msg.includes("schema cache")
  );
}

export const dynamic = "force-dynamic";
export const fetchCache = "force-no-store";

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

    const supabase = createServerSupabaseClient();
    const detail = await getFoPrepareBatchDetail(supabase, parsedParams.data.batchId);
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
      if (payloadItem.return_qty > expected.prepared_qty) {
        return NextResponse.json(
          {
            success: false,
            error: `Return qty exceeds prepared qty for ${expected.product_name} floor ${expected.floor_number}.`,
          },
          { status: 400 }
        );
      }
      if (
        payloadItem.return_qty !== expected.suggested_remaining &&
        !(payloadItem.note && payloadItem.note.trim().length > 0)
      ) {
        return NextResponse.json(
          {
            success: false,
            error: `Note is required when return qty differs from system remaining for ${expected.product_name} floor ${expected.floor_number}.`,
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

    const { data: rpcData, error: rpcError } = await supabase.rpc("fo_return_daily_stock", {
      p_batch_id: parsedParams.data.batchId,
      p_returned_by: body.returned_by?.trim() || null,
      p_return_note: body.note?.trim() || null,
      p_items: body.items.map((item) => ({
        item_id: item.item_id,
        return_qty: item.return_qty,
        note: item.note?.trim() || null,
      })),
      p_force: body.force ?? false,
      p_override_note: body.override_note?.trim() || null,
    });

    if (rpcError) {
      if (isFoReturnRpcMissing(rpcError)) {
        return NextResponse.json(
          {
            success: false,
            error:
              "FO return flow requires latest DB migration. Please apply migration 20260302_phase10_fo_prepare_flow.sql and reload schema.",
            details: rpcError.message,
          },
          { status: 500 }
        );
      }
      const message = String(rpcError.message ?? "FO return failed.");
      const statusCode =
        message.toLowerCase().includes("status must be prepared") ||
        message.toLowerCase().includes("incomplete")
          ? 409
          : 400;
      return NextResponse.json({ success: false, error: message }, { status: statusCode });
    }

    const updatedDetail = await getFoPrepareBatchDetail(supabase, parsedParams.data.batchId);
    return NextResponse.json({
      success: true,
      result: rpcData,
      batch_detail: updatedDetail,
    });
  } catch (err) {
    console.error("stock/fo-prepare/[batchId]/return POST failed", err);
    const message = err instanceof Error ? err.message : "Internal server error";
    return NextResponse.json({ success: false, error: message }, { status: 500 });
  }
}
