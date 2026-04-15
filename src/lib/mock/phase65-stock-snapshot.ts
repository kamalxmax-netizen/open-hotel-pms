// Mock data for Phase 65 — Stock Snapshot + FO Amenity Audit + Night Audit Reconcile
// Owner: Lead. Provided 2026-04-15 so Agent A can build UI in parallel with Agent B.
// To be removed once Agent B's endpoints are live.
//
// Covers:
//   - StockSnapshotResponse (clean day, variance day)
//   - AmenityAuditFloorStatus (fresh / stale)
//   - AmenityAuditSessionListRow[] + AmenityAuditSessionDetail
//   - StockReconcileStatus (all-clean, variance-with-ack-pending)
//   - AmenityAuditItemDisplay[] (as the "products to audit" form payload)

import type {
  AmenityAuditFloorStatus,
  AmenityAuditItemDisplay,
  AmenityAuditSessionDetail,
  AmenityAuditSessionListRow,
  ReconcileSection,
  StockReconcileStatus,
  StockSnapshotResponse,
  StockSnapshotRow,
  StockSnapshotSummary,
  StockSnapshotTxEntry,
} from "@/lib/types";

// ─── Helpers ─────────────────────────────────────────────────────────────────

const now = (offsetMinutes = 0) =>
  new Date(Date.now() - offsetMinutes * 60 * 1000).toISOString();

const todayBangkok = (offsetDays = 0): string => {
  const d = new Date();
  d.setDate(d.getDate() + offsetDays);
  return d.toLocaleDateString("en-CA", { timeZone: "Asia/Bangkok" });
};

// ─── Snapshot: clean day (no variance) ──────────────────────────────────────

export function mockStockSnapshotClean(businessDate = todayBangkok(-1)): StockSnapshotResponse {
  const rows: StockSnapshotRow[] = [
    // POS — Coke 325ml
    {
      product_id: "prod-coke-325",
      product_name: "Coke 325ml",
      category: "pos",
      tracking_mode: "pos_main_only",
      opening_main: 24,
      opening_floor: 0,
      sold_qty: 6,
      used_qty: 0,
      returned_qty: 0,
      refill_qty: 0,
      adjust_qty: 0,
      expected_closing_main: 18,
      expected_closing_floor: 0,
      actual_closing_main: 18,
      actual_closing_floor: 0,
      variance_main: 0,
      variance_floor: 0,
      status: "clean",
      floor_breakdown: [],
    },
    // POS — Water for Sale
    {
      product_id: "prod-water-sale",
      product_name: "Water for Sale 600ml",
      category: "pos",
      tracking_mode: "pos_main_only",
      opening_main: 40,
      opening_floor: 0,
      sold_qty: 5,
      used_qty: 0,
      returned_qty: 0,
      refill_qty: 0,
      adjust_qty: 0,
      expected_closing_main: 35,
      expected_closing_floor: 0,
      actual_closing_main: 35,
      actual_closing_floor: 0,
      variance_main: 0,
      variance_floor: 0,
      status: "clean",
      floor_breakdown: [],
    },
    // Amenity prepare — Water for Room
    {
      product_id: "prod-water-room",
      product_name: "Water for Room",
      category: "amenity",
      tracking_mode: "amenity_prepare",
      opening_main: 80,
      opening_floor: 30,
      sold_qty: 0,
      used_qty: 14,
      returned_qty: 2,
      refill_qty: 10,
      adjust_qty: 0,
      expected_closing_main: 70,
      expected_closing_floor: 28,
      actual_closing_main: 70,
      actual_closing_floor: 28,
      variance_main: 0,
      variance_floor: 0,
      status: "clean",
      floor_breakdown: [
        { floor_number: 1, opening: 10, used: 4, refilled: 3, adjust: 0, expected: 9, actual: 9, variance: 0 },
        { floor_number: 2, opening: 10, used: 5, refilled: 4, adjust: 0, expected: 9, actual: 9, variance: 0 },
        { floor_number: 3, opening: 10, used: 5, refilled: 3, adjust: 0, expected: 10, actual: 10, variance: 0 },
      ],
    },
    // Amenity direct — Soap
    {
      product_id: "prod-soap",
      product_name: "Soap Bar 25g",
      category: "amenity",
      tracking_mode: "amenity_direct",
      opening_main: 100,
      opening_floor: 15,
      sold_qty: 0,
      used_qty: 12,
      returned_qty: 0,
      refill_qty: 0,
      adjust_qty: 0,
      expected_closing_main: 100,
      expected_closing_floor: 3,
      actual_closing_main: 100,
      actual_closing_floor: 3,
      variance_main: 0,
      variance_floor: 0,
      status: "clean",
      floor_breakdown: [
        { floor_number: 1, opening: 5, used: 4, refilled: 0, adjust: 0, expected: 1, actual: 1, variance: 0 },
        { floor_number: 2, opening: 5, used: 4, refilled: 0, adjust: 0, expected: 1, actual: 1, variance: 0 },
        { floor_number: 3, opening: 5, used: 4, refilled: 0, adjust: 0, expected: 1, actual: 1, variance: 0 },
      ],
    },
  ];

  const summary: StockSnapshotSummary = {
    business_date: businessDate,
    total_products: rows.length,
    clean_count: rows.length,
    variance_count: 0,
    pos_variance_count: 0,
    amenity_prepare_variance_count: 0,
    amenity_direct_variance_count: 0,
    computed_at: now(5),
    recomputed_count: 1,
  };

  return { success: true, summary, rows };
}

// ─── Snapshot: variance day (POS -1, amenity_direct +5) ─────────────────────

export function mockStockSnapshotVariance(businessDate = todayBangkok(-1)): StockSnapshotResponse {
  const base = mockStockSnapshotClean(businessDate);

  // Coke 325: actual 17 vs expected 18 → -1 variance
  const cokeIdx = base.rows.findIndex((r) => r.product_id === "prod-coke-325");
  if (cokeIdx >= 0) {
    base.rows[cokeIdx] = {
      ...base.rows[cokeIdx],
      actual_closing_main: 17,
      variance_main: -1,
      status: "variance",
    };
  }

  // Soap: actual floor 8 vs expected 3 → +5 variance on floor 2 (underclick candidate)
  const soapIdx = base.rows.findIndex((r) => r.product_id === "prod-soap");
  if (soapIdx >= 0) {
    const soap = base.rows[soapIdx];
    base.rows[soapIdx] = {
      ...soap,
      actual_closing_floor: 8,
      variance_floor: 5,
      status: "variance",
      floor_breakdown: [
        { floor_number: 1, opening: 5, used: 4, refilled: 0, adjust: 0, expected: 1, actual: 1, variance: 0 },
        { floor_number: 2, opening: 5, used: 4, refilled: 0, adjust: 0, expected: 1, actual: 6, variance: 5 },
        { floor_number: 3, opening: 5, used: 4, refilled: 0, adjust: 0, expected: 1, actual: 1, variance: 0 },
      ],
    };
  }

  const variance_count = base.rows.filter((r) => r.status === "variance").length;

  base.summary = {
    ...base.summary,
    business_date: businessDate,
    clean_count: base.rows.length - variance_count,
    variance_count,
    pos_variance_count: base.rows.filter((r) => r.status === "variance" && r.category === "pos").length,
    amenity_prepare_variance_count: base.rows.filter(
      (r) => r.status === "variance" && r.tracking_mode === "amenity_prepare",
    ).length,
    amenity_direct_variance_count: base.rows.filter(
      (r) => r.status === "variance" && r.tracking_mode === "amenity_direct",
    ).length,
    recomputed_count: 2,
    computed_at: now(1),
  };

  return base;
}

// ─── Snapshot detail drawer — tx timeline for one product ───────────────────

export function mockStockSnapshotTxTimeline(productId: string): StockSnapshotTxEntry[] {
  if (productId === "prod-soap") {
    return [
      {
        tx_id: "tx-1",
        created_at: now(600),
        action: "hk_deduct",
        quantity_change: -4,
        reference_type: "hk_deduct",
        reference_id: "task-101",
        from_location: "floor_1",
        to_location: null,
        performed_by: "Maid May",
        note: "Room 105 checkout clean",
      },
      {
        tx_id: "tx-2",
        created_at: now(550),
        action: "hk_deduct",
        quantity_change: -4,
        reference_type: "hk_deduct",
        reference_id: "task-102",
        from_location: "floor_2",
        to_location: null,
        performed_by: "Maid Nok",
        note: "Room 201 checkout clean",
      },
      {
        tx_id: "tx-3",
        created_at: now(120),
        action: "adjust",
        quantity_change: 5,
        reference_type: "fo_amenity_audit_correction",
        reference_id: "audit-session-mock-1",
        from_location: null,
        to_location: "floor_2",
        performed_by: "FO Niran",
        note: "แม่บ้านกด [สบู่] เกิน 5 ชิ้น",
      },
    ];
  }
  return [];
}

// ─── Amenity Audit — floor picker status ────────────────────────────────────

export function mockAmenityAuditFloorStatuses(): AmenityAuditFloorStatus[] {
  return [
    {
      floor_number: 1,
      last_audit_at: now(60 * 24 * 2),
      days_since_last: 2,
      is_stale: false,
      warn_threshold_days: 3,
    },
    {
      floor_number: 2,
      last_audit_at: now(60 * 24 * 4),
      days_since_last: 4,
      is_stale: true,
      warn_threshold_days: 3,
    },
    {
      floor_number: 3,
      last_audit_at: null,
      days_since_last: null,
      is_stale: true,
      warn_threshold_days: 3,
    },
  ];
}

// ─── Amenity Audit — session list ───────────────────────────────────────────

export function mockAmenityAuditSessionList(): AmenityAuditSessionListRow[] {
  return [
    {
      session_id: "audit-session-mock-1",
      business_date: todayBangkok(-1),
      floor_number: 2,
      audited_by: "FO Niran",
      items_count: 3,
      total_overclick: 5,
      total_underclick: 0,
      total_refill: 40,
      session_note: "เติมให้พอ 3 วัน",
      created_at: now(60 * 24),
    },
    {
      session_id: "audit-session-mock-2",
      business_date: todayBangkok(-3),
      floor_number: 1,
      audited_by: "FO Ploy",
      items_count: 2,
      total_overclick: 0,
      total_underclick: 3,
      total_refill: 20,
      session_note: null,
      created_at: now(60 * 24 * 3),
    },
  ];
}

// ─── Amenity Audit — session detail ─────────────────────────────────────────

export function mockAmenityAuditSessionDetail(sessionId: string): AmenityAuditSessionDetail | null {
  if (sessionId !== "audit-session-mock-1") return null;

  return {
    session_id: "audit-session-mock-1",
    business_date: todayBangkok(-1),
    floor_number: 2,
    audited_by: "FO Niran",
    items_count: 3,
    total_overclick: 5,
    total_underclick: 0,
    total_refill: 40,
    session_note: "เติมให้พอ 3 วัน",
    created_at: now(60 * 24),
    items: [
      {
        product_id: "prod-soap",
        product_name: "Soap Bar 25g",
        system_qty_before: 5,
        physical_qty: 10,
        refill_to: 50,
        overclick_delta: 5,
        refill_delta: 40,
        system_adjust_delta: 45,
        needs_note: true,
        item_note: "แม่บ้านกด [สบู่] เกิน 5 ชิ้น",
        correction_tx_id: "tx-3",
        refill_main_tx_id: "tx-4",
        refill_floor_tx_id: "tx-5",
      },
      {
        product_id: "prod-shampoo",
        product_name: "Shampoo Sachet 15ml",
        system_qty_before: 8,
        physical_qty: 8,
        refill_to: 30,
        overclick_delta: 0,
        refill_delta: 22,
        system_adjust_delta: 22,
        needs_note: false,
        item_note: undefined,
        correction_tx_id: null,
        refill_main_tx_id: "tx-6",
        refill_floor_tx_id: "tx-7",
      },
      {
        product_id: "prod-toothbrush",
        product_name: "Toothbrush Kit",
        system_qty_before: 12,
        physical_qty: 12,
        refill_to: 20,
        overclick_delta: 0,
        refill_delta: 8,
        system_adjust_delta: 8,
        needs_note: false,
        item_note: undefined,
        correction_tx_id: null,
        refill_main_tx_id: "tx-8",
        refill_floor_tx_id: "tx-9",
      },
    ],
  };
}

// ─── Amenity Audit — "products to audit" form prefill for a floor ───────────

export function mockAmenityAuditProductsForFloor(floorNumber: number): AmenityAuditItemDisplay[] {
  // Pretend these are the `amenity_direct` products that have a floor_stock row for this floor.
  const base = [
    {
      product_id: "prod-soap",
      product_name: "Soap Bar 25g",
      system_qty_before: 5,
    },
    {
      product_id: "prod-shampoo",
      product_name: "Shampoo Sachet 15ml",
      system_qty_before: 8,
    },
    {
      product_id: "prod-toothbrush",
      product_name: "Toothbrush Kit",
      system_qty_before: 12,
    },
  ];

  // Form row starts with physical_qty = system_qty_before, refill_to = 0 (FO fills both).
  return base.map((p) => ({
    product_id: p.product_id,
    product_name: p.product_name,
    system_qty_before: p.system_qty_before + floorNumber * 0, // silence unused warning, real impl reads per floor
    physical_qty: p.system_qty_before,
    refill_to: p.system_qty_before,
    overclick_delta: 0,
    refill_delta: 0,
    system_adjust_delta: 0,
    needs_note: false,
    item_note: undefined,
  }));
}

// ─── Night Audit Stock Reconcile ────────────────────────────────────────────

export function mockStockReconcileAllClean(businessDate = todayBangkok()): StockReconcileStatus {
  const sections: ReconcileSection[] = [
    {
      key: "pos",
      label_en: "POS Stock",
      label_th: "สต๊อก POS",
      variance_count: 0,
      total_count: 12,
      status: "clean",
    },
    {
      key: "amenity_prepare",
      label_en: "Amenity Prepare (Water / Coffee)",
      label_th: "Amenity Prepare (น้ำ / กาแฟ)",
      variance_count: 0,
      total_count: 2,
      status: "clean",
    },
    {
      key: "amenity_direct",
      label_en: "Amenity Direct (Soap / Shampoo)",
      label_th: "Amenity Direct (สบู่ / แชมพู)",
      variance_count: 0,
      total_count: 6,
      status: "clean",
    },
  ];

  return {
    business_date: businessDate,
    sections,
    all_clean: true,
    all_acked: true,
    can_complete_night_audit: true,
  };
}

export function mockStockReconcileVarianceAckPending(
  businessDate = todayBangkok(),
): StockReconcileStatus {
  const sections: ReconcileSection[] = [
    {
      key: "pos",
      label_en: "POS Stock",
      label_th: "สต๊อก POS",
      variance_count: 1,
      total_count: 12,
      status: "pending",
    },
    {
      key: "amenity_prepare",
      label_en: "Amenity Prepare (Water / Coffee)",
      label_th: "Amenity Prepare (น้ำ / กาแฟ)",
      variance_count: 0,
      total_count: 2,
      status: "clean",
    },
    {
      key: "amenity_direct",
      label_en: "Amenity Direct (Soap / Shampoo)",
      label_th: "Amenity Direct (สบู่ / แชมพู)",
      variance_count: 1,
      total_count: 6,
      status: "acknowledged",
      acknowledged_by: "FO Niran",
      acknowledged_at: now(15),
      note: "Floor 2 ค้าง เพราะ FO ยุ่ง จะทำ audit พรุ่งนี้เช้า",
    },
  ];

  const all_acked = sections.every((s) => s.status !== "pending");

  return {
    business_date: businessDate,
    sections,
    all_clean: false,
    all_acked,
    can_complete_night_audit: all_acked,
  };
}
