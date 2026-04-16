import type { SupabaseClient } from "@supabase/supabase-js";
import type { LaundryBatchStatus } from "@/lib/types";
import {
  applyReturnsToSourceBatches,
  resolvePendingItems,
  type PendingResolveInput,
  type ReturnItemInput,
} from "@/lib/linen/pending-service";

export class LinenBatchError extends Error {
  status: number;

  constructor(message: string, status = 400) {
    super(message);
    this.status = status;
  }
}

export type CreateBatchItemInput = {
  linen_item_id: number;
  is_dayuse?: boolean;
  estimated_qty: number;
  sent_by_hotel: number;
};

export type CreateBatchInput = {
  business_date: string;
  pickup_round: number;
  vendor_name?: string | null;
  created_by?: string | null;
  items: CreateBatchItemInput[];
};

export type StepInput = {
  step: "fo_return_counted" | "vendor_signed" | "fo_return_signed";
  actor_name?: string | null;
  vendor_name?: string | null;
  return_items?: ReturnItemInput[];
  pending_resolved?: PendingResolveInput[];
};

const VALID_TRANSITIONS: Record<LaundryBatchStatus, LaundryBatchStatus[]> = {
  draft: ["fo_dirty_counted"],
  fo_dirty_counted: ["fo_return_counted"],
  fo_return_counted: ["vendor_signed"],
  vendor_signed: ["fo_return_signed"],
  fo_return_signed: ["closed", "partial", "disputed"],
  closed: [],
  partial: ["disputed"],
  disputed: ["fo_dirty_counted"],
};

function assertDate(value: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) throw new LinenBatchError("Invalid business_date.", 400);
}

function assertCanTransition(from: LaundryBatchStatus, to: LaundryBatchStatus) {
  if (!VALID_TRANSITIONS[from]?.includes(to)) {
    throw new LinenBatchError(`Invalid status transition: ${from} -> ${to}.`, 409);
  }
}

async function logEvent(
  supabase: SupabaseClient,
  batchId: string,
  eventType: string,
  options: { actorName?: string | null; actorRole?: "fo" | "vendor" | "admin"; data?: Record<string, unknown> | null } = {}
) {
  const { error } = await supabase.from("laundry_batch_events").insert({
    batch_id: batchId,
    event_type: eventType,
    actor_name: options.actorName ?? null,
    actor_role: options.actorRole ?? null,
    data: options.data ?? null,
  });
  if (error) throw new Error(error.message);
}

export async function listLaundryBatches(
  supabase: SupabaseClient,
  options: { dateFrom?: string; dateTo?: string; status?: string | null } = {}
) {
  let query = supabase
    .from("laundry_batches")
    .select("*")
    .order("business_date", { ascending: false })
    .order("pickup_round", { ascending: false });

  if (options.dateFrom) query = query.gte("business_date", options.dateFrom);
  if (options.dateTo) query = query.lte("business_date", options.dateTo);
  if (options.status) query = query.eq("status", options.status);

  const { data, error } = await query;
  if (error) throw new Error(error.message);
  return data ?? [];
}

export async function getLaundryBatchDetail(supabase: SupabaseClient, batchId: string) {
  const { data: batch, error: batchError } = await supabase
    .from("laundry_batches")
    .select("*")
    .eq("id", batchId)
    .maybeSingle();
  if (batchError) throw new Error(batchError.message);
  if (!batch) throw new LinenBatchError("Batch not found.", 404);

  const [itemsRes, eventsRes, tokensRes, returnSourcesRes] = await Promise.all([
    supabase
      .from("laundry_batch_items")
      .select("*, linen_items(item_number, name_th)")
      .eq("batch_id", batchId)
      .order("is_dayuse", { ascending: true }),
    supabase.from("laundry_batch_events").select("*").eq("batch_id", batchId).order("created_at", { ascending: true }),
    supabase.from("laundry_vendor_tokens").select("*").eq("batch_id", batchId).order("created_at", { ascending: false }).limit(3),
    supabase
      .from("laundry_batch_items")
      .select("*, linen_items(item_number, name_th), laundry_batches!inner(id, business_date, pickup_round, status)")
      .neq("batch_id", batchId)
      .lte("laundry_batches.business_date", (batch as any).business_date),
  ]);
  if (itemsRes.error) throw new Error(itemsRes.error.message);
  if (eventsRes.error) throw new Error(eventsRes.error.message);
  if (tokensRes.error) throw new Error(tokensRes.error.message);
  if (returnSourcesRes.error) throw new Error(returnSourcesRes.error.message);

  const returnSources = (returnSourcesRes.data ?? [])
    .map((row: any) => {
      const sentQty = Number(row.sent_by_hotel ?? 0);
      const receivedQty = Number(row.received_back ?? 0);
      return {
        ...row,
        item_number: row.linen_items?.item_number,
        name_th: row.linen_items?.name_th,
        source_batch_id: row.laundry_batches?.id,
        source_business_date: row.laundry_batches?.business_date,
        source_pickup_round: row.laundry_batches?.pickup_round,
        remaining_qty: Math.max(0, sentQty - receivedQty),
      };
    })
    .filter((row: any) => row.remaining_qty > 0)
    .sort((a: any, b: any) => {
      const dateCompare = String(a.source_business_date).localeCompare(String(b.source_business_date));
      if (dateCompare !== 0) return dateCompare;
      return Number(a.source_pickup_round ?? 0) - Number(b.source_pickup_round ?? 0);
    });

  return {
    batch,
    items: (itemsRes.data ?? []).map((row: any) => ({
      ...row,
      item_number: row.linen_items?.item_number,
      name_th: row.linen_items?.name_th,
    })),
    events: eventsRes.data ?? [],
    tokens: tokensRes.data ?? [],
    return_sources: returnSources,
  };
}

export async function createLaundryBatch(supabase: SupabaseClient, input: CreateBatchInput) {
  assertDate(input.business_date);
  if (!Array.isArray(input.items) || input.items.length === 0) throw new LinenBatchError("items are required.", 400);

  const { data: batch, error: batchError } = await supabase
    .from("laundry_batches")
    .insert({
      business_date: input.business_date,
      pickup_round: input.pickup_round,
      vendor_name: input.vendor_name ?? null,
      status: "fo_dirty_counted",
      created_by: input.created_by ?? null,
    })
    .select()
    .single();
  if (batchError) throw new Error(batchError.message);

  const batchId = String((batch as any).id);
  const rows = input.items.map((item) => ({
    batch_id: batchId,
    linen_item_id: item.linen_item_id,
    is_dayuse: Boolean(item.is_dayuse),
    estimated_qty: item.estimated_qty,
    sent_by_hotel: item.sent_by_hotel,
  }));

  const { data: items, error: itemsError } = await supabase
    .from("laundry_batch_items")
    .insert(rows)
    .select();
  if (itemsError) throw new Error(itemsError.message);

  await logEvent(supabase, batchId, "created", { actorRole: "fo", data: { pickup_round: input.pickup_round } });
  await logEvent(supabase, batchId, "fo_dirty_counted", { actorRole: "fo", data: { item_count: rows.length } });

  return { batch, items: items ?? [] };
}

export async function advanceLaundryBatchStep(supabase: SupabaseClient, batchId: string, input: StepInput) {
  const detail = await getLaundryBatchDetail(supabase, batchId);
  const currentStatus = String((detail.batch as any).status) as LaundryBatchStatus;
  const nextStatus = input.step as LaundryBatchStatus;
  assertCanTransition(currentStatus, nextStatus);

  const updatePayload: Record<string, unknown> = { status: nextStatus };
  if (input.vendor_name !== undefined) updatePayload.vendor_name = input.vendor_name;

  let eventData: Record<string, unknown> = {};
  if (input.step === "fo_return_counted") {
    const returns = await applyReturnsToSourceBatches(supabase, batchId, input.return_items ?? []);
    const resolved = await resolvePendingItems(supabase, batchId, input.pending_resolved ?? []);
    eventData = { returns, resolved };
  }

  const { data: batch, error } = await supabase
    .from("laundry_batches")
    .update(updatePayload)
    .eq("id", batchId)
    .select()
    .single();
  if (error) throw new Error(error.message);

  await logEvent(supabase, batchId, input.step, {
    actorName: input.actor_name ?? null,
    actorRole: input.step === "vendor_signed" ? "vendor" : "fo",
    data: eventData,
  });

  return getLaundryBatchDetail(supabase, String((batch as any).id));
}

export async function reopenLaundryBatch(supabase: SupabaseClient, batchId: string, actorName?: string | null) {
  const detail = await getLaundryBatchDetail(supabase, batchId);
  const currentStatus = String((detail.batch as any).status) as LaundryBatchStatus;
  if (currentStatus === "draft") throw new LinenBatchError("Draft batch does not need reopen.", 409);

  const returnEvents = (detail.events as any[]).filter((event) => event.event_type === "fo_return_counted");
  for (const event of returnEvents) {
    const returns = Array.isArray(event.data?.returns) ? event.data.returns : [];
    for (const item of returns) {
      const { data: sourceItem, error: sourceError } = await supabase
        .from("laundry_batch_items")
        .select("id, received_back")
        .eq("batch_id", item.source_batch_id)
        .eq("linen_item_id", item.linen_item_id)
        .maybeSingle();
      if (sourceError) throw new Error(sourceError.message);
      if (!sourceItem) continue;

      const nextReceived = Math.max(0, Number((sourceItem as any).received_back ?? 0) - Number(item.received_qty ?? 0));
      const { error: rollbackError } = await supabase
        .from("laundry_batch_items")
        .update({ received_back: nextReceived })
        .eq("id", (sourceItem as any).id);
      if (rollbackError) throw new Error(rollbackError.message);
    }

    const resolved = Array.isArray(event.data?.resolved) ? event.data.resolved : [];
    for (const item of resolved) {
      const { data: sourceItem, error: sourceError } = await supabase
        .from("laundry_batch_items")
        .select("id, received_back")
        .eq("batch_id", item.source_batch_id)
        .eq("linen_item_id", item.linen_item_id)
        .maybeSingle();
      if (sourceError) throw new Error(sourceError.message);
      if (sourceItem) {
        const nextReceived = Math.max(0, Number((sourceItem as any).received_back ?? 0) - Number(item.qty ?? 0));
        const { error: rollbackError } = await supabase
          .from("laundry_batch_items")
          .update({ received_back: nextReceived })
          .eq("id", (sourceItem as any).id);
        if (rollbackError) throw new Error(rollbackError.message);
      }

      const { error: unresolveError } = await supabase
        .from("laundry_pending_items")
        .update({ resolved_batch_id: null, resolved_at: null })
        .eq("id", item.pending_item_id);
      if (unresolveError) throw new Error(unresolveError.message);
    }
  }

  const { error: pendingError } = await supabase
    .from("laundry_pending_items")
    .delete()
    .eq("created_by_batch_id", batchId)
    .is("resolved_at", null);
  if (pendingError) throw new Error(pendingError.message);

  await supabase.from("laundry_vendor_tokens").update({ revoked: true }).eq("batch_id", batchId);

  const { error } = await supabase
    .from("laundry_batches")
    .update({ status: "fo_dirty_counted" })
    .eq("id", batchId);
  if (error) throw new Error(error.message);

  await logEvent(supabase, batchId, "reopened", { actorName, actorRole: "admin", data: { previous_status: currentStatus } });
  return getLaundryBatchDetail(supabase, batchId);
}

export async function vendorConfirmBatch(supabase: SupabaseClient, batchId: string, actorName?: string | null) {
  const detail = await getLaundryBatchDetail(supabase, batchId);
  const currentStatus = String((detail.batch as any).status) as LaundryBatchStatus;
  assertCanTransition(currentStatus, "closed");

  const { count, error: pendingError } = await supabase
    .from("laundry_pending_items")
    .select("id", { count: "exact", head: true })
    .is("resolved_at", null);
  if (pendingError) throw new Error(pendingError.message);

  const nextStatus: LaundryBatchStatus = (count ?? 0) > 0 ? "partial" : "closed";
  const { error } = await supabase.from("laundry_batches").update({ status: nextStatus }).eq("id", batchId);
  if (error) throw new Error(error.message);

  await logEvent(supabase, batchId, "vendor_shop_confirmed", { actorName, actorRole: "vendor" });
  await logEvent(supabase, batchId, nextStatus === "closed" ? "closed" : "partial_closed", {
    actorName,
    actorRole: "vendor",
    data: { pending_count: count ?? 0 },
  });
  return getLaundryBatchDetail(supabase, batchId);
}

export async function vendorDisputeBatch(supabase: SupabaseClient, batchId: string, note?: string | null, actorName?: string | null) {
  const detail = await getLaundryBatchDetail(supabase, batchId);
  const currentStatus = String((detail.batch as any).status) as LaundryBatchStatus;
  assertCanTransition(currentStatus, "disputed");

  const { error } = await supabase.from("laundry_batches").update({ status: "disputed", notes: note ?? (detail.batch as any).notes }).eq("id", batchId);
  if (error) throw new Error(error.message);

  await logEvent(supabase, batchId, "disputed", { actorName, actorRole: "vendor", data: { note: note ?? null } });
  return getLaundryBatchDetail(supabase, batchId);
}
