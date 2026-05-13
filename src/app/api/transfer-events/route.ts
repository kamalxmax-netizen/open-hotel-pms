import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { requireStaffAuth } from "@/lib/server-auth";
import { roundMoney } from "@/lib/transfer-audit";

export const dynamic = "force-dynamic";
export const fetchCache = "force-no-store";

const querySchema = z.object({
  from: z.string().trim().optional(),
  to: z.string().trim().optional(),
  limit: z.coerce.number().int().min(1).max(500).default(300),
});

type SupabaseServer = ReturnType<typeof createServerSupabaseClient>;

type PaymentRow = {
  id: string;
  transfer_event_id?: string | null;
  reservation_id: string | null;
  tx_type: string | null;
  method: string | null;
  amount: number | string | null;
  note: string | null;
  paid_at: string | null;
  paid_date: string | null;
  cashier_name: string | null;
  revenue_category: string | null;
  is_record_only?: boolean | null;
  is_void_reversal?: boolean | null;
  is_correction?: boolean | null;
  void_of?: string | null;
  correction_ref?: string | null;
  transfer_audit_original_note?: string | null;
  reservations?: any;
};

type TransferEventRow = {
  id: string;
  source: string | null;
  status?: string | null;
  paid_date: string | null;
  sender_name: string | null;
  transfer_at: string | null;
  amount: number | string | null;
  bank_ref: string | null;
  note: string | null;
  recorded_at: string | null;
  created_at: string | null;
  archived_at?: string | null;
};

function applyPaidDateFilter<T extends { gte: Function; lte: Function }>(query: T, from?: string, to?: string): T {
  let next = query;
  if (from) next = next.gte("paid_date", from);
  if (to) next = next.lte("paid_date", to);
  return next;
}

function relationOne<T>(value: T | T[] | null | undefined): T | null {
  if (Array.isArray(value)) return value[0] ?? null;
  return value ?? null;
}

function compactList(values: Array<string | null | undefined>): string[] {
  return Array.from(new Set(values.map((value) => String(value ?? "").trim()).filter(Boolean)));
}

async function loadRoomNumbers(supabase: SupabaseServer, reservationIds: string[]): Promise<Map<string, string | null>> {
  const uniqueIds = Array.from(new Set(reservationIds.filter(Boolean)));
  if (uniqueIds.length === 0) return new Map();

  const { data, error } = await supabase
    .from("reservation_nights")
    .select("reservation_id, stay_date, rooms(room_number)")
    .in("reservation_id", uniqueIds)
    .is("cancelled_at", null)
    .order("stay_date", { ascending: true });

  if (error) throw new Error(error.message);

  const roomByReservation = new Map<string, string | null>();
  for (const row of data ?? []) {
    const reservationId = String((row as any).reservation_id ?? "");
    if (!reservationId || roomByReservation.has(reservationId)) continue;
    const roomRef = relationOne((row as any).rooms);
    roomByReservation.set(reservationId, roomRef?.room_number ? String(roomRef.room_number) : null);
  }
  return roomByReservation;
}

async function loadGroupMeta(supabase: SupabaseServer, groupIds: string[]) {
  const uniqueIds = Array.from(new Set(groupIds.filter(Boolean)));
  const groupMap = new Map<string, { group_code: string | null; group_name: string | null }>();
  if (uniqueIds.length === 0) return groupMap;

  const { data, error } = await supabase
    .from("booking_groups")
    .select("id, group_code, group_name")
    .in("id", uniqueIds);

  if (error) throw new Error(error.message);
  for (const row of data ?? []) {
    const id = String((row as any).id ?? "");
    if (!id) continue;
    groupMap.set(id, {
      group_code: (row as any).group_code ? String((row as any).group_code) : null,
      group_name: (row as any).group_name ? String((row as any).group_name) : null,
    });
  }
  return groupMap;
}

async function loadInvalidPaymentIds(supabase: SupabaseServer, paymentIds: string[]): Promise<Set<string>> {
  const ids = Array.from(new Set(paymentIds.filter(Boolean)));
  const invalid = new Set<string>();
  if (ids.length === 0) return invalid;

  const [voidRows, correctionRows] = await Promise.all([
    supabase.from("folio_payments").select("void_of").eq("is_void_reversal", true).in("void_of", ids),
    supabase.from("folio_payments").select("correction_ref").eq("is_correction", true).in("correction_ref", ids),
  ]);
  if (voidRows.error) throw new Error(voidRows.error.message);
  if (correctionRows.error) throw new Error(correctionRows.error.message);

  for (const row of voidRows.data ?? []) {
    const id = String((row as any).void_of ?? "");
    if (id) invalid.add(id);
  }
  for (const row of correctionRows.data ?? []) {
    const id = String((row as any).correction_ref ?? "");
    if (id) invalid.add(id);
  }
  return invalid;
}

function isValidTransferPayment(row: PaymentRow, invalidIds: Set<string>): boolean {
  if (!row.id || invalidIds.has(String(row.id))) return false;
  if (row.method !== "transfer") return false;
  if (row.tx_type !== "payment" && row.tx_type !== "deposit") return false;
  if (!row.reservation_id) return false;
  if (row.is_record_only === true) return false;
  if (row.is_void_reversal === true) return false;
  if (row.is_correction === true) return false;
  if (row.void_of) return false;
  if (row.correction_ref) return false;
  return roundMoney(row.amount) > 0;
}

function toCandidate(
  payment: PaymentRow,
  roomByReservation: Map<string, string | null>,
  groupById: Map<string, { group_code: string | null; group_name: string | null }>
) {
  const reservation = relationOne(payment.reservations) as any;
  const reservationId = String(payment.reservation_id ?? "");
  const groupId = reservation?.booking_group_id ? String(reservation.booking_group_id) : null;
  const group = groupId ? groupById.get(groupId) : null;
  const roomNumber = roomByReservation.get(reservationId) ?? null;
  const bookingCode = reservation?.booking_code ? String(reservation.booking_code) : null;
  const guestName = reservation?.guest_name ? String(reservation.guest_name) : null;
  const amount = roundMoney(payment.amount);
  const searchText = [
    bookingCode,
    guestName,
    roomNumber,
    group?.group_code,
    group?.group_name,
    payment.note,
    payment.cashier_name,
  ].filter(Boolean).join(" ").toLowerCase();

  return {
    id: String(payment.id),
    transfer_event_id: payment.transfer_event_id ? String(payment.transfer_event_id) : null,
    reservation_id: reservationId,
    booking_code: bookingCode,
    guest_name: guestName,
    room_number: roomNumber,
    checkin_date: reservation?.checkin_date ? String(reservation.checkin_date) : null,
    checkout_date: reservation?.checkout_date ? String(reservation.checkout_date) : null,
    booking_group_id: groupId,
    group_code: group?.group_code ?? null,
    group_name: group?.group_name ?? null,
    paid_date: payment.paid_date,
    paid_at: payment.paid_at,
    tx_type: payment.tx_type,
    amount,
    note: payment.note,
    cashier_name: payment.cashier_name,
    revenue_category: payment.revenue_category,
    search_text: searchText,
  };
}

export async function GET(request: NextRequest) {
  try {
    const supabase = createServerSupabaseClient();
    const auth = await requireStaffAuth(supabase, request, {
      allowRoles: ["admin", "supervisor", "frontdesk"],
    });
    if (auth.error) return auth.error;

    const parsed = querySchema.safeParse({
      from: request.nextUrl.searchParams.get("from") ?? undefined,
      to: request.nextUrl.searchParams.get("to") ?? undefined,
      limit: request.nextUrl.searchParams.get("limit") ?? undefined,
    });
    if (!parsed.success) {
      return NextResponse.json({ success: false, error: "Invalid query." }, { status: 400 });
    }

    const { from, to, limit } = parsed.data;
    const eventQuery = applyPaidDateFilter(
      supabase
        .from("transfer_events")
        .select("id, source, status, paid_date, sender_name, transfer_at, amount, bank_ref, note, recorded_at, created_at, archived_at")
        .eq("source", "manual")
        .eq("status", "active")
        .order("transfer_at", { ascending: false, nullsFirst: false })
        .order("recorded_at", { ascending: false })
        .limit(limit),
      from,
      to
    );

    const paymentQuery = applyPaidDateFilter(
      supabase
        .from("folio_payments")
        .select(`
          id,
          transfer_event_id,
          reservation_id,
          tx_type,
          method,
          amount,
          note,
          paid_at,
          paid_date,
          cashier_name,
          revenue_category,
          is_record_only,
          is_void_reversal,
          is_correction,
          void_of,
          correction_ref,
          transfer_audit_original_note,
          reservations(id, booking_code, guest_name, checkin_date, checkout_date, booking_group_id)
        `)
        .eq("method", "transfer")
        .order("paid_at", { ascending: false })
        .limit(900),
      from,
      to
    );

    const [eventsRes, paymentsRes] = await Promise.all([eventQuery, paymentQuery]);
    if (eventsRes.error) return NextResponse.json({ success: false, error: eventsRes.error.message }, { status: 500 });
    if (paymentsRes.error) return NextResponse.json({ success: false, error: paymentsRes.error.message }, { status: 500 });

    const rawPayments = (paymentsRes.data ?? []) as PaymentRow[];
    const invalidPaymentIds = await loadInvalidPaymentIds(supabase, rawPayments.map((payment) => String(payment.id ?? "")));
    const validPayments = rawPayments.filter((payment) => isValidTransferPayment(payment, invalidPaymentIds));
    const reservationIds = validPayments.map((payment) => String(payment.reservation_id ?? ""));
    const groupIds = validPayments
      .map((payment) => relationOne(payment.reservations) as any)
      .map((reservation) => reservation?.booking_group_id ? String(reservation.booking_group_id) : "");
    const [roomByReservation, groupById] = await Promise.all([
      loadRoomNumbers(supabase, reservationIds),
      loadGroupMeta(supabase, groupIds),
    ]);

    const candidates = validPayments.map((payment) => toCandidate(payment, roomByReservation, groupById));
    const candidatesByEvent = new Map<string, typeof candidates>();
    for (const candidate of candidates) {
      if (!candidate.transfer_event_id) continue;
      const rows = candidatesByEvent.get(candidate.transfer_event_id) ?? [];
      rows.push(candidate);
      candidatesByEvent.set(candidate.transfer_event_id, rows);
    }

    const groupedRows = ((eventsRes.data ?? []) as TransferEventRow[]).map((event) => {
      const payments = candidatesByEvent.get(String(event.id)) ?? [];
      const amount = roundMoney(payments.reduce((sum, payment) => sum + payment.amount, 0));
      const bookingCodes = compactList(payments.map((payment) => payment.booking_code));
      const guestNames = compactList(payments.map((payment) => payment.guest_name));
      const roomNumbers = compactList(payments.map((payment) => payment.room_number));
      const groupNames = compactList(payments.map((payment) => payment.group_name));
      const groupCodes = compactList(payments.map((payment) => payment.group_code));

      return {
        id: String(event.id),
        kind: "grouped" as const,
        status: "grouped" as const,
        transfer_event_id: String(event.id),
        payment_id: payments[0]?.id ?? null,
        payment_ids: payments.map((payment) => payment.id),
        payment_count: payments.length,
        payments,
        paid_date: event.paid_date,
        transfer_at: event.transfer_at ?? event.recorded_at ?? event.created_at,
        recorded_at: event.recorded_at ?? event.created_at,
        amount,
        actual_amount: amount,
        folio_amount: amount,
        delta: 0,
        sender_name: event.sender_name,
        bank_ref: event.bank_ref,
        transfer_note: event.note,
        booking_codes: bookingCodes,
        guest_names: guestNames,
        room_numbers: roomNumbers,
        group_names: groupNames,
        group_codes: groupCodes,
        booking_code: bookingCodes[0] ?? null,
        guest_name: guestNames[0] ?? null,
        room_number: roomNumbers[0] ?? null,
      };
    });

    const unlinkedRows = candidates
      .filter((payment) => !payment.transfer_event_id)
      .map((payment) => ({
        id: payment.id,
        kind: "unlinked" as const,
        status: "needs_detail" as const,
        transfer_event_id: null,
        payment_id: payment.id,
        payment_ids: [payment.id],
        payment_count: 1,
        payments: [payment],
        paid_date: payment.paid_date,
        transfer_at: payment.paid_at,
        recorded_at: payment.paid_at,
        amount: payment.amount,
        actual_amount: null,
        folio_amount: payment.amount,
        delta: null,
        sender_name: null,
        bank_ref: null,
        transfer_note: null,
        booking_codes: compactList([payment.booking_code]),
        guest_names: compactList([payment.guest_name]),
        room_numbers: compactList([payment.room_number]),
        group_names: compactList([payment.group_name]),
        group_codes: compactList([payment.group_code]),
        booking_code: payment.booking_code,
        guest_name: payment.guest_name,
        room_number: payment.room_number,
      }));

    const rows = [...groupedRows, ...unlinkedRows]
      .sort((left, right) => String(right.transfer_at ?? "").localeCompare(String(left.transfer_at ?? "")))
      .slice(0, limit);

    const summary = rows.reduce(
      (acc, row) => {
        if (row.kind === "unlinked") {
          acc.needs_detail_count += 1;
        } else {
          acc.grouped_count += 1;
          acc.grouped_total = roundMoney(acc.grouped_total + row.amount);
        }
        acc.total_amount = roundMoney(acc.total_amount + row.amount);
        return acc;
      },
      {
        needs_detail_count: 0,
        grouped_count: 0,
        grouped_total: 0,
        total_amount: 0,
      }
    );

    return NextResponse.json({
      success: true,
      rows,
      candidate_payments: candidates,
      summary,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Internal server error";
    return NextResponse.json({ success: false, error: message }, { status: 500 });
  }
}
