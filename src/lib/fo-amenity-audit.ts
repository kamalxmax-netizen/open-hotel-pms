import { createServerSupabaseClient } from "@/lib/supabase/server";

type SupabaseServerClient = ReturnType<typeof createServerSupabaseClient>;

const STOCK_FLOORS = [1, 2, 3] as const;

export type AmenityAuditStatus = "ok" | "stale" | "never";

export type AmenityAuditFloorStatus = {
  floor_number: number;
  last_audit_at: string | null;
  last_audit_days_ago: number | null;
  status: AmenityAuditStatus;
};

function toNumber(value: unknown): number {
  return Number(value ?? 0) || 0;
}

function todayBangkok(): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Bangkok" }).format(new Date());
}

function daysAgoFromBangkokDate(value: string | null | undefined): number | null {
  if (!value) return null;
  const today = new Date(`${todayBangkok()}T12:00:00.000Z`);
  const then = new Date(`${String(value).slice(0, 10)}T12:00:00.000Z`);
  if (Number.isNaN(then.getTime())) return null;
  return Math.max(Math.floor((today.getTime() - then.getTime()) / 86_400_000), 0);
}

export async function ensureAmenityDirectFloorStock(
  supabase: SupabaseServerClient,
  floorNumber: number
): Promise<void> {
  const { data: products, error } = await supabase
    .from("products")
    .select("id")
    .eq("is_active", true)
    .eq("stock_tracking_mode", "amenity_direct");

  if (error) throw new Error(error.message);

  const nowIso = new Date().toISOString();
  const rows = ((products ?? []) as any[])
    .map((row) => String(row.id ?? ""))
    .filter(Boolean)
    .map((productId) => ({
      floor_number: floorNumber,
      product_id: productId,
      quantity: 0,
      updated_at: nowIso,
    }));

  if (rows.length === 0) return;

  const { error: upsertError } = await supabase
    .from("floor_stock")
    .upsert(rows, { onConflict: "floor_number,product_id", ignoreDuplicates: true });

  if (upsertError) throw new Error(upsertError.message);
}

export async function listAmenityAuditProducts(supabase: SupabaseServerClient, floorNumber: number) {
  await ensureAmenityDirectFloorStock(supabase, floorNumber);

  const [{ data: productRows, error: productError }, { data: floorRows, error: floorError }, status] =
    await Promise.all([
      supabase
        .from("products")
        .select("id, name, unit, display_order")
        .eq("is_active", true)
        .eq("stock_tracking_mode", "amenity_direct")
        .order("display_order", { ascending: true })
        .order("name", { ascending: true }),
      supabase
        .from("floor_stock")
        .select("product_id, quantity")
        .eq("floor_number", floorNumber),
      getAmenityAuditStatus(supabase),
    ]);

  if (productError) throw new Error(productError.message);
  if (floorError) throw new Error(floorError.message);

  const stockByProduct = new Map(
    ((floorRows ?? []) as any[]).map((row) => [String(row.product_id), toNumber(row.quantity)])
  );
  const floorStatus = status.floors.find((floor) => floor.floor_number === floorNumber);

  return ((productRows ?? []) as any[]).map((row) => ({
    product_id: String(row.id),
    product_name: String(row.name ?? ""),
    unit: String(row.unit ?? "pcs"),
    system_qty: stockByProduct.get(String(row.id)) ?? 0,
    last_audit_at: floorStatus?.last_audit_at ?? null,
    last_audit_days_ago: floorStatus?.last_audit_days_ago ?? null,
  }));
}

export async function submitAmenityAuditSession(
  supabase: SupabaseServerClient,
  payload: {
    business_date?: string;
    floor_number: number;
    audited_by: string;
    audited_by_user_id?: string | null;
    session_note?: string | null;
    items: Array<{
      product_id: string;
      system_qty_before: number;
      physical_qty: number;
      refill_to: number;
      item_note?: string | null;
    }>;
  }
) {
  const { data, error } = await supabase.rpc("fo_amenity_audit_submit", {
    p_payload: payload,
  });

  if (error) {
    const message = String(error.message ?? "");
    if (message.includes("STOCK_CONFLICT")) {
      const match = message.match(/product_id=([0-9a-f-]+)\s+system_qty_submitted=(\d+)\s+system_qty_now=(\d+)/i);
      const staleItem = match
        ? {
            product_id: match[1],
            system_qty_submitted: Number(match[2]),
            system_qty_now: Number(match[3]),
          }
        : null;
      const conflict = new Error("Stock changed during audit. Please refresh and resubmit.");
      (conflict as any).code = "STOCK_CONFLICT";
      (conflict as any).stale_items = staleItem ? [staleItem] : [];
      throw conflict;
    }
    throw new Error(message);
  }

  return data as {
    session_id: string;
    items_count: number;
    total_overclick: number;
    total_underclick: number;
    total_refill: number;
  };
}

export async function listAmenityAuditSessions(
  supabase: SupabaseServerClient,
  options: { limit?: number; floorNumber?: number } = {}
) {
  const limit = Math.min(Math.max(options.limit ?? 50, 1), 200);
  let query = supabase
    .from("fo_amenity_audit_sessions")
    .select("*")
    .order("submitted_at", { ascending: false })
    .limit(limit);

  if (options.floorNumber) query = query.eq("floor_number", options.floorNumber);

  const { data, error } = await query;
  if (error) throw new Error(error.message);
  return (data ?? []).map((row: any) => ({
    id: row.id,
    business_date: row.business_date,
    floor_number: toNumber(row.floor_number),
    audited_by: row.audited_by,
    audited_by_user_id: row.audited_by_user_id ?? null,
    session_note: row.session_note ?? null,
    total_items: toNumber(row.total_items),
    total_overclick_units: toNumber(row.total_overclick_units),
    total_underclick_units: toNumber(row.total_underclick_units),
    total_refill_units: toNumber(row.total_refill_units),
    submitted_at: row.submitted_at,
    created_at: row.created_at,
  }));
}

export async function getAmenityAuditSession(supabase: SupabaseServerClient, sessionId: string) {
  const [{ data: session, error: sessionError }, { data: items, error: itemsError }] = await Promise.all([
    supabase
      .from("fo_amenity_audit_sessions")
      .select("*")
      .eq("id", sessionId)
      .maybeSingle(),
    supabase
      .from("fo_amenity_audit_items")
      .select("*")
      .eq("session_id", sessionId)
      .order("product_name", { ascending: true }),
  ]);

  if (sessionError) throw new Error(sessionError.message);
  if (itemsError) throw new Error(itemsError.message);
  if (!session) return null;

  return {
    session,
    items: (items ?? []).map((row: any) => ({
      id: row.id,
      session_id: row.session_id,
      product_id: row.product_id,
      product_name: row.product_name,
      system_qty_before: toNumber(row.system_qty_before),
      physical_qty: toNumber(row.physical_qty),
      overclick_delta: toNumber(row.overclick_delta),
      refill_to: toNumber(row.refill_to),
      refill_delta: toNumber(row.refill_delta),
      item_note: row.item_note ?? null,
      correction_tx_id: row.correction_tx_id ?? null,
      refill_out_tx_id: row.refill_out_tx_id ?? null,
      refill_in_tx_id: row.refill_in_tx_id ?? null,
      created_at: row.created_at,
    })),
  };
}

export async function getAmenityAuditStatus(supabase: SupabaseServerClient): Promise<{
  warn_days_threshold: number;
  floors: AmenityAuditFloorStatus[];
  any_stale: boolean;
}> {
  const [{ data: settings, error: settingsError }, { data: sessions, error: sessionsError }] = await Promise.all([
    supabase
      .from("hotel_settings")
      .select("amenity_audit_warn_days")
      .eq("id", 1)
      .maybeSingle(),
    supabase
      .from("fo_amenity_audit_sessions")
      .select("floor_number, submitted_at")
      .order("submitted_at", { ascending: false })
      .limit(200),
  ]);

  if (settingsError) throw new Error(settingsError.message);
  if (sessionsError) throw new Error(sessionsError.message);

  const threshold = Math.min(Math.max(toNumber((settings as any)?.amenity_audit_warn_days) || 3, 1), 30);
  const latestByFloor = new Map<number, string>();
  for (const row of (sessions ?? []) as any[]) {
    const floor = toNumber(row.floor_number);
    if (!floor || latestByFloor.has(floor)) continue;
    latestByFloor.set(floor, String(row.submitted_at ?? ""));
  }

  const floors = STOCK_FLOORS.map((floorNumber) => {
    const lastAuditAt = latestByFloor.get(floorNumber) ?? null;
    const daysAgo = daysAgoFromBangkokDate(lastAuditAt);
    const status: AmenityAuditStatus =
      lastAuditAt == null ? "never" : daysAgo != null && daysAgo > threshold ? "stale" : "ok";
    return {
      floor_number: floorNumber,
      last_audit_at: lastAuditAt,
      last_audit_days_ago: daysAgo,
      status,
    };
  });

  return {
    warn_days_threshold: threshold,
    floors,
    any_stale: floors.some((floor) => floor.status === "stale" || floor.status === "never"),
  };
}
