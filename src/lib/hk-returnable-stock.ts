import {
  compareReturnableAmenityOrder,
  getAmenityLabelFromValues,
  isReturnableAmenity,
} from "@/lib/maid-amenities";

type SupabaseLike = {
  from: (table: string) => any;
};

type LedgerRow = {
  reservation_id?: string | null;
  room_id?: string | null;
  task_id?: string | null;
  stay_date?: string | null;
  product_id?: string | null;
  item_name?: string | null;
  action?: string | null;
  quantity?: number | null;
};

type HistoryTaskRow = {
  id?: string | null;
  room_id?: string | null;
  stay_date?: string | null;
  checklist_snapshot?: Array<{
    item?: string | null;
    used?: number | null;
    product_id?: string | null;
  }> | null;
};

export type ReturnableStockSummaryItem = {
  product_id: string;
  item: string;
  available_to_return: number;
  delivered_total: number;
  returned_total: number;
};

type ReturnableHistoryDelivery = {
  task_id: string;
  stay_date: string;
  product_id: string;
  item_name: string;
  quantity: number;
};

type ReturnableStockResult = {
  items: ReturnableStockSummaryItem[];
  source: "ledger" | "history" | "none";
  ledgerRowCount: number;
  historyDeliveries: ReturnableHistoryDelivery[];
};

type ReturnableStockCandidate = {
  reservationId: string;
  linkedReservationIds?: string[];
  roomId: string;
  checkinDate: string | null;
  checkoutDate: string | null;
};

function candidateKey(reservationId: string, roomId: string) {
  return `${reservationId}::${roomId}`;
}

function buildReturnableStockSummary(items: Map<string, {
  product_id: string;
  item: string;
  delivered_total: number;
  returned_total: number;
}>): ReturnableStockSummaryItem[] {
  return Array.from(items.values())
    .map((item) => ({
      ...item,
      available_to_return: Math.max(item.delivered_total - item.returned_total, 0),
    }))
    .filter((item) => item.available_to_return > 0)
    .sort(compareReturnableAmenityOrder);
}

function aggregateLedgerRows(rows: LedgerRow[]): ReturnableStockSummaryItem[] {
  const totals = new Map<string, {
    product_id: string;
    item: string;
    delivered_total: number;
    returned_total: number;
  }>();

  for (const row of rows) {
    const productId = String(row.product_id ?? "").trim();
    const quantity = Math.max(Number(row.quantity ?? 0), 0);
    if (!productId || quantity <= 0) continue;
    const current = totals.get(productId) ?? {
      product_id: productId,
      item: getAmenityLabelFromValues(String(row.item_name ?? ""), productId),
      delivered_total: 0,
      returned_total: 0,
    };
    if (String(row.action ?? "") === "return") {
      current.returned_total += quantity;
    } else {
      current.delivered_total += quantity;
    }
    totals.set(productId, current);
  }

  return buildReturnableStockSummary(totals);
}

function buildHistoryResult(historyDeliveries: ReturnableHistoryDelivery[]): ReturnableStockResult {
  if (historyDeliveries.length === 0) {
    return {
      items: [],
      source: "none",
      ledgerRowCount: 0,
      historyDeliveries: [],
    };
  }

  const totals = new Map<string, {
    product_id: string;
    item: string;
    delivered_total: number;
    returned_total: number;
  }>();

  for (const delivery of historyDeliveries) {
    const current = totals.get(delivery.product_id) ?? {
      product_id: delivery.product_id,
      item: delivery.item_name,
      delivered_total: 0,
      returned_total: 0,
    };
    current.delivered_total += delivery.quantity;
    totals.set(delivery.product_id, current);
  }

  return {
    items: buildReturnableStockSummary(totals),
    source: "history",
    ledgerRowCount: 0,
    historyDeliveries,
  };
}

function extractHistoryDeliveries(rows: HistoryTaskRow[]): ReturnableHistoryDelivery[] {
  const deliveries: ReturnableHistoryDelivery[] = [];

  for (const row of rows) {
    const taskId = String(row.id ?? "").trim();
    const stayDate = String(row.stay_date ?? "").trim();
    const snapshot = Array.isArray(row.checklist_snapshot) ? row.checklist_snapshot : [];
    if (!taskId || !stayDate || snapshot.length === 0) continue;

    for (const item of snapshot) {
      const productId = String(item?.product_id ?? "").trim();
      const quantity = Math.max(Number(item?.used ?? 0), 0);
      const itemName = String(item?.item ?? "").trim();
      if (!productId || quantity <= 0) continue;
      if (!isReturnableAmenity({ item: itemName, product_id: productId })) continue;
      deliveries.push({
        task_id: taskId,
        stay_date: stayDate,
        product_id: productId,
        item_name: getAmenityLabelFromValues(itemName, productId),
        quantity,
      });
    }
  }

  return deliveries;
}

async function loadLedgerRows(
  supabase: SupabaseLike,
  reservationId: string,
  roomId: string
): Promise<LedgerRow[]> {
  const { data, error } = await supabase
    .from("housekeeping_amenity_ledger")
    .select("task_id, stay_date, product_id, item_name, action, quantity")
    .eq("reservation_id", reservationId)
    .eq("room_id", roomId);

  if (error) {
    throw new Error(error.message ?? "Failed to load amenity ledger");
  }

  return (data ?? []) as LedgerRow[];
}

async function loadHistoryTaskRows(
  supabase: SupabaseLike,
  roomId: string,
  checkinDate: string | null,
  checkoutDate: string | null
): Promise<HistoryTaskRow[]> {
  if (!checkinDate || !checkoutDate) return [];

  const { data, error } = await supabase
    .from("housekeeping_tasks")
    .select("id, stay_date, checklist_snapshot")
    .eq("room_id", roomId)
    .gte("stay_date", checkinDate)
    .lt("stay_date", checkoutDate)
    .in("status", ["cleaned", "approved"]);

  if (error) {
    throw new Error(error.message ?? "Failed to load housekeeping history");
  }

  return (data ?? []) as HistoryTaskRow[];
}

export async function getReturnableStockForReservationRoom(
  supabase: SupabaseLike,
  options: {
    reservationId: string;
    roomId: string;
    checkinDate: string | null;
    checkoutDate: string | null;
  }
): Promise<ReturnableStockResult> {
  const ledgerRows = await loadLedgerRows(supabase, options.reservationId, options.roomId);
  if (ledgerRows.length > 0) {
    return {
      items: aggregateLedgerRows(ledgerRows),
      source: "ledger",
      ledgerRowCount: ledgerRows.length,
      historyDeliveries: [],
    };
  }

  const historyRows = await loadHistoryTaskRows(
    supabase,
    options.roomId,
    options.checkinDate,
    options.checkoutDate
  );
  const historyDeliveries = extractHistoryDeliveries(historyRows);
  return buildHistoryResult(historyDeliveries);
}

export async function getReturnableStockForReservationRooms(
  supabase: SupabaseLike,
  candidates: ReturnableStockCandidate[]
): Promise<Map<string, ReturnableStockResult>> {
  const normalizedCandidates = candidates
    .map((candidate) => ({
      reservationId: String(candidate.reservationId ?? "").trim(),
      linkedReservationIds: Array.from(
        new Set(
          [candidate.reservationId, ...(candidate.linkedReservationIds ?? [])]
            .map((id) => String(id ?? "").trim())
            .filter(Boolean)
        )
      ),
      roomId: String(candidate.roomId ?? "").trim(),
      checkinDate: candidate.checkinDate,
      checkoutDate: candidate.checkoutDate,
    }))
    .filter((candidate) => candidate.reservationId && candidate.roomId);

  const resultsByRoomId = new Map<string, ReturnableStockResult>();
  if (normalizedCandidates.length === 0) return resultsByRoomId;

  const reservationIds = Array.from(
    new Set(normalizedCandidates.flatMap((candidate) => candidate.linkedReservationIds))
  );
  const roomIds = Array.from(new Set(normalizedCandidates.map((candidate) => candidate.roomId)));

  const { data: ledgerData, error: ledgerError } = await supabase
    .from("housekeeping_amenity_ledger")
    .select("reservation_id, room_id, task_id, stay_date, product_id, item_name, action, quantity")
    .in("reservation_id", reservationIds)
    .in("room_id", roomIds);

  if (ledgerError) {
    throw new Error(ledgerError.message ?? "Failed to load amenity ledger");
  }

  const ledgerRowsByPairKey = new Map<string, LedgerRow[]>();
  for (const row of (ledgerData ?? []) as LedgerRow[]) {
    const reservationId = String(row.reservation_id ?? "").trim();
    const roomId = String(row.room_id ?? "").trim();
    for (const candidate of normalizedCandidates) {
      if (candidate.roomId !== roomId) continue;
      if (!candidate.linkedReservationIds.includes(reservationId)) continue;
      const key = candidateKey(candidate.reservationId, candidate.roomId);
      const rows = ledgerRowsByPairKey.get(key) ?? [];
      rows.push(row);
      ledgerRowsByPairKey.set(key, rows);
    }
  }

  const candidatesNeedingHistory: ReturnableStockCandidate[] = [];
  for (const candidate of normalizedCandidates) {
    const key = candidateKey(candidate.reservationId, candidate.roomId);
    const ledgerRows = ledgerRowsByPairKey.get(key) ?? [];
    if (ledgerRows.length > 0) {
      resultsByRoomId.set(candidate.roomId, {
        items: aggregateLedgerRows(ledgerRows),
        source: "ledger",
        ledgerRowCount: ledgerRows.length,
        historyDeliveries: [],
      });
      continue;
    }
    candidatesNeedingHistory.push(candidate);
  }

  const historyCandidates = candidatesNeedingHistory.filter(
    (candidate) => candidate.checkinDate && candidate.checkoutDate
  );
  if (historyCandidates.length === 0) {
    for (const candidate of candidatesNeedingHistory) {
      resultsByRoomId.set(candidate.roomId, {
        items: [],
        source: "none",
        ledgerRowCount: 0,
        historyDeliveries: [],
      });
    }
    return resultsByRoomId;
  }

  const minCheckinDate = historyCandidates
    .map((candidate) => candidate.checkinDate as string)
    .sort()[0];
  const maxCheckoutDate = historyCandidates
    .map((candidate) => candidate.checkoutDate as string)
    .sort()
    .at(-1) as string;
  const historyRoomIds = Array.from(new Set(historyCandidates.map((candidate) => candidate.roomId)));

  const { data: historyData, error: historyError } = await supabase
    .from("housekeeping_tasks")
    .select("id, room_id, stay_date, checklist_snapshot")
    .in("room_id", historyRoomIds)
    .gte("stay_date", minCheckinDate)
    .lt("stay_date", maxCheckoutDate)
    .in("status", ["cleaned", "approved"]);

  if (historyError) {
    throw new Error(historyError.message ?? "Failed to load housekeeping history");
  }

  const historyRows = (historyData ?? []) as HistoryTaskRow[];
  for (const candidate of candidatesNeedingHistory) {
    if (!candidate.checkinDate || !candidate.checkoutDate) {
      resultsByRoomId.set(candidate.roomId, {
        items: [],
        source: "none",
        ledgerRowCount: 0,
        historyDeliveries: [],
      });
      continue;
    }

    const candidateHistoryRows = historyRows.filter((row) => {
      const roomId = String(row.room_id ?? "").trim();
      const stayDate = String(row.stay_date ?? "").trim();
      return (
        roomId === candidate.roomId &&
        stayDate >= candidate.checkinDate! &&
        stayDate < candidate.checkoutDate!
      );
    });
    resultsByRoomId.set(candidate.roomId, buildHistoryResult(extractHistoryDeliveries(candidateHistoryRows)));
  }

  return resultsByRoomId;
}

export async function backfillReturnableAmenityLedgerIfMissing(
  supabase: SupabaseLike,
  options: {
    reservationId: string;
    roomId: string;
    roomNumber: string;
    floorNumber: number;
    checkinDate: string | null;
    checkoutDate: string | null;
  }
): Promise<{ inserted: number; source: "ledger" | "history" | "none" }> {
  const stock = await getReturnableStockForReservationRoom(supabase, {
    reservationId: options.reservationId,
    roomId: options.roomId,
    checkinDate: options.checkinDate,
    checkoutDate: options.checkoutDate,
  });

  if (stock.source !== "history" || stock.historyDeliveries.length === 0) {
    return {
      inserted: 0,
      source: stock.source,
    };
  }

  const { error } = await supabase.from("housekeeping_amenity_ledger").insert(
    stock.historyDeliveries.map((delivery) => ({
      reservation_id: options.reservationId,
      room_id: options.roomId,
      task_id: delivery.task_id,
      stay_date: delivery.stay_date,
      room_number: options.roomNumber,
      floor_number: options.floorNumber,
      product_id: delivery.product_id,
      item_name: delivery.item_name,
      action: "deliver",
      quantity: delivery.quantity,
      performed_by: null,
    }))
  );

  if (error) {
    throw new Error(error.message ?? "Failed to backfill amenity ledger");
  }

  return {
    inserted: stock.historyDeliveries.length,
    source: "history",
  };
}
