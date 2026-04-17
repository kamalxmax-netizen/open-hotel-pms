import type { SupabaseClient } from "@supabase/supabase-js";
import { getLaundryBatchDetail, LinenBatchError } from "@/lib/linen/batch-service";
import { getMonthlyCloseStatus } from "@/lib/linen/monthly";
import type { LinenBatchEditChange } from "@/lib/types";

const ITEM_FIELDS = new Set(["estimated_qty", "sent_by_hotel", "received_back", "damaged_qty"]);
const REWASH_FIELDS = new Set(["qty", "resolved_qty", "note", "status"]);

function valuesEqual(current: unknown, expected: string) {
  return String(current ?? "") === String(expected ?? "");
}

async function assertMonthEditable(supabase: SupabaseClient, businessDate: string) {
  const [year, month] = businessDate.split("-").map(Number);
  const close = await getMonthlyCloseStatus(supabase, year, month);
  if (close.closed) {
    throw new LinenBatchError("This linen month is closed. Reopen the month before editing.", 403);
  }
}

export async function editLaundryBatchWithAudit(
  supabase: SupabaseClient,
  input: {
    batchId: string;
    changes: LinenBatchEditChange[];
    reason?: string | null;
    actorUserId: string;
  }
) {
  if (!Array.isArray(input.changes) || input.changes.length === 0) {
    throw new LinenBatchError("changes are required.", 400);
  }

  const detail = await getLaundryBatchDetail(supabase, input.batchId);
  await assertMonthEditable(supabase, String((detail.batch as any).business_date));

  const auditIds: number[] = [];
  for (const change of input.changes) {
    let oldValue: unknown;

    if (change.entity_type === "batch_item" || change.entity_type === "return_item" || change.entity_type === "extra_item") {
      if (!change.entity_id || !ITEM_FIELDS.has(change.field_name)) {
        throw new LinenBatchError("Invalid batch item edit.", 400);
      }
      const { data: row, error: readError } = await supabase
        .from("laundry_batch_items")
        .select(`id, ${change.field_name}`)
        .eq("id", change.entity_id)
        .eq("batch_id", input.batchId)
        .maybeSingle();
      if (readError) throw new Error(readError.message);
      if (!row) throw new LinenBatchError("Batch item not found.", 404);
      oldValue = (row as any)[change.field_name];
      if (!valuesEqual(oldValue, change.old_value)) throw new LinenBatchError("Stale value. Refresh and try again.", 409);

      const numericValue = Number(change.new_value);
      if (!Number.isFinite(numericValue) || numericValue < 0) throw new LinenBatchError("Invalid numeric value.", 400);
      const { error: updateError } = await supabase
        .from("laundry_batch_items")
        .update({ [change.field_name]: Math.round(numericValue) })
        .eq("id", change.entity_id);
      if (updateError) throw new Error(updateError.message);
    } else if (change.entity_type === "rewash_event") {
      if (!change.entity_id || !REWASH_FIELDS.has(change.field_name)) {
        throw new LinenBatchError("Invalid rewash edit.", 400);
      }
      const { data: row, error: readError } = await supabase
        .from("laundry_rewash_events")
        .select(`id, ${change.field_name}`)
        .eq("id", change.entity_id)
        .eq("sent_in_batch_id", input.batchId)
        .maybeSingle();
      if (readError) throw new Error(readError.message);
      if (!row) throw new LinenBatchError("Rewash event not found.", 404);
      oldValue = (row as any)[change.field_name];
      if (!valuesEqual(oldValue, change.old_value)) throw new LinenBatchError("Stale value. Refresh and try again.", 409);

      const nextValue = change.field_name === "note" || change.field_name === "status"
        ? change.new_value
        : Math.round(Number(change.new_value));
      const { error: updateError } = await supabase
        .from("laundry_rewash_events")
        .update({ [change.field_name]: nextValue })
        .eq("id", change.entity_id);
      if (updateError) throw new Error(updateError.message);
    } else if (change.entity_type === "note") {
      oldValue = (detail.batch as any).notes ?? "";
      if (!valuesEqual(oldValue, change.old_value)) throw new LinenBatchError("Stale value. Refresh and try again.", 409);
      const { error: updateError } = await supabase
        .from("laundry_batches")
        .update({ notes: change.new_value || null })
        .eq("id", input.batchId);
      if (updateError) throw new Error(updateError.message);
    } else {
      throw new LinenBatchError("This edit type is not supported in Phase 66.3.", 400);
    }

    const { data: auditRow, error: auditError } = await supabase
      .from("linen_edit_audit_log")
      .insert({
        batch_id: input.batchId,
        entity_type: change.entity_type,
        entity_id: change.entity_id ?? null,
        field_name: change.field_name,
        old_value: String(oldValue ?? ""),
        new_value: change.new_value,
        reason: input.reason ?? null,
        edited_by: input.actorUserId,
      })
      .select("id")
      .single();
    if (auditError) throw new Error(auditError.message);
    auditIds.push(Number((auditRow as any).id));
  }

  await supabase.from("laundry_batch_events").insert({
    batch_id: input.batchId,
    event_type: "edit_applied",
    actor_role: "admin",
    data: { audit_log_ids: auditIds, change_count: input.changes.length },
  });

  return {
    updated_batch: await getLaundryBatchDetail(supabase, input.batchId),
    audit_log_ids: auditIds,
  };
}
