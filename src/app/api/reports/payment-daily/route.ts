import { createServerSupabaseClient } from "@/lib/supabase/server";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

export const dynamic = "force-dynamic";
export const fetchCache = "force-no-store";

const dateRegex = /^\d{4}-\d{2}-\d{2}$/;
const querySchema = z.object({
  date: z.string().regex(dateRegex, "date must be YYYY-MM-DD").optional(),
});

const METHOD_KEYS = ["cash", "transfer", "credit_card", "other"] as const;
type MethodKey = (typeof METHOD_KEYS)[number];
type TxType = "payment" | "deposit" | "refund";

type MethodBreakdown = {
  payment: number;
  deposit: number;
  refund: number;
  net: number;
};

type MethodsMap = {
  cash: MethodBreakdown;
  transfer: MethodBreakdown;
  credit_card: MethodBreakdown;
  other: MethodBreakdown;
};

type RoomBaseRow = {
  id: string;
  room_number: string;
  floor_number: number | null;
  is_dayuse: boolean | null;
  closure_reason: string | null;
  is_sellable: boolean | null;
};

type PaymentRow = {
  id: string;
  reservation_id: string | null;
  pos_order_id: string | null;
  paid_date: string | null;
  paid_at: string | null;
  method: string | null;
  tx_type: string | null;
  amount: number | null;
  note: string | null;
  revenue_category: string | null;
  is_record_only?: boolean | null;
  is_correction?: boolean | null;
  is_void_reversal?: boolean | null;
  void_of?: string | null;
};

type ReservationRow = {
  id: string;
  parent_reservation_id: string | null;
  status: string | null;
  source: string | null;
  guest_name: string | null;
  booking_code: string | null;
  checkin_date: string | null;
  checkout_date: string | null;
  total_price: number | null;
  is_dayuse: boolean | null;
};

type StayFlow = "due_out" | "due_in" | "in_house" | "normal";

type ReservationNightRoom = {
  stay_date: string;
  room_id: string | null;
  room_number: string | null;
  floor_number: number | null;
};

type PosOrderRow = {
  total: number | null;
  payment_method: string | null;
};

type PosOrderItemRow = {
  order_id: string | null;
  product_name: string | null;
  quantity: number | null;
};

type LinkedReservationRow = {
  id: string;
  parent_reservation_id: string | null;
  booking_code: string | null;
  source: string | null;
  checkin_date: string | null;
  checkout_date: string | null;
};

type LinkedStaySegment = {
  reservation_id: string;
  booking_code: string | null;
  source: string | null;
  checkin_date: string | null;
  checkout_date: string | null;
  is_parent: boolean;
};

function isPosDepositRecord(txType: TxType, category: string, note: string): boolean {
  if (txType !== "payment") return false;
  if (category !== "pos_revenue") return false;
  return note.toLowerCase().includes("paid by deposit");
}

function extractRoomNumberFromDepositNote(note: string): string | null {
  const match = note.match(/\broom\s+([A-Za-z0-9-]+)\b/i);
  return match?.[1] ?? null;
}

function buildPosItemSummary(items: PosOrderItemRow[]): string {
  if (!items.length) return "";
  const agg = new Map<string, number>();
  for (const row of items) {
    const name = String(row.product_name ?? "").trim();
    if (!name) continue;
    const qty = Number(row.quantity ?? 0);
    const current = agg.get(name) ?? 0;
    agg.set(name, current + (qty > 0 ? qty : 0));
  }
  if (agg.size === 0) return "";
  const parts = Array.from(agg.entries()).map(([name, qty]) => `${name} x${qty}`);
  return parts.join(", ");
}

function toBangkokDateString(date = new Date()): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Bangkok",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);
  const y = parts.find((p) => p.type === "year")?.value;
  const m = parts.find((p) => p.type === "month")?.value;
  const d = parts.find((p) => p.type === "day")?.value;
  if (!y || !m || !d) return new Date().toISOString().slice(0, 10);
  return `${y}-${m}-${d}`;
}

function round2(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

function normalizeMethod(raw: unknown): MethodKey {
  const value = String(raw ?? "").trim().toLowerCase();
  if (!value) return "other";
  if (value === "cash") return "cash";
  if (value === "transfer") return "transfer";
  if (value === "credit_card") return "credit_card";
  if (value === "other") return "other";
  if (value.includes("promptpay")) return "transfer";
  if (value.includes("bank transfer")) return "transfer";
  if (value.includes("transfer")) return "transfer";
  if (value.includes("credit")) return "credit_card";
  if (value.includes("card")) return "credit_card";
  if (value.includes("cash")) return "cash";
  return "other";
}

function normalizeTxType(raw: unknown): TxType {
  const value = String(raw ?? "").toLowerCase();
  if (value === "deposit") return "deposit";
  if (value === "refund") return "refund";
  return "payment";
}

function isDepositRefundEntry(txType: TxType, category: string, note: string): boolean {
  if (txType !== "refund") return false;
  if (note.toLowerCase().includes("paid by deposit")) return false;
  if (note.toLowerCase().includes("void return to deposit")) return false;
  if (category === "deposit") return true;
  const lowered = note.toLowerCase();
  return lowered.includes("deposit") && lowered.includes("refund");
}

function createMethodBreakdown(): MethodBreakdown {
  return { payment: 0, deposit: 0, refund: 0, net: 0 };
}

function createMethodsMap(): MethodsMap {
  return {
    cash: createMethodBreakdown(),
    transfer: createMethodBreakdown(),
    credit_card: createMethodBreakdown(),
    other: createMethodBreakdown(),
  };
}

function finalizeMethods(map: MethodsMap): MethodsMap {
  const out = createMethodsMap();
  for (const key of METHOD_KEYS) {
    const row = map[key];
    out[key] = {
      payment: round2(row.payment),
      deposit: round2(row.deposit),
      refund: round2(row.refund),
      net: round2(row.payment + row.deposit - row.refund),
    };
  }
  return out;
}

function applyMethodMovement(methods: MethodsMap, method: MethodKey, txType: TxType, amount: number): void {
  if (txType === "deposit") methods[method].deposit += amount;
  else if (txType === "refund") methods[method].refund += amount;
  else methods[method].payment += amount;
}

function applyCorrectionMovement(methods: MethodsMap, method: MethodKey, txType: TxType, amount: number): void {
  if (txType === "deposit") {
    methods[method].deposit += amount;
    return;
  }
  const signed = txType === "refund" ? -amount : amount;
  methods[method].payment += signed;
}

function buildPolicyFeeDedupKey(row: PaymentRow): string {
  const reservationId = String(row.reservation_id ?? "");
  const paidAt = String(row.paid_at ?? "");
  const method = normalizeMethod(row.method);
  const amount = round2(Number(row.amount ?? 0)).toFixed(2);
  const note = String(row.note ?? "").trim().toLowerCase();
  return `${reservationId}|${paidAt}|${method}|${amount}|${note}`;
}

function buildVoidedPaymentIdSet(rows: PaymentRow[]): Set<string> {
  const excluded = new Set<string>();
  for (const row of rows) {
    const reversalId = String(row.id ?? "").trim();
    const originalId = String(row.void_of ?? "").trim();
    if (!originalId) continue;
    if (originalId) excluded.add(originalId);
    if (reversalId) excluded.add(reversalId);
  }
  return excluded;
}

function methodsNet(methods: MethodsMap): number {
  return round2(
    METHOD_KEYS.reduce(
      (sum, key) => sum + methods[key].payment + methods[key].deposit - methods[key].refund,
      0
    )
  );
}

function methodsVisibleNet(methods: MethodsMap): number {
  return round2(
    METHOD_KEYS.reduce(
      (sum, key) => sum + methods[key].payment - methods[key].refund,
      0
    )
  );
}

function sumMethods(list: MethodsMap[]): MethodsMap {
  const out = createMethodsMap();
  for (const map of list) {
    for (const key of METHOD_KEYS) {
      out[key].payment += map[key].payment;
      out[key].deposit += map[key].deposit;
      out[key].refund += map[key].refund;
    }
  }
  return finalizeMethods(out);
}

function isHiddenByReason(reason: string | null): boolean {
  const text = String(reason ?? "").toLowerCase();
  if (!text) return false;
  return /block|reno|renovat|ปรับปรุง|ซ่อม/.test(text);
}

const SOURCE_LABELS: Record<string, string> = {
  walkin: "Walk-in",
  ota: "OTA",
  direct: "Direct",
  agent: "Agent",
};

function formatSourceLabel(source: string | null | undefined): string {
  const raw = String(source ?? "").trim();
  if (!raw) return "unknown";
  return SOURCE_LABELS[raw.toLowerCase()] ?? raw;
}

function formatCompactStayRange(checkinDate: string | null, checkoutDate: string | null): string {
  const checkin = String(checkinDate ?? "").trim();
  const checkout = String(checkoutDate ?? "").trim();
  if (!checkin || !checkout) return `${checkin || "—"}-${checkout || "—"}`;

  const start = new Date(`${checkin}T00:00:00`);
  const end = new Date(`${checkout}T00:00:00`);
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) {
    return `${checkin}-${checkout}`;
  }

  const startDay = start.getDate();
  const startMonth = start.getMonth() + 1;
  const endDay = end.getDate();
  const endMonth = end.getMonth() + 1;

  if (start.getFullYear() === end.getFullYear() && startMonth === endMonth) {
    return `${startDay}-${endDay}/${endMonth}`;
  }
  return `${startDay}/${startMonth}-${endDay}/${endMonth}`;
}

function buildLinkedStayRemark(segments: LinkedStaySegment[]): string | null {
  if (segments.length <= 1) return null;

  const ordered = [...segments].sort((left, right) => {
    const dateCmp = String(left.checkin_date ?? "").localeCompare(String(right.checkin_date ?? ""));
    if (dateCmp !== 0) return dateCmp;
    if (left.is_parent !== right.is_parent) return left.is_parent ? -1 : 1;
    return String(left.booking_code ?? "").localeCompare(String(right.booking_code ?? ""));
  });

  const parts = ordered.map((segment) => {
    const source = formatSourceLabel(segment.source);
    const bookingCode = String(segment.booking_code ?? segment.reservation_id);
    const range = formatCompactStayRange(segment.checkin_date, segment.checkout_date);
    return `${source}(${bookingCode} ${range})`;
  });

  return `Linked Stay: ${parts.join(" → ")}`;
}

function buildLinkedStayRemarkMap(rows: LinkedReservationRow[]): Map<string, string> {
  const rowsById = new Map(rows.map((row) => [row.id, row]));
  const childIdsByParentId = new Map<string, string[]>();

  for (const row of rows) {
    if (!row.parent_reservation_id) continue;
    const parentId = String(row.parent_reservation_id);
    const children = childIdsByParentId.get(parentId) ?? [];
    children.push(row.id);
    childIdsByParentId.set(parentId, children);
  }

  const remarkByReservationId = new Map<string, string>();

  for (const row of rows) {
    const parentId = row.parent_reservation_id ? String(row.parent_reservation_id) : null;
    const groupId = parentId || (childIdsByParentId.has(row.id) ? row.id : null);
    if (!groupId) continue;

    const parentRow = rowsById.get(groupId);
    if (!parentRow) continue;

    const childIds = childIdsByParentId.get(groupId) ?? [];
    const relatedRows = [
      parentRow,
      ...childIds
        .map((childId) => rowsById.get(childId))
        .filter((item): item is LinkedReservationRow => Boolean(item)),
    ];

    const uniqueRows = Array.from(new Map(relatedRows.map((item) => [item.id, item])).values());
    if (uniqueRows.length <= 1) continue;

    const remark = buildLinkedStayRemark(
      uniqueRows.map((item) => ({
        reservation_id: item.id,
        booking_code: item.booking_code,
        source: item.source,
        checkin_date: item.checkin_date,
        checkout_date: item.checkout_date,
        is_parent: item.id === groupId,
      }))
    );
    if (!remark) continue;

    for (const item of uniqueRows) {
      remarkByReservationId.set(item.id, remark);
    }
  }

  return remarkByReservationId;
}

function resolveRoomForDate(
  nights: ReservationNightRoom[] | undefined,
  paidDate: string,
  checkinDate: string | null
): { room_number: string | null; floor_number: number | null; room_id: string | null } {
  if (!nights || nights.length === 0) {
    return { room_number: null, floor_number: null, room_id: null };
  }

  const exact = nights.find((n) => n.stay_date === paidDate && n.room_number);
  if (exact) {
    return { room_number: exact.room_number, floor_number: exact.floor_number, room_id: exact.room_id };
  }

  const latestBeforeOrOn = [...nights]
    .filter((n) => n.stay_date <= paidDate && n.room_number)
    .sort((a, b) => b.stay_date.localeCompare(a.stay_date))[0];
  if (latestBeforeOrOn) {
    return {
      room_number: latestBeforeOrOn.room_number,
      floor_number: latestBeforeOrOn.floor_number,
      room_id: latestBeforeOrOn.room_id,
    };
  }

  const target = checkinDate ?? paidDate;
  const earliestAfter = [...nights]
    .filter((n) => n.stay_date >= target && n.room_number)
    .sort((a, b) => a.stay_date.localeCompare(b.stay_date))[0];
  if (earliestAfter) {
    return { room_number: earliestAfter.room_number, floor_number: earliestAfter.floor_number, room_id: earliestAfter.room_id };
  }

  const fallback = nights.find((n) => n.room_number) ?? null;
  if (fallback) {
    return { room_number: fallback.room_number, floor_number: fallback.floor_number, room_id: fallback.room_id };
  }

  return { room_number: null, floor_number: null, room_id: null };
}

function resolveStayFlow(
  checkinDate: string | null | undefined,
  checkoutDate: string | null | undefined,
  businessDate: string
): StayFlow {
  if (checkoutDate && checkoutDate === businessDate) return "due_out";
  if (checkinDate && checkinDate === businessDate) return "due_in";
  if (checkinDate && checkoutDate && checkinDate < businessDate && checkoutDate > businessDate) {
    return "in_house";
  }
  return "normal";
}

function stayFlowSortRank(flow: StayFlow): number {
  if (flow === "due_out") return 0;
  if (flow === "due_in") return 1;
  if (flow === "in_house") return 2;
  return 3;
}

export async function GET(request: NextRequest) {
  try {
    const parsed = querySchema.safeParse({
      date: request.nextUrl.searchParams.get("date") ?? undefined,
    });
    if (!parsed.success) {
      return NextResponse.json(
        { success: false, error: "Invalid query.", details: parsed.error.flatten() },
        { status: 400 }
      );
    }

    const businessDate = parsed.data.date ?? toBangkokDateString();
    const supabase = createServerSupabaseClient();

    const [roomsRes, occupancyRes, paymentsRes, posRes] = await Promise.all([
      supabase
        .from("rooms")
        .select("id, room_number, floor_number, is_dayuse, closure_reason, is_sellable")
        .eq("is_sellable", true)
        .order("floor_number", { ascending: true, nullsFirst: false })
        .order("room_number", { ascending: true }),
      supabase
        .from("reservation_nights")
        .select("room_id, reservation_id, reservations!inner(id, guest_name, booking_code, checkin_date, checkout_date, is_dayuse, status)")
        .eq("stay_date", businessDate)
        .is("cancelled_at", null)
        .neq("reservations.status", "cancelled"),
      supabase
        .from("folio_payments")
        .select("id, reservation_id, pos_order_id, paid_date, paid_at, method, tx_type, amount, note, revenue_category, is_record_only, is_correction, is_void_reversal, void_of")
        .eq("paid_date", businessDate)
        .order("paid_at", { ascending: true }),
      supabase
        .from("pos_orders")
        .select("total, payment_method")
        .eq("order_date", businessDate)
        .eq("status", "completed")
        .eq("order_type", "walkin"),
    ]);

    if (roomsRes.error) {
      return NextResponse.json({ success: false, error: roomsRes.error.message }, { status: 500 });
    }
    if (occupancyRes.error) {
      return NextResponse.json({ success: false, error: occupancyRes.error.message }, { status: 500 });
    }
    if (paymentsRes.error) {
      return NextResponse.json({ success: false, error: paymentsRes.error.message }, { status: 500 });
    }
    if (posRes.error) {
      return NextResponse.json({ success: false, error: posRes.error.message }, { status: 500 });
    }
    const folioPayments = (paymentsRes.data ?? []) as PaymentRow[];
    const paymentRowsForDay: PaymentRow[] = [...folioPayments];
    const voidedPaymentIds = buildVoidedPaymentIdSet(paymentRowsForDay);

    const posDepositOrderIds = Array.from(
      new Set(
        paymentRowsForDay
          .filter((row) =>
            Boolean(row.pos_order_id) &&
            isPosDepositRecord(
              normalizeTxType(row.tx_type),
              String(row.revenue_category ?? "").trim().toLowerCase(),
              String(row.note ?? "").trim()
            )
          )
          .map((row) => String(row.pos_order_id))
      )
    );
    const posItemSummaryByOrderId = new Map<string, string>();
    if (posDepositOrderIds.length > 0) {
      const { data: posItems, error: posItemsError } = await supabase
        .from("pos_order_items")
        .select("order_id, product_name, quantity")
        .in("order_id", posDepositOrderIds);
      if (posItemsError) {
        return NextResponse.json({ success: false, error: posItemsError.message }, { status: 500 });
      }
      const byOrder = new Map<string, PosOrderItemRow[]>();
      for (const row of (posItems ?? []) as PosOrderItemRow[]) {
        const orderId = String(row.order_id ?? "");
        if (!orderId) continue;
        const current = byOrder.get(orderId);
        if (current) current.push(row);
        else byOrder.set(orderId, [row]);
      }
      for (const [orderId, rows] of byOrder.entries()) {
        const summary = buildPosItemSummary(rows);
        if (summary) posItemSummaryByOrderId.set(orderId, summary);
      }
    }

    const baseRooms = ((roomsRes.data ?? []) as RoomBaseRow[]).filter(
      (room) => room.is_sellable !== false && !isHiddenByReason(room.closure_reason)
    );
    const roomById = new Map(baseRooms.map((room) => [room.id, room]));
    const roomByNumber = new Map(baseRooms.map((room) => [room.room_number, room]));

    const reservationIds = new Set<string>();
    for (const row of paymentRowsForDay) {
      if (row.reservation_id) reservationIds.add(String(row.reservation_id));
    }
    for (const row of (occupancyRes.data ?? []) as any[]) {
      const rid = row?.reservations ? (Array.isArray(row.reservations) ? row.reservations[0]?.id : row.reservations?.id) : null;
      if (rid) reservationIds.add(String(rid));
    }
    const reservationIdList = Array.from(reservationIds);

    let reservationMap = new Map<string, ReservationRow>();
    let linkedRemarkByReservationId = new Map<string, string>();
    let nightsByReservation = new Map<string, ReservationNightRoom[]>();
    let cumulativePaidMap = new Map<string, number>();

    if (reservationIdList.length > 0) {
      const [reservationRes, nightsRes, cumulativeRes] = await Promise.all([
        supabase
          .from("reservations")
          .select("id, guest_name, booking_code, checkin_date, checkout_date, total_price, is_dayuse, parent_reservation_id, source, status")
          .in("id", reservationIdList),
        supabase
          .from("reservation_nights")
          .select("reservation_id, stay_date, room_id, rooms:room_id(room_number, floor_number)")
          .in("reservation_id", reservationIdList)
          .is("cancelled_at", null)
          .order("stay_date", { ascending: true }),
        supabase
          .from("folio_payments")
          .select("reservation_id, tx_type, amount")
          .in("reservation_id", reservationIdList)
          .lte("paid_date", businessDate),
      ]);

      if (reservationRes.error) {
        return NextResponse.json({ success: false, error: reservationRes.error.message }, { status: 500 });
      }
      if (nightsRes.error) {
        return NextResponse.json({ success: false, error: nightsRes.error.message }, { status: 500 });
      }
      if (cumulativeRes.error) {
        return NextResponse.json({ success: false, error: cumulativeRes.error.message }, { status: 500 });
      }

      reservationMap = new Map(
        ((reservationRes.data ?? []) as ReservationRow[]).map((row) => [row.id, row])
      );
      linkedRemarkByReservationId = buildLinkedStayRemarkMap(
        ((reservationRes.data ?? []) as LinkedReservationRow[]).map((row) => ({
          id: String(row.id),
          parent_reservation_id: row.parent_reservation_id ? String(row.parent_reservation_id) : null,
          booking_code: row.booking_code ?? null,
          source: row.source ?? null,
          checkin_date: row.checkin_date ?? null,
          checkout_date: row.checkout_date ?? null,
        }))
      );

      for (const row of (nightsRes.data ?? []) as any[]) {
        const rid = String(row.reservation_id ?? "");
        if (!rid) continue;
        const roomRef = Array.isArray(row.rooms) ? row.rooms[0] : row.rooms;
        const item: ReservationNightRoom = {
          stay_date: String(row.stay_date ?? ""),
          room_id: row.room_id ? String(row.room_id) : null,
          room_number: roomRef?.room_number ? String(roomRef.room_number) : null,
          floor_number: roomRef?.floor_number != null ? Number(roomRef.floor_number) : null,
        };
        const current = nightsByReservation.get(rid);
        if (current) current.push(item);
        else nightsByReservation.set(rid, [item]);
      }

      for (const row of (cumulativeRes.data ?? []) as Array<{ reservation_id: string | null; tx_type: string | null; amount: number | null }>) {
        if (!row.reservation_id) continue;
        const rid = String(row.reservation_id);
        const txType = normalizeTxType(row.tx_type);
        const amount = Number(row.amount ?? 0);
        const current = cumulativePaidMap.get(rid) ?? 0;
        const next = txType === "refund" ? current - amount : current + amount;
        cumulativePaidMap.set(rid, round2(next));
      }
    }

    const todayGroup = new Map<
      string,
      {
        reservation_id: string;
        room_number: string;
        floor_number: number;
        guest_name: string;
        booking_code: string;
        checkin_date: string | null;
        checkout_date: string | null;
        stay_flow: StayFlow;
        is_dayuse: boolean;
        is_cancelled: boolean;
        methods: MethodsMap;
        total_net: number;
        notes: Set<string>;
      }
    >();

    const advanceGroup = new Map<
      string,
      {
        reservation_id: string;
        booking_code: string;
        guest_name: string;
        room_number: string | null;
        checkin_date: string;
        total_price: number;
        total_paid_to_date: number;
        payment_status: "deposit" | "partial" | "full";
        is_cancelled: boolean;
        methods: MethodsMap;
        total_net: number;
        notes: Set<string>;
      }
    >();

    const roomHasPaymentToday = new Set<string>();
    const roomOccupiedToday = new Set<string>();
    const depositRefundRows: Array<{
      reservation_id: string;
      booking_code: string;
      guest_name: string;
      room_number: string | null;
      method: MethodKey;
      amount: number;
      paid_date: string;
      paid_at: string | null;
      note: string | null;
    }> = [];

    for (const row of (occupancyRes.data ?? []) as any[]) {
      if (!row?.room_id) continue;
      roomOccupiedToday.add(String(row.room_id));
    }

    const policyExtraChargeKeys = new Set<string>();
    for (const payment of paymentRowsForDay) {
      const txType = normalizeTxType(payment.tx_type);
      if (txType !== "payment") continue;
      const category = String(payment.revenue_category ?? "").trim().toLowerCase();
      const note = String(payment.note ?? "").trim().toLowerCase();
      if (category !== "extra_charge") continue;
      if (!note.includes("fee")) continue;
      policyExtraChargeKeys.add(buildPolicyFeeDedupKey(payment));
    }

    for (const payment of paymentRowsForDay) {
      if (voidedPaymentIds.has(String(payment.id ?? "").trim())) {
        continue;
      }
      const reservationId = payment.reservation_id ? String(payment.reservation_id) : "";
      const rawMethod = normalizeMethod(payment.method);
      const rawTxType = normalizeTxType(payment.tx_type);
      const amount = Number(payment.amount ?? 0);
      const note = String(payment.note ?? "").trim();
      const category = String(payment.revenue_category ?? "").trim().toLowerCase();
      const isPosDeposit = isPosDepositRecord(rawTxType, category, note);
      const isPosRemainder = rawTxType === "payment" && category === "pos_revenue" && note.toLowerCase().includes("pos remainder");
      const isRecordOnly = payment.is_record_only === true && !isPosDeposit && !isPosRemainder;
      const isCorrection = payment.is_correction === true;
      // Locked policy: any "Paid by Deposit" settlement is treated as cash movement in Payment Daily.
      const method: MethodKey = isPosDeposit ? "cash" : rawMethod;
      const txType: TxType = isPosDeposit ? "payment" : rawTxType;

      const reservation = reservationId ? reservationMap.get(reservationId) : undefined;
      if (!reservation && !isPosDeposit) continue;

      const resolvedRoom = reservation
        ? resolveRoomForDate(
            nightsByReservation.get(reservationId),
            businessDate,
            reservation.checkin_date ?? null
          )
        : { room_number: null, floor_number: null, room_id: null };

      if (
        category === "deposit" &&
        (note.toLowerCase().includes("paid by deposit") || note.toLowerCase().includes("void return to deposit"))
      ) {
        continue;
      }

      if (isDepositRefundEntry(txType, category, note)) {
        if (!reservation) continue;
        depositRefundRows.push({
          reservation_id: reservationId,
          booking_code: reservation.booking_code ?? reservationId,
          guest_name: reservation.guest_name ?? "Unknown",
          room_number: resolvedRoom.room_number,
          method,
          amount: round2(amount),
          paid_date: String(payment.paid_date ?? businessDate),
          paid_at: payment.paid_at ?? null,
          note: note || null,
        });
        continue;
      }

      // Historical hotfix guard: prevent double-count when the same policy fee was
      // inserted as both room_revenue and extra_charge in a single checkout action.
      if (
        txType === "payment"
        && category === "room_revenue"
        && policyExtraChargeKeys.has(buildPolicyFeeDedupKey(payment))
      ) {
        continue;
      }

      const fallbackRoomNumber = extractRoomNumberFromDepositNote(note);
      const resolvedRoomNumber = resolvedRoom.room_number ?? fallbackRoomNumber;
      const fallbackRoomMeta = resolvedRoomNumber ? roomByNumber.get(resolvedRoomNumber) : undefined;
      const resolvedFloorNumber =
        resolvedRoom.floor_number
        ?? fallbackRoomMeta?.floor_number
        ?? 0;
      const roomKey = resolvedRoomNumber ?? "NO ROOM";
      const posItemSummary = payment.pos_order_id ? posItemSummaryByOrderId.get(String(payment.pos_order_id)) : undefined;
      const normalizedNote = isPosDeposit
        ? `Room ${resolvedRoomNumber ?? "N/A"} Paid by Deposit${posItemSummary ? ` (POS: ${posItemSummary})` : ""}`
        : note;

      const isAdvance = Boolean(reservation?.checkin_date && reservation.checkin_date > businessDate);

      if (isAdvance) {
        if (!reservation) continue;
        const current = advanceGroup.get(reservationId) ?? {
          reservation_id: reservationId,
          booking_code: reservation.booking_code ?? reservationId,
          guest_name: reservation.guest_name ?? "Unknown",
          room_number: resolvedRoom.room_number,
          checkin_date: reservation.checkin_date ?? "",
          total_price: Number(reservation.total_price ?? 0),
          total_paid_to_date: round2(cumulativePaidMap.get(reservationId) ?? 0),
          payment_status: "deposit" as const,
          is_cancelled: String(reservation.status ?? "").toLowerCase() === "cancelled",
          methods: createMethodsMap(),
          total_net: 0,
          notes: new Set<string>(),
        };
        if (!isRecordOnly) {
          if (isCorrection) {
            applyCorrectionMovement(current.methods, method, txType, amount);
          } else {
            applyMethodMovement(current.methods, method, txType, amount);
          }
          current.total_net = round2(current.total_net + (txType === "refund" ? -amount : amount));
        }
        if (normalizedNote) {
          const suffix = isRecordOnly ? " (record-only)" : isCorrection ? " (correction)" : "";
          current.notes.add(`${normalizedNote}${suffix}`);
        }
        const linkedRemark = reservationId ? linkedRemarkByReservationId.get(reservationId) : null;
        if (linkedRemark) current.notes.add(linkedRemark);
        if (String(reservation.status ?? "").toLowerCase() === "cancelled") {
          current.notes.add("Cancelled");
        }

        const paidToDate = current.total_paid_to_date;
        if (current.total_price > 0 && paidToDate >= current.total_price - 0.01) current.payment_status = "full";
        else if (paidToDate > 0) current.payment_status = "partial";
        else current.payment_status = "deposit";

        advanceGroup.set(reservationId, current);
      } else {
        const roomNumber = roomKey;
        const floorNumber = resolvedFloorNumber;
        if (resolvedRoom.room_id) roomHasPaymentToday.add(resolvedRoom.room_id);
        const key = `${roomNumber}::${reservationId || "NO_RESERVATION"}`;
        const stayFlow = resolveStayFlow(reservation?.checkin_date, reservation?.checkout_date, businessDate);
        const current = todayGroup.get(key) ?? {
          reservation_id: reservationId || "",
          room_number: roomNumber,
          floor_number: floorNumber,
          guest_name: reservation?.guest_name ?? "Unknown",
          booking_code: (reservation?.booking_code ?? reservationId) || "POS",
          checkin_date: reservation?.checkin_date ?? null,
          checkout_date: reservation?.checkout_date ?? null,
          stay_flow: stayFlow,
          is_dayuse: Boolean(reservation?.is_dayuse),
          is_cancelled: String(reservation?.status ?? "").toLowerCase() === "cancelled",
          methods: createMethodsMap(),
          total_net: 0,
          notes: new Set<string>(),
        };
        if (!isRecordOnly) {
          if (isCorrection) {
            applyCorrectionMovement(current.methods, method, txType, amount);
          } else {
            applyMethodMovement(current.methods, method, txType, amount);
          }
          if (txType === "payment") current.total_net = round2(current.total_net + amount);
          else if (txType === "refund") current.total_net = round2(current.total_net - amount);
        }
        if (normalizedNote) {
          const suffix = isRecordOnly ? " (record-only)" : isCorrection ? " (correction)" : "";
          current.notes.add(`${normalizedNote}${suffix}`);
        }
        const linkedRemark = reservationId ? linkedRemarkByReservationId.get(reservationId) : null;
        if (linkedRemark) current.notes.add(linkedRemark);
        if (String(reservation?.status ?? "").toLowerCase() === "cancelled") {
          current.notes.add("Cancelled");
        }
        todayGroup.set(key, current);
      }
    }

    const todayRooms = Array.from(todayGroup.values())
      .map((row) => ({
        reservation_id: row.reservation_id,
        room_number: row.room_number,
        floor_number: row.floor_number,
        guest_name: row.guest_name,
        booking_code: row.booking_code,
        checkin_date: row.checkin_date,
        checkout_date: row.checkout_date,
        stay_flow: row.stay_flow,
        is_dayuse: row.is_dayuse,
        is_cancelled: row.is_cancelled,
        methods: finalizeMethods(row.methods),
        total_net: round2(row.total_net),
        notes: Array.from(row.notes),
      }))
      .sort((a, b) => {
        if (a.floor_number !== b.floor_number) return a.floor_number - b.floor_number;
        const roomCmp = a.room_number.localeCompare(b.room_number, undefined, { numeric: true, sensitivity: "base" });
        if (roomCmp !== 0) return roomCmp;
        const flowCmp = stayFlowSortRank(a.stay_flow) - stayFlowSortRank(b.stay_flow);
        if (flowCmp !== 0) return flowCmp;
        return a.booking_code.localeCompare(b.booking_code, undefined, { sensitivity: "base" });
      });

    const advancePayments = Array.from(advanceGroup.values())
      .map((row) => ({
        reservation_id: row.reservation_id,
        booking_code: row.booking_code,
        guest_name: row.guest_name,
        room_number: row.room_number,
        checkin_date: row.checkin_date,
        total_price: round2(row.total_price),
        total_paid_to_date: round2(row.total_paid_to_date),
        payment_status: row.payment_status,
        is_cancelled: row.is_cancelled,
        methods: finalizeMethods(row.methods),
        total_net: round2(row.total_net),
        notes: Array.from(row.notes),
      }))
      .sort((a, b) => {
        if (a.checkin_date !== b.checkin_date) return a.checkin_date.localeCompare(b.checkin_date);
        return a.booking_code.localeCompare(b.booking_code, undefined, { sensitivity: "base" });
      });

    const posMethodsRaw = createMethodsMap();
    for (const row of (posRes.data ?? []) as PosOrderRow[]) {
      const method = normalizeMethod(row.payment_method);
      const amount = Number(row.total ?? 0);
      applyMethodMovement(posMethodsRaw, method, "payment", amount);
    }
    const pos = finalizeMethods(posMethodsRaw);

    const todaySubtotalMethods = sumMethods(todayRooms.map((row) => row.methods));
    const advanceSubtotalMethods = sumMethods(advancePayments.map((row) => row.methods));
    const grandTotalMethods = sumMethods([todaySubtotalMethods, advanceSubtotalMethods, pos]);

    const todaySubtotal = { ...todaySubtotalMethods, grand_net: methodsVisibleNet(todaySubtotalMethods) };
    const advanceSubtotal = { ...advanceSubtotalMethods, grand_net: methodsNet(advanceSubtotalMethods) };
    const grandTotal = {
      ...grandTotalMethods,
      grand_net: round2(todaySubtotal.grand_net + advanceSubtotal.grand_net + methodsVisibleNet(pos)),
    };
    const nonCashDepositOffset = round2(grandTotal.transfer.deposit + grandTotal.credit_card.deposit);
    const netCashDrawer = round2(grandTotal.cash.payment - grandTotal.cash.refund - nonCashDepositOffset);

    const allRooms = baseRooms
      .map((room) => ({
        room_number: room.room_number,
        floor_number: room.floor_number ?? 0,
        is_occupied: roomOccupiedToday.has(room.id),
        has_payment_today: roomHasPaymentToday.has(room.id),
      }))
      .sort((a, b) => {
        if (a.floor_number !== b.floor_number) return a.floor_number - b.floor_number;
        return a.room_number.localeCompare(b.room_number, undefined, { numeric: true, sensitivity: "base" });
      });

    return NextResponse.json({
      success: true,
      business_date: businessDate,
      all_rooms: allRooms,
      today_rooms: todayRooms,
      advance_payments: advancePayments,
      pos,
      today_subtotal: todaySubtotal,
      advance_subtotal: advanceSubtotal,
      grand_total: grandTotal,
      deposit_refunds: depositRefundRows,
      reconciliation: {
        cash_payments: grandTotal.cash.payment,
        cash_deposits: grandTotal.cash.deposit,
        cash_refunds: grandTotal.cash.refund,
        non_cash_deposit_offset: nonCashDepositOffset,
        net_cash: netCashDrawer,
      },
    });
  } catch (err) {
    console.error("api/reports/payment-daily GET failed", err);
    const message = err instanceof Error ? err.message : "Internal server error";
    return NextResponse.json({ success: false, error: message }, { status: 500 });
  }
}
