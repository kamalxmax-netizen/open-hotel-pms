import type { SupabaseClient } from "@supabase/supabase-js";

export const DAYUSE_TOWEL_THRESHOLD = 30;

export async function getDayuseAccumulator(supabase: SupabaseClient, options: { includeSetupRows?: boolean } = {}) {
  const { data, error } = await supabase
    .from("linen_dayuse_pending")
    .select("*, linen_items(item_number, name_th)")
    .order("created_at", { ascending: true });
  if (error) throw new Error(error.message);
  const rows = (data ?? []).map((row: any) => ({
    ...row,
    item_number: row.linen_items?.item_number,
    name_th: row.linen_items?.name_th,
  }));

  if (!options.includeSetupRows) return rows;

  const { data: setupRows, error: setupError } = await supabase
    .from("linen_dayuse_setup")
    .select("linen_item_id, qty_per_room, linen_items(item_number, name_th)");
  if (setupError) throw new Error(setupError.message);

  const rowsByItem = new Map(rows.map((row: any) => [Number(row.linen_item_id), row]));
  for (const setup of setupRows ?? []) {
    const itemId = Number((setup as any).linen_item_id);
    if (rowsByItem.has(itemId)) continue;
    const linenItem = Array.isArray((setup as any).linen_items) ? (setup as any).linen_items[0] : (setup as any).linen_items;
    rows.push({
      id: `setup-${itemId}`,
      linen_item_id: itemId,
      qty_accumulated: 0,
      qty_per_room: Number((setup as any).qty_per_room ?? 0),
      last_added_date: null,
      sent_in_batch_id: null,
      sent_at: null,
      item_number: linenItem?.item_number,
      name_th: linenItem?.name_th,
    });
  }

  return rows.sort((a: any, b: any) => Number(a.item_number ?? 9999) - Number(b.item_number ?? 9999));
}

export async function addDayuseRoomsToAccumulator(
  supabase: SupabaseClient,
  params: { room_count: number; business_date: string }
) {
  const roomCount = Number(params.room_count);
  if (!Number.isInteger(roomCount) || roomCount <= 0) throw new Error("room_count must be a positive integer.");

  const { data: setupRows, error: setupError } = await supabase
    .from("linen_dayuse_setup")
    .select("linen_item_id, qty_per_room");
  if (setupError) throw new Error(setupError.message);

  for (const row of setupRows ?? []) {
    const delta = Number((row as any).qty_per_room ?? 0) * roomCount;
    if (delta <= 0) continue;

    const { data: existing, error: existingError } = await supabase
      .from("linen_dayuse_pending")
      .select("id, qty_accumulated")
      .eq("linen_item_id", (row as any).linen_item_id)
      .maybeSingle();
    if (existingError) throw new Error(existingError.message);

    if (existing) {
      const { error } = await supabase
        .from("linen_dayuse_pending")
        .update({
          qty_accumulated: Number((existing as any).qty_accumulated ?? 0) + delta,
          last_added_date: params.business_date,
          sent_in_batch_id: null,
          sent_at: null,
        })
        .eq("id", (existing as any).id);
      if (error) throw new Error(error.message);
    } else {
      const { error } = await supabase.from("linen_dayuse_pending").insert({
        linen_item_id: (row as any).linen_item_id,
        qty_accumulated: delta,
        last_added_date: params.business_date,
      });
      if (error) throw new Error(error.message);
    }
  }

  return getDayuseAccumulator(supabase);
}

export async function addAccumulatedDayuseToBatch(supabase: SupabaseClient, batchId: string) {
  const rows = await getDayuseAccumulator(supabase);
  const inserted = [];

  for (const row of rows) {
    const qty = Number(row.qty_accumulated ?? 0);
    if (qty <= 0) continue;

    const { data, error } = await supabase
      .from("laundry_batch_items")
      .upsert(
        {
          batch_id: batchId,
          linen_item_id: row.linen_item_id,
          is_dayuse: true,
          estimated_qty: qty,
          sent_by_hotel: qty,
        },
        { onConflict: "batch_id,linen_item_id,is_dayuse" }
      )
      .select()
      .single();
    if (error) throw new Error(error.message);

    const { error: resetError } = await supabase
      .from("linen_dayuse_pending")
      .update({
        qty_accumulated: 0,
        sent_in_batch_id: batchId,
        sent_at: new Date().toISOString(),
      })
      .eq("id", row.id);
    if (resetError) throw new Error(resetError.message);
    inserted.push(data);
  }

  return inserted;
}
