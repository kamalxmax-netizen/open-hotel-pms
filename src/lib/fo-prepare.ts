import { createServerSupabaseClient } from "@/lib/supabase/server";

type SupabaseServerClient = ReturnType<typeof createServerSupabaseClient>;

export type FoTargetRoom = {
  room_id: string;
  room_number: string;
  floor_number: number;
  room_type_code: string;
};

export type FoPrepareSuggestionRow = {
  floor_number: number;
  product_id: string;
  product_name: string;
  unit: string;
  room_count: number;
  suggested_qty: number;
};

export type FoPrepareBatchHeader = {
  id: string;
  business_date: string;
  status: "prepared" | "returned" | "cancelled";
  prepared_at: string;
  prepared_by: string | null;
  prepare_note: string | null;
  insufficient_warning: boolean;
  returned_at: string | null;
  returned_by: string | null;
  return_note: string | null;
  return_override_note: string | null;
  created_at: string;
  updated_at: string;
};

export type FoPrepareBatchItemDetail = {
  id: string;
  batch_id: string;
  floor_number: number;
  product_id: string;
  product_name: string;
  unit: string;
  suggested_qty: number;
  requested_qty: number;
  prepared_qty: number;
  shortage_qty: number;
  used_qty: number;
  remaining_qty: number;
  returned_qty: number;
  return_note: string | null;
  floor_current_qty: number;
  suggested_remaining: number;
  returnable_max: number;
};

export type FoCanReturnResult = {
  all_rooms_finished: boolean;
  total_rooms: number;
  finished_rooms: number;
  pending_rooms: string[];
};

function normalizeFloorNumber(roomNumber: string | null | undefined, floorNumber: number | null | undefined): number {
  if (typeof floorNumber === "number" && Number.isInteger(floorNumber) && floorNumber > 0) {
    return floorNumber;
  }
  const prefix = String(roomNumber ?? "").trim().slice(0, 1);
  const parsed = Number(prefix);
  if (Number.isInteger(parsed) && parsed > 0) return parsed;
  return 1;
}

function toRoomSortKey(roomNumber: string): string {
  return roomNumber ?? "";
}

function parseDateOrNull(value: string | null | undefined): string | null {
  const v = (value ?? "").trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(v)) return null;
  return v;
}

function shiftDate(dateStr: string, diffDays: number): string {
  const d = new Date(`${dateStr}T12:00:00.000Z`);
  if (Number.isNaN(d.getTime())) return dateStr;
  d.setUTCDate(d.getUTCDate() + diffDays);
  return d.toISOString().slice(0, 10);
}

export async function getBusinessDate(
  supabase: SupabaseServerClient,
  requestedDate?: string | null
): Promise<string> {
  const explicitDate = parseDateOrNull(requestedDate);
  if (explicitDate) return explicitDate;

  const { data, error } = await supabase
    .from("hotel_settings")
    .select("business_date")
    .eq("id", 1)
    .maybeSingle();

  if (!error && data?.business_date && /^\d{4}-\d{2}-\d{2}$/.test(String(data.business_date))) {
    return String(data.business_date);
  }

  const now = new Date();
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "Asia/Bangkok",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(now);
  const year = parts.find((part) => part.type === "year")?.value;
  const month = parts.find((part) => part.type === "month")?.value;
  const day = parts.find((part) => part.type === "day")?.value;
  return `${year ?? now.getUTCFullYear()}-${month ?? "01"}-${day ?? "01"}`;
}

async function loadCheckedInReservationIds(
  supabase: SupabaseServerClient,
  businessDate: string
): Promise<string[]> {
  const withCheckedIn = await supabase
    .from("reservations")
    .select("id, checked_in_at, checkin_date")
    .eq("status", "active")
    .lte("checkin_date", businessDate)
    .gte("checkout_date", businessDate);

  if (withCheckedIn.error) {
    const msg = String(withCheckedIn.error.message ?? "").toLowerCase();
    if (msg.includes("checked_in_at")) {
      throw new Error(
        "DB migration required: apply 20260226_phase1_enhancements.sql before using FO prepare checked-in logic."
      );
    }
    throw new Error(withCheckedIn.error.message);
  }
  const reservationRows: Array<{ id: string; checked_in_at?: string | null; checkin_date?: string | null }> = (withCheckedIn.data ?? []).map(
    (row: any) => ({
      id: String(row.id),
      checked_in_at: row.checked_in_at ?? null,
      checkin_date: row.checkin_date ?? null,
    })
  );

  if (reservationRows.length === 0) return [];

  const checkedInIds = new Set<string>();
  const pendingLogLookupIds: string[] = [];

  for (const row of reservationRows) {
    if (row.checked_in_at) {
      checkedInIds.add(row.id);
      continue;
    }

    // Backward-compatible rule for legacy data:
    // if reservation is still active and has already started before business date,
    // treat as checked in even when checked_in_at/audit log is missing.
    if (row.checkin_date && row.checkin_date < businessDate) {
      checkedInIds.add(row.id);
      continue;
    } else {
      pendingLogLookupIds.push(row.id);
    }
  }

  if (pendingLogLookupIds.length > 0) {
    const { data: logs, error: logError } = await supabase
      .from("audit_logs")
      .select("entity_id")
      .eq("entity_type", "reservation")
      .eq("action", "checked_in")
      .in("entity_id", pendingLogLookupIds);

    if (logError) {
      throw new Error(logError.message);
    }

    for (const log of logs ?? []) {
      const id = String((log as any).entity_id ?? "");
      if (id) checkedInIds.add(id);
    }
  }

  return Array.from(checkedInIds);
}

export async function listFoTargetRooms(
  supabase: SupabaseServerClient,
  businessDate: string
): Promise<FoTargetRoom[]> {
  const soldLastNight = shiftDate(businessDate, -1);

  const { data: nightRows, error: nightError } = await supabase
    .from("reservation_nights")
    .select("room_id, reservation_id, stay_date, reservations!inner(status, is_dayuse)")
    .eq("stay_date", soldLastNight)
    .is("cancelled_at", null)
    .neq("reservations.status", "cancelled")
    .eq("reservations.is_dayuse", false);

  if (nightError) {
    throw new Error(nightError.message);
  }

  const latestRoomByReservation = new Map<string, { stay_date: string; room_id: string }>();
  for (const row of nightRows ?? []) {
    const reservationId = String((row as any).reservation_id ?? "");
    const roomId = String((row as any).room_id ?? "");
    const stayDate = String((row as any).stay_date ?? "");
    if (!reservationId || !roomId || !stayDate) continue;
    const current = latestRoomByReservation.get(reservationId);
    if (!current || stayDate > current.stay_date) {
      latestRoomByReservation.set(reservationId, { stay_date: stayDate, room_id: roomId });
    }
  }

  const roomIds = Array.from(
    new Set(Array.from(latestRoomByReservation.values()).map((item) => item.room_id).filter(Boolean))
  );
  if (roomIds.length === 0) return [];

  const { data: roomRows, error: roomError } = await supabase
    .from("rooms")
    .select("id, room_number, floor_number, room_types(code)")
    .in("id", roomIds)
    .eq("is_dayuse", false);

  if (roomError) {
    throw new Error(roomError.message);
  }

  const rooms: FoTargetRoom[] = (roomRows ?? []).map((row: any) => ({
    room_id: String(row.id),
    room_number: String(row.room_number ?? ""),
    floor_number: normalizeFloorNumber(row.room_number, row.floor_number),
    room_type_code: String(row.room_types?.code ?? ""),
  }));

  rooms.sort((a, b) =>
    toRoomSortKey(a.room_number).localeCompare(toRoomSortKey(b.room_number), undefined, {
      numeric: true,
      sensitivity: "base",
    })
  );

  return rooms;
}

export async function buildFoPrepareSuggestions(
  supabase: SupabaseServerClient,
  businessDate: string
): Promise<{
  rooms: FoTargetRoom[];
  suggestions: FoPrepareSuggestionRow[];
}> {
  const rooms = await listFoTargetRooms(supabase, businessDate);
  if (rooms.length === 0) {
    return { rooms, suggestions: [] };
  }

  const roomTypeCodes = Array.from(new Set(rooms.map((room) => room.room_type_code).filter(Boolean)));

  const { data: productRows, error: productError } = await supabase
    .from("products")
    .select("id, name, unit, fulfillment_mode, is_active")
    .eq("fulfillment_mode", "daily_prepare")
    .eq("is_active", true);

  if (productError) {
    throw new Error(productError.message);
  }

  const productMap = new Map<
    string,
    {
      name: string;
      unit: string;
    }
  >();
  for (const row of productRows ?? []) {
    const id = String((row as any).id ?? "");
    if (!id) continue;
    productMap.set(id, {
      name: String((row as any).name ?? ""),
      unit: String((row as any).unit ?? "pcs"),
    });
  }

  if (productMap.size === 0 || roomTypeCodes.length === 0) {
    return { rooms, suggestions: [] };
  }

  const { data: templateRows, error: templateError } = await supabase
    .from("checklist_templates")
    .select("room_type_code, product_id, default_quantity, is_active")
    .eq("is_active", true)
    .in("room_type_code", roomTypeCodes)
    .not("product_id", "is", null);

  if (templateError) {
    throw new Error(templateError.message);
  }

  const templatesByRoomType = new Map<string, Array<{ product_id: string; quantity: number }>>();
  for (const row of templateRows ?? []) {
    const roomTypeCode = String((row as any).room_type_code ?? "");
    const productId = String((row as any).product_id ?? "");
    if (!roomTypeCode || !productId) continue;
    if (!productMap.has(productId)) continue;
    const qty = Math.max(Number((row as any).default_quantity ?? 0), 0);
    if (qty <= 0) continue;
    if (!templatesByRoomType.has(roomTypeCode)) {
      templatesByRoomType.set(roomTypeCode, []);
    }
    templatesByRoomType.get(roomTypeCode)?.push({
      product_id: productId,
      quantity: qty,
    });
  }

  const aggregate = new Map<
    string,
    {
      floor_number: number;
      product_id: string;
      product_name: string;
      unit: string;
      room_count: number;
      suggested_qty: number;
    }
  >();

  for (const room of rooms) {
    const templates = templatesByRoomType.get(room.room_type_code) ?? [];
    if (templates.length === 0) continue;

    const perRoomProductQty = new Map<string, number>();
    for (const template of templates) {
      perRoomProductQty.set(
        template.product_id,
        (perRoomProductQty.get(template.product_id) ?? 0) + template.quantity
      );
    }

    for (const [productId, quantity] of perRoomProductQty.entries()) {
      if (quantity <= 0) continue;
      const product = productMap.get(productId);
      if (!product) continue;

      const key = `${room.floor_number}:${productId}`;
      const current = aggregate.get(key) ?? {
        floor_number: room.floor_number,
        product_id: productId,
        product_name: product.name,
        unit: product.unit,
        room_count: 0,
        suggested_qty: 0,
      };
      current.room_count += 1;
      current.suggested_qty += quantity;
      aggregate.set(key, current);
    }
  }

  const suggestions = Array.from(aggregate.values()).sort((a, b) => {
    if (a.floor_number !== b.floor_number) return a.floor_number - b.floor_number;
    return a.product_name.localeCompare(b.product_name, undefined, { sensitivity: "base" });
  });

  return { rooms, suggestions };
}

export async function checkFoCanReturn(
  supabase: SupabaseServerClient,
  businessDate: string
): Promise<FoCanReturnResult> {
  const targetRooms = await listFoTargetRooms(supabase, businessDate);
  if (targetRooms.length === 0) {
    return {
      all_rooms_finished: true,
      total_rooms: 0,
      finished_rooms: 0,
      pending_rooms: [],
    };
  }

  const roomIds = targetRooms.map((room) => room.room_id);
  const { data: taskRows, error: taskError } = await supabase
    .from("housekeeping_tasks")
    .select("room_id, status, is_no_service, finished_at, approved_at")
    .eq("stay_date", businessDate)
    .in("room_id", roomIds);

  if (taskError) {
    throw new Error(taskError.message);
  }

  const bestTaskByRoom = new Map<
    string,
    { status: string | null; is_no_service: boolean; finished_at: string | null; approved_at: string | null }
  >();

  for (const row of taskRows ?? []) {
    const roomId = String((row as any).room_id ?? "");
    if (!roomId) continue;
    const current = bestTaskByRoom.get(roomId);
    const incomingScore = ((row as any).approved_at ? 3 : 0) + ((row as any).finished_at ? 2 : 0);
    const currentScore =
      (current?.approved_at ? 3 : 0) +
      (current?.finished_at ? 2 : 0);
    if (!current || incomingScore >= currentScore) {
      bestTaskByRoom.set(roomId, {
        status: (row as any).status ?? null,
        is_no_service: Boolean((row as any).is_no_service),
        finished_at: (row as any).finished_at ?? null,
        approved_at: (row as any).approved_at ?? null,
      });
    }
  }

  const pendingRooms: string[] = [];
  let finishedRooms = 0;

  for (const room of targetRooms) {
    const task = bestTaskByRoom.get(room.room_id);
    const isFinished =
      Boolean(task) &&
      (task?.is_no_service ||
        task?.status === "cleaned" ||
        task?.status === "approved");

    if (isFinished) {
      finishedRooms += 1;
    } else {
      pendingRooms.push(room.room_number);
    }
  }

  pendingRooms.sort((a, b) => a.localeCompare(b, undefined, { numeric: true, sensitivity: "base" }));

  return {
    all_rooms_finished: pendingRooms.length === 0,
    total_rooms: targetRooms.length,
    finished_rooms: finishedRooms,
    pending_rooms: pendingRooms,
  };
}

export async function getFoPrepareBatchByDate(
  supabase: SupabaseServerClient,
  businessDate: string
): Promise<FoPrepareBatchHeader | null> {
  const { data, error } = await supabase
    .from("fo_prepare_batches")
    .select(
      "id, business_date, status, prepared_at, prepared_by, prepare_note, insufficient_warning, returned_at, returned_by, return_note, return_override_note, created_at, updated_at"
    )
    .eq("business_date", businessDate)
    .maybeSingle();

  if (error) {
    throw new Error(error.message);
  }

  if (!data) return null;

  return {
    id: String((data as any).id),
    business_date: String((data as any).business_date),
    status: String((data as any).status) as FoPrepareBatchHeader["status"],
    prepared_at: String((data as any).prepared_at),
    prepared_by: (data as any).prepared_by ?? null,
    prepare_note: (data as any).prepare_note ?? null,
    insufficient_warning: Boolean((data as any).insufficient_warning),
    returned_at: (data as any).returned_at ?? null,
    returned_by: (data as any).returned_by ?? null,
    return_note: (data as any).return_note ?? null,
    return_override_note: (data as any).return_override_note ?? null,
    created_at: String((data as any).created_at),
    updated_at: String((data as any).updated_at),
  };
}

export async function getOldestOpenFoPrepareBatch(
  supabase: SupabaseServerClient,
  onOrBeforeBusinessDate?: string
): Promise<FoPrepareBatchHeader | null> {
  let query = supabase
    .from("fo_prepare_batches")
    .select(
      "id, business_date, status, prepared_at, prepared_by, prepare_note, insufficient_warning, returned_at, returned_by, return_note, return_override_note, created_at, updated_at"
    )
    .eq("status", "prepared")
    .order("business_date", { ascending: true })
    .limit(1);

  if (onOrBeforeBusinessDate) {
    query = query.lte("business_date", onOrBeforeBusinessDate);
  }

  const { data, error } = await query.maybeSingle();
  if (error) {
    throw new Error(error.message);
  }

  if (!data) return null;

  return {
    id: String((data as any).id),
    business_date: String((data as any).business_date),
    status: String((data as any).status) as FoPrepareBatchHeader["status"],
    prepared_at: String((data as any).prepared_at),
    prepared_by: (data as any).prepared_by ?? null,
    prepare_note: (data as any).prepare_note ?? null,
    insufficient_warning: Boolean((data as any).insufficient_warning),
    returned_at: (data as any).returned_at ?? null,
    returned_by: (data as any).returned_by ?? null,
    return_note: (data as any).return_note ?? null,
    return_override_note: (data as any).return_override_note ?? null,
    created_at: String((data as any).created_at),
    updated_at: String((data as any).updated_at),
  };
}

export async function getFoPrepareBatchDetail(
  supabase: SupabaseServerClient,
  batchId: string
): Promise<{ batch: FoPrepareBatchHeader; items: FoPrepareBatchItemDetail[] } | null> {
  const { data: batchRow, error: batchError } = await supabase
    .from("fo_prepare_batches")
    .select(
      "id, business_date, status, prepared_at, prepared_by, prepare_note, insufficient_warning, returned_at, returned_by, return_note, return_override_note, created_at, updated_at"
    )
    .eq("id", batchId)
    .maybeSingle();

  if (batchError) {
    throw new Error(batchError.message);
  }
  if (!batchRow) return null;

  const batch: FoPrepareBatchHeader = {
    id: String((batchRow as any).id),
    business_date: String((batchRow as any).business_date),
    status: String((batchRow as any).status) as FoPrepareBatchHeader["status"],
    prepared_at: String((batchRow as any).prepared_at),
    prepared_by: (batchRow as any).prepared_by ?? null,
    prepare_note: (batchRow as any).prepare_note ?? null,
    insufficient_warning: Boolean((batchRow as any).insufficient_warning),
    returned_at: (batchRow as any).returned_at ?? null,
    returned_by: (batchRow as any).returned_by ?? null,
    return_note: (batchRow as any).return_note ?? null,
    return_override_note: (batchRow as any).return_override_note ?? null,
    created_at: String((batchRow as any).created_at),
    updated_at: String((batchRow as any).updated_at),
  };

  const { data: itemRows, error: itemError } = await supabase
    .from("fo_prepare_batch_items")
    .select(
      "id, batch_id, floor_number, product_id, suggested_qty, requested_qty, prepared_qty, shortage_qty, used_qty, remaining_qty, returned_qty, return_note, products(name, unit)"
    )
    .eq("batch_id", batchId)
    .order("floor_number", { ascending: true });

  if (itemError) {
    throw new Error(itemError.message);
  }

  const productIds = Array.from(
    new Set((itemRows ?? []).map((row: any) => String(row.product_id ?? "")).filter(Boolean))
  );
  const floorNumbers = Array.from(
    new Set(
      (itemRows ?? [])
        .map((row: any) => Number(row.floor_number ?? 0))
        .filter((floor: number) => Number.isInteger(floor) && floor > 0)
    )
  );

  const usedMap = new Map<string, number>();
  if (productIds.length > 0 && floorNumbers.length > 0) {
    const { data: usedRows, error: usedError } = await supabase
      .from("stock_transactions_v2")
      .select("product_id, floor_number, quantity_change")
      .eq("transaction_date", batch.business_date)
      .eq("action", "use")
      .eq("reference_type", "housekeeping_task")
      .in("product_id", productIds)
      .in("floor_number", floorNumbers);

    if (usedError) {
      throw new Error(usedError.message);
    }

    for (const row of usedRows ?? []) {
      const key = `${Number((row as any).floor_number ?? 0)}:${String((row as any).product_id ?? "")}`;
      const qty = Math.abs(Number((row as any).quantity_change ?? 0));
      usedMap.set(key, (usedMap.get(key) ?? 0) + qty);
    }
  }

  const floorCurrentMap = new Map<string, number>();
  if (productIds.length > 0 && floorNumbers.length > 0) {
    const { data: floorRows, error: floorError } = await supabase
      .from("floor_stock")
      .select("floor_number, product_id, quantity")
      .in("product_id", productIds)
      .in("floor_number", floorNumbers);

    if (floorError) {
      throw new Error(floorError.message);
    }

    for (const row of floorRows ?? []) {
      const key = `${Number((row as any).floor_number ?? 0)}:${String((row as any).product_id ?? "")}`;
      floorCurrentMap.set(key, Number((row as any).quantity ?? 0));
    }
  }

  const items: FoPrepareBatchItemDetail[] = (itemRows ?? [])
    .map((row: any) => {
      const floor = Number(row.floor_number ?? 0);
      const productId = String(row.product_id ?? "");
      const key = `${floor}:${productId}`;
      const preparedQty = Number(row.prepared_qty ?? 0);
      const usedQty = Math.max(usedMap.get(key) ?? Number(row.used_qty ?? 0), 0);
      const suggestedRemaining = Math.max(preparedQty - usedQty, 0);
      const floorCurrentQty = Math.max(floorCurrentMap.get(key) ?? 0, 0);
      const returnableMax = Math.max(Math.min(preparedQty, floorCurrentQty), 0);

      return {
        id: String(row.id),
        batch_id: String(row.batch_id),
        floor_number: floor,
        product_id: productId,
        product_name: String(row.products?.name ?? ""),
        unit: String(row.products?.unit ?? "pcs"),
        suggested_qty: Number(row.suggested_qty ?? 0),
        requested_qty: Number(row.requested_qty ?? 0),
        prepared_qty: preparedQty,
        shortage_qty: Number(row.shortage_qty ?? 0),
        used_qty: usedQty,
        remaining_qty: Number(row.remaining_qty ?? suggestedRemaining),
        returned_qty: Number(row.returned_qty ?? 0),
        return_note: row.return_note ?? null,
        floor_current_qty: floorCurrentQty,
        suggested_remaining: suggestedRemaining,
        returnable_max: returnableMax,
      };
    })
    .sort((a, b) => {
      if (a.floor_number !== b.floor_number) return a.floor_number - b.floor_number;
      return a.product_name.localeCompare(b.product_name, undefined, { sensitivity: "base" });
    });

  return { batch, items };
}
