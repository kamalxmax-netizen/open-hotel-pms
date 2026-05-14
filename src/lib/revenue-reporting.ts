export type RevenueRoomRow = {
  id: string;
  room_number?: string | null;
  floor_number?: number | null;
  is_dayuse?: boolean | null;
  closure_reason?: string | null;
  is_sellable?: boolean | null;
};

export type RevenueReservationRow = {
  id?: string | null;
  guest_name?: string | null;
  booking_code?: string | null;
  source?: string | null;
  checkin_date?: string | null;
  checkout_date?: string | null;
  is_dayuse?: boolean | null;
  status?: string | null;
};

export type RevenueNightRow = {
  room_id?: string | null;
  stay_date: string;
  nightly_price?: number | string | null;
  reservations?: RevenueReservationRow | RevenueReservationRow[] | null;
};

export type RevenueExtraRow = {
  id?: string | null;
  paid_date?: string | null;
  paid_at?: string | null;
  method?: string | null;
  tx_type?: string | null;
  amount?: number | string | null;
  note?: string | null;
  revenue_category?: string | null;
  is_record_only?: boolean | null;
  is_correction?: boolean | null;
  is_void_reversal?: boolean | null;
  void_of?: string | null;
};

export type RevenuePosOrderRow = {
  total?: number | string | null;
  status?: string | null;
  order_date?: string | null;
};

export type RevenueSource = "walkin" | "ota" | "direct" | "agent";

export type RevenueDailyRoom = {
  room_number: string | null;
  floor_number: number;
  is_occupied: boolean;
  nightly_price: number;
  guest_name: string | null;
  booking_code: string | null;
  source: string | null;
  night_label: string | null;
};

export type RevenueDailyDayuse = {
  room_number: string;
  sessions: number;
  revenue: number;
};

export type RevenueRangeDay = {
  date: string;
  revenue: number;
  room_revenue: number;
  dayuse_revenue: number;
  extra_revenue: number;
  pos_revenue: number;
  total_revenue: number;
  occupied: number;
  occ_pct: number;
};

type RevenueDayAccumulator = {
  room_revenue: number;
  dayuse_revenue: number;
  extra_revenue: number;
  pos_revenue: number;
  occupied: number;
};

const REVENUE_SOURCES: RevenueSource[] = ["walkin", "ota", "direct", "agent"];

export function round2(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

function toNumber(value: unknown): number {
  const num = typeof value === "number" ? value : Number(value);
  return Number.isFinite(num) ? num : 0;
}

function asReservation(value: RevenueNightRow["reservations"]): RevenueReservationRow | null {
  if (!value) return null;
  return (Array.isArray(value) ? value[0] : value) ?? null;
}

function normalizeSource(value: unknown): RevenueSource {
  const source = String(value ?? "").trim().toLowerCase();
  if (source === "ota" || source === "direct" || source === "agent") return source;
  return "walkin";
}

export function isRevenueHiddenByReason(reason: string | null | undefined): boolean {
  const text = String(reason ?? "").toLowerCase();
  if (!text) return false;
  return /block|reno|renovat|ปรับปรุง|ซ่อม/.test(text);
}

export function isRevenueCancelledReservation(reservation: RevenueReservationRow | null): boolean {
  return String(reservation?.status ?? "").trim().toLowerCase() === "cancelled";
}

export function getRevenueBaseRooms(rooms: RevenueRoomRow[]): RevenueRoomRow[] {
  return rooms.filter((room) => room.is_sellable !== false && !isRevenueHiddenByReason(room.closure_reason));
}

export function getRegularRevenueRooms(rooms: RevenueRoomRow[]): RevenueRoomRow[] {
  return getRevenueBaseRooms(rooms).filter((room) => room.is_dayuse !== true);
}

function createRoomById(rooms: RevenueRoomRow[]): Map<string, RevenueRoomRow> {
  return new Map(getRevenueBaseRooms(rooms).map((room) => [String(room.id), room]));
}

export function computeRevenueNightLabel(
  targetDate: string,
  checkin: string | null | undefined,
  checkout: string | null | undefined
): string | null {
  if (!checkin || !checkout) return null;
  const checkinDate = new Date(`${checkin}T00:00:00+07:00`);
  const checkoutDate = new Date(`${checkout}T00:00:00+07:00`);
  const target = new Date(`${targetDate}T00:00:00+07:00`);
  if (Number.isNaN(checkinDate.getTime()) || Number.isNaN(checkoutDate.getTime()) || Number.isNaN(target.getTime())) {
    return null;
  }
  const totalNights = Math.max(1, Math.round((checkoutDate.getTime() - checkinDate.getTime()) / 86400000));
  const index = Math.max(1, Math.min(totalNights, Math.round((target.getTime() - checkinDate.getTime()) / 86400000) + 1));
  return `${index}/${totalNights}`;
}

function isDayuseNight(room: RevenueRoomRow, reservation: RevenueReservationRow): boolean {
  return room.is_dayuse === true || reservation.is_dayuse === true;
}

function normalizeRevenueTxType(raw: unknown): "payment" | "deposit" | "refund" {
  const value = String(raw ?? "").trim().toLowerCase();
  if (value === "deposit") return "deposit";
  if (value === "refund") return "refund";
  return "payment";
}

function normalizeRevenueCategory(rawCategory: unknown, txType: "payment" | "deposit" | "refund", rawNote: unknown): string {
  const category = String(rawCategory ?? "").trim().toLowerCase() || "room_revenue";
  if (txType === "refund" && category !== "deposit") {
    const note = String(rawNote ?? "").toLowerCase();
    if (note.includes("deposit") && note.includes("refund")) return "deposit";
  }
  return category;
}

function buildRevenueVoidedIdSet(rows: RevenueExtraRow[], laterVoidedOriginalIds: Set<string>): Set<string> {
  const excluded = new Set<string>();
  const scopedIds = new Set(rows.map((row) => String(row.id ?? "").trim()).filter(Boolean));

  for (const originalId of laterVoidedOriginalIds) {
    if (originalId) excluded.add(originalId);
  }

  for (const row of rows) {
    const originalId = String(row.void_of ?? "").trim();
    const reversalId = String(row.id ?? "").trim();
    if (!originalId) continue;
    if (!scopedIds.has(originalId)) continue;
    excluded.add(originalId);
    if (reversalId) excluded.add(reversalId);
  }
  return excluded;
}

export function sumExtraRevenue(
  rows: RevenueExtraRow[],
  laterVoidedOriginalIds: Set<string> = new Set()
): number {
  const voidedIds = buildRevenueVoidedIdSet(rows, laterVoidedOriginalIds);
  let total = 0;

  for (const row of rows) {
    const id = String(row.id ?? "").trim();
    if (id && voidedIds.has(id)) continue;
    if (row.is_void_reversal === true) continue;

    const txType = normalizeRevenueTxType(row.tx_type);
    if (txType !== "payment" && txType !== "refund") continue;

    const category = normalizeRevenueCategory(row.revenue_category, txType, row.note);
    if (category !== "extra_charge") continue;

    const amount = toNumber(row.amount);
    total += txType === "refund" ? -amount : amount;
  }

  return round2(total);
}

export function sumExtraRevenueByDate(
  rows: RevenueExtraRow[],
  laterVoidedOriginalIds: Set<string> = new Set()
): Map<string, number> {
  const voidedIds = buildRevenueVoidedIdSet(rows, laterVoidedOriginalIds);
  const byDate = new Map<string, number>();

  for (const row of rows) {
    const id = String(row.id ?? "").trim();
    if (id && voidedIds.has(id)) continue;
    if (row.is_void_reversal === true) continue;
    if (!row.paid_date) continue;

    const txType = normalizeRevenueTxType(row.tx_type);
    if (txType !== "payment" && txType !== "refund") continue;

    const category = normalizeRevenueCategory(row.revenue_category, txType, row.note);
    if (category !== "extra_charge") continue;

    const amount = txType === "refund" ? -toNumber(row.amount) : toNumber(row.amount);
    byDate.set(row.paid_date, round2((byDate.get(row.paid_date) ?? 0) + amount));
  }

  return byDate;
}

export function sumPosRevenue(rows: RevenuePosOrderRow[]): number {
  return round2(
    rows.reduce((sum, row) => {
      const status = String(row.status ?? "completed").trim().toLowerCase();
      if (status !== "completed") return sum;
      return sum + toNumber(row.total);
    }, 0)
  );
}

export function sumPosRevenueByDate(rows: RevenuePosOrderRow[]): Map<string, number> {
  const byDate = new Map<string, number>();
  for (const row of rows) {
    const status = String(row.status ?? "completed").trim().toLowerCase();
    if (status !== "completed") continue;
    if (!row.order_date) continue;
    byDate.set(row.order_date, round2((byDate.get(row.order_date) ?? 0) + toNumber(row.total)));
  }
  return byDate;
}

export function summarizeDailyRevenue(input: {
  rooms: RevenueRoomRow[];
  nights: RevenueNightRow[];
  extraRows?: RevenueExtraRow[];
  laterVoidedExtraOriginalIds?: Set<string>;
  posOrders?: RevenuePosOrderRow[];
  businessDate: string;
}): {
  rooms: RevenueDailyRoom[];
  dayuse: RevenueDailyDayuse[];
  roomRevenue: number;
  dayuseRevenue: number;
  extraRevenue: number;
  posRevenue: number;
  totalRevenueExcludingPos: number;
  totalRevenueIncludingPos: number;
  occupiedRooms: number;
  sellableRooms: number;
  occupancyPct: number;
  adr: number;
  revpar: number;
} {
  const roomById = createRoomById(input.rooms);
  const regularRooms = getRegularRevenueRooms(input.rooms);
  const regularByRoomId = new Map<
    string,
    {
      nightly_price: number;
      guest_name: string | null;
      booking_code: string | null;
      source: string | null;
      night_label: string | null;
    }
  >();
  const dayuseByRoomId = new Map<string, { sessions: number; revenue: number }>();

  for (const row of input.nights) {
    if (!row.room_id) continue;
    const reservation = asReservation(row.reservations);
    if (!reservation || isRevenueCancelledReservation(reservation)) continue;
    const room = roomById.get(row.room_id);
    if (!room) continue;

    const amount = toNumber(row.nightly_price);
    if (isDayuseNight(room, reservation)) {
      const current = dayuseByRoomId.get(row.room_id) ?? { sessions: 0, revenue: 0 };
      current.sessions += 1;
      current.revenue += amount;
      dayuseByRoomId.set(row.room_id, current);
      continue;
    }

    const current = regularByRoomId.get(row.room_id) ?? {
      nightly_price: 0,
      guest_name: reservation.guest_name ?? null,
      booking_code: reservation.booking_code ?? null,
      source: reservation.source ?? null,
      night_label: computeRevenueNightLabel(input.businessDate, reservation.checkin_date, reservation.checkout_date),
    };
    current.nightly_price += amount;
    current.guest_name = current.guest_name ?? reservation.guest_name ?? null;
    current.booking_code = current.booking_code ?? reservation.booking_code ?? null;
    current.source = current.source ?? reservation.source ?? null;
    if (!current.night_label) {
      current.night_label = computeRevenueNightLabel(input.businessDate, reservation.checkin_date, reservation.checkout_date);
    }
    regularByRoomId.set(row.room_id, current);
  }

  const rooms = regularRooms.map((room) => {
    const revenue = regularByRoomId.get(room.id);
    return {
      room_number: room.room_number ?? null,
      floor_number: room.floor_number ?? 0,
      is_occupied: Boolean(revenue),
      nightly_price: round2(revenue?.nightly_price ?? 0),
      guest_name: revenue?.guest_name ?? null,
      booking_code: revenue?.booking_code ?? null,
      source: revenue?.source ?? null,
      night_label: revenue?.night_label ?? null,
    };
  });

  const dayuse = Array.from(dayuseByRoomId.entries())
    .map(([roomId, data]) => {
      const room = roomById.get(roomId);
      return {
        room_number: room?.room_number ?? "DAYUSE",
        sessions: data.sessions,
        revenue: round2(data.revenue),
      };
    })
    .sort((a, b) => a.room_number.localeCompare(b.room_number, undefined, { numeric: true, sensitivity: "base" }));

  const roomRevenue = round2(rooms.reduce((sum, row) => sum + row.nightly_price, 0));
  const dayuseRevenue = round2(dayuse.reduce((sum, row) => sum + row.revenue, 0));
  const extraRevenue = sumExtraRevenue(input.extraRows ?? [], input.laterVoidedExtraOriginalIds);
  const posRevenue = sumPosRevenue(input.posOrders ?? []);
  const occupiedRooms = rooms.filter((row) => row.is_occupied).length;
  const sellableRooms = rooms.length;
  const occupancyPct = sellableRooms > 0 ? round2((occupiedRooms / sellableRooms) * 100) : 0;
  const adr = occupiedRooms > 0 ? round2(roomRevenue / occupiedRooms) : 0;
  const revpar = sellableRooms > 0 ? round2(roomRevenue / sellableRooms) : 0;
  const totalRevenueExcludingPos = round2(roomRevenue + dayuseRevenue + extraRevenue);
  const totalRevenueIncludingPos = round2(totalRevenueExcludingPos + posRevenue);

  return {
    rooms,
    dayuse,
    roomRevenue,
    dayuseRevenue,
    extraRevenue,
    posRevenue,
    totalRevenueExcludingPos,
    totalRevenueIncludingPos,
    occupiedRooms,
    sellableRooms,
    occupancyPct,
    adr,
    revpar,
  };
}

function addDays(date: string, days: number): string {
  const [year, month, day] = date.split("-").map((value) => Number(value));
  const next = new Date(Date.UTC(year, month - 1, day + days));
  return next.toISOString().slice(0, 10);
}

function dayCountInclusive(startDate: string, endDate: string): number {
  const [startYear, startMonth, startDay] = startDate.split("-").map((value) => Number(value));
  const [endYear, endMonth, endDay] = endDate.split("-").map((value) => Number(value));
  const start = Date.UTC(startYear, startMonth - 1, startDay);
  const end = Date.UTC(endYear, endMonth - 1, endDay);
  return Math.max(0, Math.round((end - start) / 86400000) + 1);
}

function isWithinDateRange(date: string | null | undefined, startDate: string, endDate: string): date is string {
  return Boolean(date && date >= startDate && date <= endDate);
}

export function summarizeRevenueRange(input: {
  rooms: RevenueRoomRow[];
  nights: RevenueNightRow[];
  extraRows?: RevenueExtraRow[];
  laterVoidedExtraOriginalIds?: Set<string>;
  posOrders?: RevenuePosOrderRow[];
  startDate: string;
  endDate: string;
}): {
  day_count: number;
  sellable_rooms: number;
  kpi: {
    total_revenue: number;
    room_revenue: number;
    dayuse_revenue: number;
    extra_revenue: number;
    pos_revenue: number;
    occupied_nights: number;
    room_nights: number;
    occupancy_pct: number;
    adr: number;
    revpar: number;
  };
  by_source: Array<{ source: RevenueSource; nights: number; revenue: number; share_pct: number }>;
  by_day: RevenueRangeDay[];
} {
  const roomById = createRoomById(input.rooms);
  const sellableRooms = getRegularRevenueRooms(input.rooms).length;
  const dayCount = dayCountInclusive(input.startDate, input.endDate);
  const dayMap = new Map<string, RevenueDayAccumulator>();

  for (let i = 0; i < dayCount; i += 1) {
    dayMap.set(addDays(input.startDate, i), {
      room_revenue: 0,
      dayuse_revenue: 0,
      extra_revenue: 0,
      pos_revenue: 0,
      occupied: 0,
    });
  }

  const sourceAgg: Record<RevenueSource, { nights: number; revenue: number }> = {
    walkin: { nights: 0, revenue: 0 },
    ota: { nights: 0, revenue: 0 },
    direct: { nights: 0, revenue: 0 },
    agent: { nights: 0, revenue: 0 },
  };

  let roomRevenue = 0;
  let dayuseRevenue = 0;
  let occupiedNights = 0;

  for (const row of input.nights) {
    if (!isWithinDateRange(row.stay_date, input.startDate, input.endDate)) continue;
    if (!row.room_id) continue;
    const reservation = asReservation(row.reservations);
    if (!reservation || isRevenueCancelledReservation(reservation)) continue;
    const room = roomById.get(row.room_id);
    if (!room) continue;
    const amount = toNumber(row.nightly_price);
    const day = dayMap.get(row.stay_date);
    if (!day) continue;

    if (isDayuseNight(room, reservation)) {
      dayuseRevenue += amount;
      day.dayuse_revenue += amount;
      continue;
    }

    const source = normalizeSource(reservation.source);
    roomRevenue += amount;
    occupiedNights += 1;
    sourceAgg[source].nights += 1;
    sourceAgg[source].revenue += amount;
    day.room_revenue += amount;
    day.occupied += 1;
  }

  for (const [date, amount] of sumExtraRevenueByDate(input.extraRows ?? [], input.laterVoidedExtraOriginalIds)) {
    if (!isWithinDateRange(date, input.startDate, input.endDate)) continue;
    const day = dayMap.get(date);
    if (day) day.extra_revenue += amount;
  }

  for (const [date, amount] of sumPosRevenueByDate(input.posOrders ?? [])) {
    if (!isWithinDateRange(date, input.startDate, input.endDate)) continue;
    const day = dayMap.get(date);
    if (day) day.pos_revenue += amount;
  }

  const byDay = Array.from(dayMap.entries()).map(([date, day]) => {
    const room = round2(day.room_revenue);
    const dayuse = round2(day.dayuse_revenue);
    const extra = round2(day.extra_revenue);
    const pos = round2(day.pos_revenue);
    const total = round2(room + dayuse + extra + pos);
    return {
      date,
      revenue: total,
      room_revenue: room,
      dayuse_revenue: dayuse,
      extra_revenue: extra,
      pos_revenue: pos,
      total_revenue: total,
      occupied: day.occupied,
      occ_pct: sellableRooms > 0 ? round2((day.occupied / sellableRooms) * 100) : 0,
    };
  });

  const extraRevenue = round2(byDay.reduce((sum, day) => sum + day.extra_revenue, 0));
  const posRevenue = round2(byDay.reduce((sum, day) => sum + day.pos_revenue, 0));
  const roundedRoomRevenue = round2(roomRevenue);
  const roundedDayuseRevenue = round2(dayuseRevenue);
  const totalRevenue = round2(roundedRoomRevenue + roundedDayuseRevenue + extraRevenue + posRevenue);
  const roomNights = sellableRooms * dayCount;
  const occupancyPct = roomNights > 0 ? round2((occupiedNights / roomNights) * 100) : 0;
  const adr = occupiedNights > 0 ? round2(roundedRoomRevenue / occupiedNights) : 0;
  const revpar = roomNights > 0 ? round2(roundedRoomRevenue / roomNights) : 0;

  return {
    day_count: dayCount,
    sellable_rooms: sellableRooms,
    kpi: {
      total_revenue: totalRevenue,
      room_revenue: roundedRoomRevenue,
      dayuse_revenue: roundedDayuseRevenue,
      extra_revenue: extraRevenue,
      pos_revenue: posRevenue,
      occupied_nights: occupiedNights,
      room_nights: roomNights,
      occupancy_pct: occupancyPct,
      adr,
      revpar,
    },
    by_source: REVENUE_SOURCES.map((source) => ({
      source,
      nights: sourceAgg[source].nights,
      revenue: round2(sourceAgg[source].revenue),
      share_pct: roundedRoomRevenue > 0 ? round2((sourceAgg[source].revenue / roundedRoomRevenue) * 100) : 0,
    })),
    by_day: byDay,
  };
}
