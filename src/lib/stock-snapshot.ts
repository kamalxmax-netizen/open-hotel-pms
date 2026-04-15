import { createServerSupabaseClient } from "@/lib/supabase/server";
import { getAmenityAuditStatus } from "@/lib/fo-amenity-audit";

type SupabaseServerClient = ReturnType<typeof createServerSupabaseClient>;

export type StockTrackingMode = "pos_main_only" | "amenity_prepare" | "amenity_direct";
export type StockSnapshotSection = "pos" | "amenity_prepare" | "amenity_direct";
export type StockReconcileStatus = "pending" | "clean" | "acknowledged";

export type StockSnapshotRow = {
  id: string;
  business_date: string;
  product_id: string;
  product_name: string;
  category: string;
  tracking_mode: StockTrackingMode;
  opening_main: number;
  opening_floor: number;
  sold_qty: number;
  voided_qty: number;
  used_qty: number;
  hk_returned_qty: number;
  transferred_main_to_floor: number;
  transferred_floor_to_main: number;
  received_qty: number;
  adjusted_qty: number;
  audit_correction_qty: number;
  audit_refill_qty: number;
  expected_closing_main: number;
  expected_closing_floor: number;
  actual_closing_main: number;
  actual_closing_floor: number;
  variance_main: number;
  variance_floor: number;
  floor_breakdown: unknown[];
  computed_at: string;
  recomputed_count: number;
};

type SnapshotFilters = {
  dateFrom?: string;
  dateTo?: string;
  businessDate?: string;
  trackingMode?: StockTrackingMode | "all";
  category?: "pos" | "amenity" | "both" | "all";
};

export function isBusinessDate(value: string | null | undefined): value is string {
  return /^\d{4}-\d{2}-\d{2}$/.test(String(value ?? ""));
}

export function shiftBusinessDate(dateStr: string, diffDays: number): string {
  const date = new Date(`${dateStr}T12:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() + diffDays);
  return date.toISOString().slice(0, 10);
}

function toNumber(value: unknown): number {
  return Number(value ?? 0) || 0;
}

function normalizeSnapshot(row: any): StockSnapshotRow {
  return {
    id: String(row.id),
    business_date: String(row.business_date),
    product_id: String(row.product_id),
    product_name: String(row.product_name ?? ""),
    category: String(row.category ?? ""),
    tracking_mode: String(row.tracking_mode ?? "amenity_direct") as StockTrackingMode,
    opening_main: toNumber(row.opening_main),
    opening_floor: toNumber(row.opening_floor),
    sold_qty: toNumber(row.sold_qty),
    voided_qty: toNumber(row.voided_qty),
    used_qty: toNumber(row.used_qty),
    hk_returned_qty: toNumber(row.hk_returned_qty),
    transferred_main_to_floor: toNumber(row.transferred_main_to_floor),
    transferred_floor_to_main: toNumber(row.transferred_floor_to_main),
    received_qty: toNumber(row.received_qty),
    adjusted_qty: toNumber(row.adjusted_qty),
    audit_correction_qty: toNumber(row.audit_correction_qty),
    audit_refill_qty: toNumber(row.audit_refill_qty),
    expected_closing_main: toNumber(row.expected_closing_main),
    expected_closing_floor: toNumber(row.expected_closing_floor),
    actual_closing_main: toNumber(row.actual_closing_main),
    actual_closing_floor: toNumber(row.actual_closing_floor),
    variance_main: toNumber(row.variance_main),
    variance_floor: toNumber(row.variance_floor),
    floor_breakdown: Array.isArray(row.floor_breakdown) ? row.floor_breakdown : [],
    computed_at: String(row.computed_at ?? ""),
    recomputed_count: toNumber(row.recomputed_count),
  };
}

export async function getCurrentBusinessDate(supabase: SupabaseServerClient): Promise<string> {
  const { data, error } = await supabase
    .from("hotel_settings")
    .select("business_date")
    .eq("id", 1)
    .maybeSingle();

  if (error) throw new Error(error.message);
  const businessDate = String((data as any)?.business_date ?? "");
  if (isBusinessDate(businessDate)) return businessDate;

  const now = new Date();
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Bangkok" }).format(now);
}

export async function computeStockSnapshot(supabase: SupabaseServerClient, businessDate: string) {
  const { data, error } = await supabase.rpc("compute_stock_snapshot", {
    p_business_date: businessDate,
  });

  if (error) throw new Error(error.message);
  return data as { products_computed: number; variance_count: number; clean_count: number };
}

export async function listStockSnapshots(supabase: SupabaseServerClient, filters: SnapshotFilters) {
  let query = supabase
    .from("stock_daily_snapshots")
    .select("*")
    .order("business_date", { ascending: false })
    .order("product_name", { ascending: true });

  if (filters.businessDate) query = query.eq("business_date", filters.businessDate);
  if (filters.dateFrom) query = query.gte("business_date", filters.dateFrom);
  if (filters.dateTo) query = query.lte("business_date", filters.dateTo);
  if (filters.trackingMode && filters.trackingMode !== "all") query = query.eq("tracking_mode", filters.trackingMode);
  if (filters.category && filters.category !== "all") query = query.eq("category", filters.category);

  const { data, error } = await query;
  if (error) throw new Error(error.message);
  return ((data ?? []) as any[]).map(normalizeSnapshot);
}

export async function getDailySnapshotMeta(supabase: SupabaseServerClient, businessDate: string) {
  const { data, error } = await supabase
    .from("daily_snapshots")
    .select("business_date, stock_total_products, stock_variance_count, stock_reconcile_status, stock_reconcile_note, stock_reconcile_ack, stock_computed_at")
    .eq("business_date", businessDate)
    .maybeSingle();

  if (error) throw new Error(error.message);
  return (data as any) ?? null;
}

export async function getStockSnapshotDetail(
  supabase: SupabaseServerClient,
  businessDate: string,
  filters: Pick<SnapshotFilters, "trackingMode" | "category"> = {}
) {
  const [snapshots, meta] = await Promise.all([
    listStockSnapshots(supabase, { businessDate, ...filters }),
    getDailySnapshotMeta(supabase, businessDate),
  ]);

  const varianceCount = snapshots.filter((row) => row.variance_main !== 0 || row.variance_floor !== 0).length;
  return {
    business_date: businessDate,
    summary: {
      total_products: snapshots.length,
      clean_count: Math.max(snapshots.length - varianceCount, 0),
      variance_count: varianceCount,
      reconcile_status: String(meta?.stock_reconcile_status ?? "pending") as StockReconcileStatus,
      reconcile_note: meta?.stock_reconcile_note ?? null,
      reconciled_at: extractLatestAck(meta?.stock_reconcile_ack)?.acknowledged_at ?? null,
      reconciled_by: extractLatestAck(meta?.stock_reconcile_ack)?.acknowledged_by ?? null,
      stock_computed_at: meta?.stock_computed_at ?? null,
      acknowledgments: meta?.stock_reconcile_ack ?? {},
    },
    snapshots,
  };
}

function extractLatestAck(ack: any) {
  const entries = Object.values((ack ?? {}) as Record<string, any>).filter((value: any) => value?.acknowledged_at);
  entries.sort((a: any, b: any) => String(b.acknowledged_at).localeCompare(String(a.acknowledged_at)));
  return (entries[0] as any) ?? null;
}

export async function getProductSnapshotTransactions(
  supabase: SupabaseServerClient,
  businessDate: string,
  productId: string
) {
  const { data, error } = await supabase
    .from("stock_transactions_v2")
    .select("id, transaction_date, product_id, action, quantity_change, from_location, to_location, reference_type, reference_id, room_number, floor_number, performed_by, note, created_at")
    .eq("transaction_date", businessDate)
    .eq("product_id", productId)
    .order("created_at", { ascending: true });

  if (error) throw new Error(error.message);
  return (data ?? []).map((row: any) => ({
    ...row,
    quantity_change: toNumber(row.quantity_change),
    floor_number: row.floor_number == null ? null : toNumber(row.floor_number),
  }));
}

export async function getStockReconcileStatus(supabase: SupabaseServerClient, businessDate: string) {
  const [detail, prepareResult, amenityStatus] = await Promise.all([
    getStockSnapshotDetail(supabase, businessDate),
    supabase
      .from("fo_prepare_batches")
      .select("id")
      .eq("business_date", businessDate)
      .eq("status", "prepared"),
    getAmenityAuditStatus(supabase),
  ]);

  if (prepareResult.error) throw new Error(prepareResult.error.message);

  const posRows = detail.snapshots.filter((row) => row.tracking_mode === "pos_main_only");
  const posVarianceCount = posRows.filter((row) => row.variance_main !== 0 || row.variance_floor !== 0).length;
  const pendingBatchIds = ((prepareResult.data ?? []) as any[]).map((row) => String(row.id)).filter(Boolean);
  const staleFloors = amenityStatus.floors
    .filter((floor) => floor.status === "stale" || floor.status === "never")
    .map((floor) => ({
      floor: floor.floor_number,
      days_ago: floor.last_audit_days_ago,
    }));

  const acknowledgments = (detail.summary.acknowledgments ?? {}) as Partial<Record<StockSnapshotSection, any>>;

  // Only the sections that actually have a variance/pending/stale condition need an
  // explicit acknowledgment. A section that was clean from the start should not
  // require a user click to pass the Night Audit gate.
  //
  // Phase 65 hotfix 2026-04-15 — previous logic required ack entries for all three
  // sections which left the "Next" button permanently disabled whenever any section
  // was already clean (because clean sections never get acked).
  const sectionsNeedingAck: StockSnapshotSection[] = [];
  if (posVarianceCount > 0) sectionsNeedingAck.push("pos");
  if (pendingBatchIds.length > 0) sectionsNeedingAck.push("amenity_prepare");
  if (staleFloors.length > 0) sectionsNeedingAck.push("amenity_direct");

  const needsAck = sectionsNeedingAck.length > 0;
  const allRequiredSectionsAcked = sectionsNeedingAck.every(
    (section) => !!acknowledgments[section]
  );

  const overallStatus: "clean" | "needs_ack" | "acknowledged" = !needsAck
    ? "clean"
    : allRequiredSectionsAcked
      ? "acknowledged"
      : "needs_ack";

  return {
    success: true,
    business_date: businessDate,
    pos: {
      variance_count: posVarianceCount,
      total_products: posRows.length,
      status: posVarianceCount > 0 ? "has_variance" : "clean",
    },
    amenity_prepare: {
      pending_batches: pendingBatchIds.length,
      status: pendingBatchIds.length > 0 ? "has_pending" : "clean",
      batch_ids: pendingBatchIds,
    },
    amenity_direct: {
      stale_floors: staleFloors,
      status: staleFloors.length > 0 ? "stale" : "clean",
      warn_days_threshold: amenityStatus.warn_days_threshold,
    },
    overall_status: overallStatus,
    sections_needing_ack: sectionsNeedingAck,
    acknowledgments: {
      pos: acknowledgments.pos ?? null,
      amenity_prepare: acknowledgments.amenity_prepare ?? null,
      amenity_direct: acknowledgments.amenity_direct ?? null,
    },
  };
}

export async function acknowledgeStockReconcileSection(
  supabase: SupabaseServerClient,
  params: {
    businessDate: string;
    section: StockSnapshotSection;
    note: string | null;
    status: "clean" | "acknowledged";
    acknowledgedBy: string;
    acknowledgedByUserId: string | null;
  }
) {
  const acknowledgedAt = new Date().toISOString();
  const payload = {
    status: params.status,
    note: params.note ?? "",
    acknowledged_by: params.acknowledgedBy,
    acknowledged_by_user_id: params.acknowledgedByUserId,
    acknowledged_at: acknowledgedAt,
  };

  const { data, error } = await supabase.rpc("acknowledge_stock_reconcile_section", {
    p_business_date: params.businessDate,
    p_section: params.section,
    p_payload: payload,
  });

  if (error) throw new Error(error.message);
  return data as {
    acknowledged_at: string;
    acknowledged_by: string;
    all_sections_acked: boolean;
    acknowledgment: typeof payload;
  };
}
