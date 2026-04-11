import { listNights } from "@/lib/dates";

type SupabaseLike = {
  from: (table: string) => any;
};

export type LinkedStaySegment = {
  reservation_id: string;
  parent_reservation_id: string | null;
  booking_code: string | null;
  source: string | null;
  checkin_date: string;
  checkout_date: string;
  checked_in_at: string | null;
  status: string | null;
  total_price: number;
  is_parent: boolean;
};

export type LinkedStay = {
  segments: LinkedStaySegment[];
  full_checkin: string;
  full_checkout: string;
  full_checked_in_at: string | null;
  full_nights: number;
  combined_total: number;
  active_segment_id: string;
};

type ReservationRecord = {
  id: string;
  parent_reservation_id: string | null;
  booking_code: string | null;
  source: string | null;
  checkin_date: string | null;
  checkout_date: string | null;
  checked_in_at: string | null;
  status: string | null;
  total_price: number | string | null;
};

function normalizeTimeHHmm(value: string | null | undefined, fallback = "12:00"): string {
  const raw = String(value ?? "").trim();
  const match = raw.match(/^(\d{2}):(\d{2})(?::\d{2})?$/u);
  if (!match) return fallback;
  return `${match[1]}:${match[2]}`;
}

function getBangkokNowParts(date = new Date()): { today: string; timeHHmm: string } {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Asia/Bangkok",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(date);

  const year = parts.find((part) => part.type === "year")?.value ?? "1970";
  const month = parts.find((part) => part.type === "month")?.value ?? "01";
  const day = parts.find((part) => part.type === "day")?.value ?? "01";
  const hour = parts.find((part) => part.type === "hour")?.value ?? "00";
  const minute = parts.find((part) => part.type === "minute")?.value ?? "00";

  return {
    today: `${year}-${month}-${day}`,
    timeHHmm: `${hour}:${minute}`,
  };
}

function toNumber(value: unknown): number {
  const num = typeof value === "number" ? value : Number(value);
  return Number.isFinite(num) ? num : 0;
}

function shouldSuppressLinkedStatus(status: unknown): boolean {
  const normalized = String(status ?? "").toLowerCase();
  return normalized === "cancelled" || normalized === "no_show";
}

function compareDateStrings(left: string, right: string): number {
  return left.localeCompare(right);
}

function addReservation(
  rows: Map<string, ReservationRecord>,
  row: ReservationRecord | null | undefined
): void {
  if (!row?.id) return;
  rows.set(String(row.id), row);
}

function sortSegments(segments: LinkedStaySegment[]): LinkedStaySegment[] {
  return [...segments].sort((left, right) => {
    const dateCmp = compareDateStrings(left.checkin_date, right.checkin_date);
    if (dateCmp !== 0) return dateCmp;
    if (left.is_parent !== right.is_parent) return left.is_parent ? -1 : 1;
    const checkoutCmp = compareDateStrings(left.checkout_date, right.checkout_date);
    if (checkoutCmp !== 0) return checkoutCmp;
    return (left.booking_code ?? "").localeCompare(right.booking_code ?? "", undefined, { numeric: true, sensitivity: "base" });
  });
}

function resolveActiveSegmentId(
  segments: LinkedStaySegment[],
  currentDate: string,
  currentTimeHHmm: string,
  checkOutTimeHHmm: string
): string {
  if (segments.length === 0) return "";

  const sorted = sortSegments(segments);
  const cutoffTime = normalizeTimeHHmm(checkOutTimeHHmm, "12:00");
  const nowClock = `${currentDate}T${currentTimeHHmm}`;
  const cutoffClock = `${currentDate}T${cutoffTime}`;

  const boundaryIndex = sorted.findIndex((segment, index) => {
    if (index === 0) return false;
    return segment.checkin_date === currentDate && sorted[index - 1].checkout_date === currentDate;
  });

  if (boundaryIndex >= 0) {
    const nextSegment = sorted[boundaryIndex];
    if (
      String(nextSegment.status ?? "").toLowerCase() === "active" &&
      nextSegment.checked_in_at
    ) {
      return nextSegment.reservation_id;
    }
    return nowClock >= cutoffClock ? sorted[boundaryIndex].reservation_id : sorted[boundaryIndex - 1].reservation_id;
  }

  const inRange = sorted.filter(
    (segment) => compareDateStrings(segment.checkin_date, currentDate) <= 0 && compareDateStrings(currentDate, segment.checkout_date) < 0
  );
  if (inRange.length > 0) {
    return inRange[inRange.length - 1].reservation_id;
  }

  if (compareDateStrings(currentDate, sorted[0].checkin_date) < 0) {
    return sorted[0].reservation_id;
  }

  return sorted[sorted.length - 1].reservation_id;
}

// ── In-memory cache for hotel checkout time (rarely changes) ──
let _cachedCheckOutTime: string | null = null;
let _cachedCheckOutTimeAt = 0;
const CHECK_OUT_TIME_TTL_MS = 60_000; // 60 seconds

async function loadHotelCheckOutTime(supabase: SupabaseLike, fallback = "12:00"): Promise<string> {
  const now = Date.now();
  if (_cachedCheckOutTime !== null && now - _cachedCheckOutTimeAt < CHECK_OUT_TIME_TTL_MS) {
    return _cachedCheckOutTime;
  }

  const { data, error } = await supabase
    .from("hotel_settings")
    .select("check_out_time")
    .eq("id", 1)
    .maybeSingle();

  if (error) return fallback;
  const resolved = normalizeTimeHHmm(data?.check_out_time, fallback);
  _cachedCheckOutTime = resolved;
  _cachedCheckOutTimeAt = now;
  return resolved;
}

export async function resolveHotelCheckOutTime(
  supabase: SupabaseLike,
  fallback = "12:00"
): Promise<string> {
  return loadHotelCheckOutTime(supabase, fallback);
}

export async function resolveLinkedStay(
  supabase: SupabaseLike,
  reservationId: string,
  checkOutTimeHHmm = "12:00"
): Promise<LinkedStay | null> {
  if (!reservationId) return null;

  const { data: currentReservation, error: currentError } = await supabase
    .from("reservations")
    .select(`
      id,
      parent_reservation_id,
      booking_code,
      source,
      checkin_date,
      checkout_date,
      checked_in_at,
      status,
      total_price
    `)
    .eq("id", reservationId)
    .maybeSingle();

  if (currentError || !currentReservation) {
    return null;
  }

  const current = currentReservation as ReservationRecord;
  const rootReservationId = current.parent_reservation_id ? String(current.parent_reservation_id) : String(current.id);

  const [rootResult, childrenResult] = await Promise.all([
    supabase
      .from("reservations")
      .select(`
        id,
        parent_reservation_id,
        booking_code,
        source,
        checkin_date,
        checkout_date,
        checked_in_at,
        status,
        total_price
      `)
      .eq("id", rootReservationId)
      .maybeSingle(),
    supabase
      .from("reservations")
      .select(`
        id,
        parent_reservation_id,
        booking_code,
        source,
        checkin_date,
        checkout_date,
        checked_in_at,
        status,
        total_price
      `)
      .eq("parent_reservation_id", rootReservationId)
      .order("checkin_date", { ascending: true }),
  ]);

  if (rootResult.error || childrenResult.error) {
    return null;
  }

  const rows = new Map<string, ReservationRecord>();
  addReservation(rows, rootResult.data as ReservationRecord | null | undefined);
  for (const row of (childrenResult.data ?? []) as ReservationRecord[]) {
    addReservation(rows, row);
  }

  const linkedRecords = Array.from(rows.values()).filter((row) => {
    if (!row.checkin_date || !row.checkout_date) return false;
    if (String(row.id) === String(current.id)) return true;
    return !shouldSuppressLinkedStatus(row.status);
  }) as ReservationRecord[];
  const hasParentLink = Boolean(current.parent_reservation_id);

  if (!hasParentLink && linkedRecords.length <= 1) {
    return null;
  }

  const segments = sortSegments(
    linkedRecords.map((row) => ({
      reservation_id: String(row.id),
      parent_reservation_id: row.parent_reservation_id ? String(row.parent_reservation_id) : null,
      booking_code: row.booking_code ?? null,
      source: row.source ? String(row.source) : "walkin",
      checkin_date: String(row.checkin_date),
      checkout_date: String(row.checkout_date),
      checked_in_at: row.checked_in_at ? String(row.checked_in_at) : null,
      status: row.status ? String(row.status) : "active",
      total_price: toNumber(row.total_price),
      is_parent: String(row.id) === rootReservationId,
    }))
  );

  if (!hasParentLink && segments.length <= 1) {
    return null;
  }

  const fullCheckin = segments[0]?.checkin_date ?? "";
  const fullCheckout = segments[segments.length - 1]?.checkout_date ?? "";
  const fullCheckedInAt = linkedRecords
    .map((row) => (row.checked_in_at ? String(row.checked_in_at) : ""))
    .filter(Boolean)
    .sort()[0] || null;
  const fullNights = fullCheckin && fullCheckout ? listNights(fullCheckin, fullCheckout).length : 0;
  const combinedTotal = segments.reduce((sum, segment) => sum + segment.total_price, 0);
  const { today, timeHHmm } = getBangkokNowParts();
  const activeSegmentId = resolveActiveSegmentId(segments, today, timeHHmm, checkOutTimeHHmm);

  return {
    segments,
    full_checkin: fullCheckin,
    full_checkout: fullCheckout,
    full_checked_in_at: fullCheckedInAt,
    full_nights: fullNights,
    combined_total: combinedTotal,
    active_segment_id: activeSegmentId,
  };
}

// ────────────────────────────────────────────────────────────────
// Batch version: resolves linked stays for many reservations
// using only 2 batch DB queries instead of 3 per row.
// ────────────────────────────────────────────────────────────────

/**
 * Build a LinkedStay result from pre-fetched reservation records.
 * Pure function — no DB calls.
 */
function buildLinkedStayFromRecords(
  current: ReservationRecord,
  allRecords: Map<string, ReservationRecord>,
  checkOutTimeHHmm: string
): LinkedStay | null {
  const rootReservationId = current.parent_reservation_id
    ? String(current.parent_reservation_id)
    : String(current.id);

  // Collect root + children that belong to this linked chain
  const rows = new Map<string, ReservationRecord>();
  const root = allRecords.get(rootReservationId);
  if (root) addReservation(rows, root);
  // Also add self if it's the root
  addReservation(rows, current);
  // Add children of root
  for (const row of allRecords.values()) {
    if (row.parent_reservation_id && String(row.parent_reservation_id) === rootReservationId) {
      addReservation(rows, row);
    }
  }

  const linkedRecords = Array.from(rows.values()).filter((row) => {
    if (!row.checkin_date || !row.checkout_date) return false;
    if (String(row.id) === String(current.id)) return true;
    return !shouldSuppressLinkedStatus(row.status);
  }) as ReservationRecord[];

  const hasParentLink = Boolean(current.parent_reservation_id);

  if (!hasParentLink && linkedRecords.length <= 1) {
    return null;
  }

  const segments = sortSegments(
    linkedRecords.map((row) => ({
      reservation_id: String(row.id),
      parent_reservation_id: row.parent_reservation_id ? String(row.parent_reservation_id) : null,
      booking_code: row.booking_code ?? null,
      source: row.source ? String(row.source) : "walkin",
      checkin_date: String(row.checkin_date),
      checkout_date: String(row.checkout_date),
      checked_in_at: row.checked_in_at ? String(row.checked_in_at) : null,
      status: row.status ? String(row.status) : "active",
      total_price: toNumber(row.total_price),
      is_parent: String(row.id) === rootReservationId,
    }))
  );

  if (!hasParentLink && segments.length <= 1) {
    return null;
  }

  const fullCheckin = segments[0]?.checkin_date ?? "";
  const fullCheckout = segments[segments.length - 1]?.checkout_date ?? "";
  const fullCheckedInAt = linkedRecords
    .map((row) => (row.checked_in_at ? String(row.checked_in_at) : ""))
    .filter(Boolean)
    .sort()[0] || null;
  const fullNights = fullCheckin && fullCheckout ? listNights(fullCheckin, fullCheckout).length : 0;
  const combinedTotal = segments.reduce((sum, segment) => sum + segment.total_price, 0);
  const { today, timeHHmm } = getBangkokNowParts();
  const activeSegmentId = resolveActiveSegmentId(segments, today, timeHHmm, checkOutTimeHHmm);

  return {
    segments,
    full_checkin: fullCheckin,
    full_checkout: fullCheckout,
    full_checked_in_at: fullCheckedInAt,
    full_nights: fullNights,
    combined_total: combinedTotal,
    active_segment_id: activeSegmentId,
  };
}

const LINKED_STAY_SELECT = `
  id,
  parent_reservation_id,
  booking_code,
  source,
  checkin_date,
  checkout_date,
  checked_in_at,
  status,
  total_price
`;

/**
 * Batch resolve linked stays for multiple reservations.
 * Uses only 2 DB queries total instead of 3 per row.
 *
 * @param reservations - array of reservation rows that already contain
 *   at least { id, parent_reservation_id } (avoids re-fetching them).
 */
export async function resolveLinkedStayBatch(
  supabase: SupabaseLike,
  reservations: Array<{
    id: string;
    parent_reservation_id?: string | null;
    booking_code?: string | null;
    source?: string | null;
    checkin_date?: string | null;
    checkout_date?: string | null;
    checked_in_at?: string | null;
    status?: string | null;
    total_price?: number | string | null;
  }>,
  checkOutTimeHHmm = "12:00"
): Promise<Map<string, LinkedStay | null>> {
  const result = new Map<string, LinkedStay | null>();
  if (reservations.length === 0) return result;

  // Build a map of the input reservations (we already have their data)
  const inputById = new Map<string, ReservationRecord>();
  for (const r of reservations) {
    const id = String(r.id ?? "");
    if (!id) continue;
    inputById.set(id, {
      id,
      parent_reservation_id: r.parent_reservation_id ? String(r.parent_reservation_id) : null,
      booking_code: r.booking_code ?? null,
      source: r.source ?? null,
      checkin_date: r.checkin_date ?? null,
      checkout_date: r.checkout_date ?? null,
      checked_in_at: r.checked_in_at ?? null,
      status: r.status ?? null,
      total_price: r.total_price ?? null,
    });
  }

  // Collect all root IDs we need to look up
  const rootIdsNeeded = new Set<string>();
  // Also collect IDs that ARE roots (have children pointing to them)
  const selfRootIds = new Set<string>();
  for (const r of inputById.values()) {
    if (r.parent_reservation_id) {
      rootIdsNeeded.add(r.parent_reservation_id);
    } else {
      selfRootIds.add(r.id);
    }
  }

  // All root IDs to fetch (those not already in inputById)
  const missingRootIds = Array.from(rootIdsNeeded).filter((id) => !inputById.has(id));

  // All root IDs for which we need to find children
  const allRootIds = Array.from(new Set([...rootIdsNeeded, ...selfRootIds]));

  // ── 2 batch queries instead of 3*N ──
  const [rootsResult, childrenResult] = await Promise.all([
    missingRootIds.length > 0
      ? supabase
          .from("reservations")
          .select(LINKED_STAY_SELECT)
          .in("id", missingRootIds)
      : Promise.resolve({ data: [] as any[], error: null }),
    allRootIds.length > 0
      ? supabase
          .from("reservations")
          .select(LINKED_STAY_SELECT)
          .in("parent_reservation_id", allRootIds)
          .order("checkin_date", { ascending: true })
      : Promise.resolve({ data: [] as any[], error: null }),
  ]);

  // If either query fails, fall back gracefully (return all null)
  if (rootsResult.error || childrenResult.error) {
    for (const r of reservations) result.set(String(r.id), null);
    return result;
  }

  // Build a combined map of ALL reservation records we know about
  const allRecords = new Map<string, ReservationRecord>(inputById);
  for (const row of (rootsResult.data ?? []) as ReservationRecord[]) {
    if (row?.id) allRecords.set(String(row.id), row);
  }
  for (const row of (childrenResult.data ?? []) as ReservationRecord[]) {
    if (row?.id) allRecords.set(String(row.id), row);
  }

  // Now build LinkedStay for each input reservation using pure logic
  for (const r of reservations) {
    const id = String(r.id ?? "");
    if (!id) {
      result.set(id, null);
      continue;
    }
    const current = allRecords.get(id);
    if (!current) {
      result.set(id, null);
      continue;
    }
    try {
      result.set(id, buildLinkedStayFromRecords(current, allRecords, checkOutTimeHHmm));
    } catch {
      result.set(id, null);
    }
  }

  return result;
}
