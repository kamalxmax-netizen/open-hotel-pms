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
  status: string | null;
  total_price: number;
  is_parent: boolean;
};

export type LinkedStay = {
  segments: LinkedStaySegment[];
  full_checkin: string;
  full_checkout: string;
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

async function loadHotelCheckOutTime(supabase: SupabaseLike, fallback = "12:00"): Promise<string> {
  const { data, error } = await supabase
    .from("hotel_settings")
    .select("check_out_time")
    .eq("id", 1)
    .maybeSingle();

  if (error) return fallback;
  return normalizeTimeHHmm(data?.check_out_time, fallback);
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
  const fullNights = fullCheckin && fullCheckout ? listNights(fullCheckin, fullCheckout).length : 0;
  const combinedTotal = segments.reduce((sum, segment) => sum + segment.total_price, 0);
  const { today, timeHHmm } = getBangkokNowParts();
  const activeSegmentId = resolveActiveSegmentId(segments, today, timeHHmm, checkOutTimeHHmm);

  return {
    segments,
    full_checkin: fullCheckin,
    full_checkout: fullCheckout,
    full_nights: fullNights,
    combined_total: combinedTotal,
    active_segment_id: activeSegmentId,
  };
}
