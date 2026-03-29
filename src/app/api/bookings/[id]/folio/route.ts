import { computeFeeSummary, toLocalDate } from "@/lib/folio-fees";
import { fromSatang, toSatang } from "@/lib/money";
import { listNights } from "@/lib/dates";
import { resolveHotelCheckOutTime, resolveLinkedStay } from "@/lib/linked-stay";
import { extractDepositGeneralNote } from "@/lib/deposit-ledger";
import type { ReservationFolioLedgerRow, ReservationFolioResponse, ReservationFolioSummary } from "@/lib/types";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { NextRequest, NextResponse } from "next/server";
import { unstable_noStore as noStore } from "next/cache";

type RouteParams = { params: { id: string } };

type PaymentRow = {
  id: string;
  reservation_id: string;
  tx_type: "payment" | "refund" | "deposit";
  method: "cash" | "transfer" | "credit_card" | "other";
  amount: number | string;
  note: string | null;
  paid_at: string;
  paid_date: string;
  created_at: string;
  revenue_category?: string | null;
  fee_template_code?: string | null;
  cashier_name?: string | null;
  is_record_only?: boolean | null;
  is_void_reversal?: boolean | null;
  void_of?: string | null;
  is_correction?: boolean | null;
  correction_ref?: string | null;
  correction_reason?: string | null;
  extra_fee_templates?: {
    code: string;
    name: string;
    icon: string | null;
    category: string;
  } | null;
};

type ReservationRow = {
  id: string;
  booking_code: string | null;
  guest_name: string | null;
  source: string | null;
  status: string | null;
  checkin_date: string | null;
  checkout_date: string | null;
  checked_in_at: string | null;
  checked_out_at?: string | null;
  total_price: number | string | null;
  discount_type: string | null;
  discount_value: number | string | null;
  discount_percent: number | string | null;
  discount_reason: string | null;
  deposit_amount: number | string | null;
  deposit_note: string | null;
  deposit_paid_at: string | null;
  parent_reservation_id?: string | null;
  tax_invoice_requested?: boolean | null;
};

function toNumber(value: unknown): number {
  const num = typeof value === "number" ? value : Number(value);
  return Number.isFinite(num) ? num : 0;
}

function isMissingFeeRelationError(error: { code?: string | null; message?: string | null } | null | undefined): boolean {
  if (!error) return false;
  const code = String(error.code ?? "").toUpperCase();
  if (code === "42P01" || code === "42703" || code === "PGRST200" || code === "PGRST204") return true;
  const message = String(error.message ?? "").toLowerCase();
  return (
    message.includes("extra_fee_templates")
    || message.includes("fee_template_code")
    || message.includes("is_void_reversal")
    || message.includes("void_of")
    || message.includes("is_correction")
    || message.includes("correction_ref")
    || message.includes("correction_reason")
    || (message.includes("relation") && message.includes("does not exist"))
    || (message.includes("column") && message.includes("does not exist"))
    || message.includes("could not find a relationship")
  );
}

function isMissingReservationColumnError(error: { message?: string | null } | null | undefined): boolean {
  if (!error) return false;
  const message = String(error.message ?? "").toLowerCase();
  return message.includes("checked_out_at") || message.includes("parent_reservation_id");
}

function normalizePaymentRows(rows: any[]): PaymentRow[] {
  return rows.map((row) => {
    const templateValue = Array.isArray(row.extra_fee_templates)
      ? row.extra_fee_templates[0] ?? null
      : row.extra_fee_templates ?? null;

    return {
      id: String(row.id ?? ""),
      reservation_id: String(row.reservation_id ?? ""),
      tx_type: row.tx_type,
      method: row.method,
      amount: row.amount,
      note: row.note ?? null,
      paid_at: row.paid_at,
      paid_date: row.paid_date,
      created_at: row.created_at,
      revenue_category: row.revenue_category ?? null,
      fee_template_code: row.fee_template_code ?? null,
      cashier_name: row.cashier_name ?? null,
      is_record_only: row.is_record_only ?? false,
      is_void_reversal: row.is_void_reversal ?? false,
      void_of: row.void_of ?? null,
      is_correction: row.is_correction ?? false,
      correction_ref: row.correction_ref ?? null,
      correction_reason: row.correction_reason ?? null,
      extra_fee_templates: templateValue
        ? {
            code: String(templateValue.code ?? ""),
            name: String(templateValue.name ?? ""),
            icon: templateValue.icon ?? null,
            category: String(templateValue.category ?? ""),
          }
        : null,
    };
  });
}

function buildReservationSummary(
  reservation: Pick<
    ReservationRow,
    "total_price" | "deposit_amount" | "discount_type" | "discount_value" | "discount_percent" | "checkin_date" | "checkout_date" | "checked_in_at" | "discount_reason"
  >,
  payments: PaymentRow[]
): ReservationFolioSummary {
  const feeSummary = computeFeeSummary(
    toNumber(reservation.total_price),
    toNumber(reservation.deposit_amount),
    payments
  );

  const nightCount = (() => {
    try {
      return listNights(
        String(reservation.checkin_date ?? ""),
        String(reservation.checkout_date ?? "")
      ).length;
    } catch {
      return 0;
    }
  })();

  const discountTotal = computeReservationDiscountAmount({
    totalPrice: toNumber(reservation.total_price),
    discountType: reservation.discount_type ?? "percent",
    discountValue: toNumber(reservation.discount_value ?? reservation.discount_percent),
    nightCount,
  });

  const paymentsTotal = payments.reduce((sum, row) => {
    if (row.tx_type !== "payment") return sum;
    if (row.revenue_category === "extra_charge" || row.revenue_category === "deposit") return sum;
    return sum + fromSatang(toSatang(row.amount));
  }, 0);

  const refundsTotal = payments.reduce((sum, row) => {
    if (row.tx_type !== "refund") return sum;
    const note = String(row.note ?? "").toLowerCase();
    if (row.revenue_category === "deposit" && note.includes("paid by deposit")) return sum;
    return sum + fromSatang(toSatang(row.amount));
  }, 0);

  const grandTotalAfterDiscount = Math.max(
    0,
    fromSatang(toSatang(feeSummary.grand_total) - toSatang(discountTotal))
  );
  const outstandingAfterDiscount = fromSatang(
    toSatang(feeSummary.balance) - toSatang(discountTotal)
  );
  const refundDueFromOverpayment = Math.max(0, -outstandingAfterDiscount);
  const refundsDisplayTotal = Number(
    Math.max(refundsTotal, refundDueFromOverpayment).toFixed(2)
  );

  return {
    room_charges_total: feeSummary.room_charges_total,
    discount_total: discountTotal,
    extra_charges_total: feeSummary.extra_charges_total,
    grand_total: grandTotalAfterDiscount,
    payments_total: Number(paymentsTotal.toFixed(2)),
    refunds_total: refundsDisplayTotal,
    deposit_held: feeSummary.deposit_held,
    outstanding_balance: outstandingAfterDiscount,
  };
}

async function fetchReservationRows(
  supabase: ReturnType<typeof createServerSupabaseClient>,
  reservationIds: string[]
): Promise<Map<string, PaymentRow[]>> {
  const ids = Array.from(new Set(reservationIds.filter(Boolean)));
  if (ids.length === 0) return new Map();

  const richSelect = `
    id,
    reservation_id,
    tx_type,
    method,
    amount,
    note,
    paid_at,
    paid_date,
    created_at,
    revenue_category,
    fee_template_code,
    cashier_name,
    is_record_only,
    is_void_reversal,
    void_of,
    is_correction,
    correction_ref,
    correction_reason,
    extra_fee_templates(code, name, icon, category)
  `;

  const baseSelect = `
    id,
    reservation_id,
    tx_type,
    method,
    amount,
    note,
    paid_at,
    paid_date,
    created_at,
    revenue_category,
    cashier_name,
    is_record_only
  `;

  const richRes = await supabase
    .from("folio_payments")
    .select(richSelect)
    .in("reservation_id", ids)
    .order("paid_at", { ascending: false })
    .order("created_at", { ascending: false });

  let paymentRows: PaymentRow[];
  if (!richRes.error) {
    paymentRows = normalizePaymentRows(richRes.data ?? []);
  } else if (isMissingFeeRelationError(richRes.error)) {
    const baseRes = await supabase
      .from("folio_payments")
      .select(baseSelect)
      .in("reservation_id", ids)
      .order("paid_at", { ascending: false })
      .order("created_at", { ascending: false });
    if (baseRes.error) {
      throw new Error(baseRes.error.message);
    }
    paymentRows = normalizePaymentRows(
      (baseRes.data ?? []).map((row: any) => ({
        ...row,
        fee_template_code: null,
        is_void_reversal: false,
        void_of: null,
        is_correction: false,
        correction_ref: null,
        correction_reason: null,
        extra_fee_templates: null,
      }))
    );
  } else {
    throw new Error(richRes.error.message ?? "Failed to load folio payments.");
  }

  const grouped = new Map<string, PaymentRow[]>();
  for (const row of paymentRows) {
    const reservationId = String((row as any).reservation_id ?? "");
    if (!reservationId) continue;
    const current = grouped.get(reservationId);
    if (current) current.push(row);
    else grouped.set(reservationId, [row]);
  }

  return grouped;
}

async function resolveLinkedStayReservations(
  supabase: ReturnType<typeof createServerSupabaseClient>,
  reservation: ReservationRow
): Promise<ReservationRow[] | null> {
  const parentReservationId = reservation.parent_reservation_id ? String(reservation.parent_reservation_id) : null;
  const linkedRootId = parentReservationId ?? String(reservation.id);

  const { data, error } = await supabase
    .from("reservations")
    .select(`
      id,
      booking_code,
      source,
      status,
      checkin_date,
      checkout_date,
      checked_in_at,
      checked_out_at,
      total_price,
      discount_type,
      discount_value,
      discount_percent,
      discount_reason,
      deposit_amount,
      deposit_note,
      deposit_paid_at,
      parent_reservation_id
    `)
    .or(`id.eq.${linkedRootId},parent_reservation_id.eq.${linkedRootId}`);

  if (error) {
    if (isMissingReservationColumnError(error)) {
      return null;
    }
    throw new Error(error.message);
  }

  const rows = (data ?? []) as ReservationRow[];
  const linkedRows = rows
    .filter((row) => String(row.id) === linkedRootId || String(row.parent_reservation_id ?? "") === linkedRootId)
    .sort((left, right) => {
      const dateCmp = String(left.checkin_date ?? "").localeCompare(String(right.checkin_date ?? ""));
      if (dateCmp !== 0) return dateCmp;
      return String(left.id).localeCompare(String(right.id));
    });

  if (linkedRows.length <= 1) {
    return null;
  }

  return linkedRows;
}

async function fetchPaymentRowsWithOptionalFeeFields(
  supabase: ReturnType<typeof createServerSupabaseClient>,
  reservationId: string
): Promise<PaymentRow[]> {
  const richSelect = `
    id,
    tx_type,
    method,
    amount,
    note,
    paid_at,
    paid_date,
    created_at,
    revenue_category,
    fee_template_code,
    cashier_name,
    is_record_only,
    is_void_reversal,
    void_of,
    is_correction,
    correction_ref,
    correction_reason,
    extra_fee_templates(code, name, icon, category)
  `;

  const baseSelect = `
    id,
    tx_type,
    method,
    amount,
    note,
    paid_at,
    paid_date,
    created_at,
    revenue_category,
    cashier_name,
    is_record_only
  `;

  const richRes = await supabase
    .from("folio_payments")
    .select(richSelect)
    .eq("reservation_id", reservationId)
    .order("paid_at", { ascending: false })
    .order("created_at", { ascending: false });

  if (!richRes.error) {
    return normalizePaymentRows(richRes.data ?? []);
  }

  if (!isMissingFeeRelationError(richRes.error)) {
    throw new Error(richRes.error.message);
  }

  const baseRes = await supabase
    .from("folio_payments")
    .select(baseSelect)
    .eq("reservation_id", reservationId)
    .order("paid_at", { ascending: false })
    .order("created_at", { ascending: false });

  if (baseRes.error) {
    throw new Error(baseRes.error.message);
  }

  return normalizePaymentRows(
    (baseRes.data ?? []).map((row: any) => ({
      ...row,
      fee_template_code: null,
      is_void_reversal: false,
      void_of: null,
      is_correction: false,
      correction_ref: null,
      correction_reason: null,
      extra_fee_templates: null,
    }))
  );
}

async function resolveRoomNumberById(
  supabase: ReturnType<typeof createServerSupabaseClient>,
  roomId: string
): Promise<string | null> {
  if (!roomId) return null;
  const roomRes = await supabase
    .from("rooms")
    .select("room_number")
    .eq("id", roomId)
    .maybeSingle();

  if (roomRes.error) {
    throw new Error(roomRes.error.message);
  }
  return roomRes.data?.room_number ? String(roomRes.data.room_number) : null;
}

async function resolveReservationRoomNumber(
  supabase: ReturnType<typeof createServerSupabaseClient>,
  reservationId: string
): Promise<string | null> {
  const today = toLocalDate(new Date());
  const nightsRes = await supabase
    .from("reservation_nights")
    .select("room_id, stay_date")
    .eq("reservation_id", reservationId)
    .is("cancelled_at", null)
    .order("stay_date", { ascending: true });

  if (nightsRes.error) {
    throw new Error(nightsRes.error.message);
  }

  const rows = nightsRes.data ?? [];
  const preferred =
    rows.find((row: any) => String(row?.stay_date ?? "") <= today && row?.room_id) ??
    rows.find((row: any) => Boolean(row?.room_id)) ??
    null;

  if (!preferred?.room_id) return null;
  return resolveRoomNumberById(supabase, String(preferred.room_id));
}

function makeLedgerRowLabel(row: PaymentRow): string {
  const note = String(row.note ?? "").toLowerCase();
  const isDepositConsumption =
    row.tx_type === "refund" &&
    row.revenue_category === "deposit" &&
    note.includes("paid by deposit");

  if (row.tx_type === "deposit") return "Deposit received";
  if (isDepositConsumption) return "Paid by Deposit";
  if (row.revenue_category === "extra_charge") {
    return row.extra_fee_templates?.name || row.note || "Extra charge";
  }
  if (row.tx_type === "refund") {
    if (row.revenue_category === "deposit") return "Deposit refund";
    return "Refund";
  }
  return "Payment";
}

function computeReservationDiscountAmount(input: {
  totalPrice: number;
  discountType: string | null | undefined;
  discountValue: number;
  nightCount: number;
}): number {
  const totalPrice = fromSatang(toSatang(input.totalPrice));
  const discountValue = fromSatang(toSatang(input.discountValue));
  if (totalPrice <= 0 || discountValue <= 0) return 0;

  if (input.discountType === "fixed_total") {
    return discountValue;
  }

  if (input.discountType === "fixed_per_night") {
    return discountValue * Math.max(0, input.nightCount);
  }

  const percent = Math.max(0, Math.min(100, discountValue));
  if (percent <= 0) return 0;
  if (percent >= 100) return totalPrice;

  const grossPrice = totalPrice / (1 - percent / 100);
  return fromSatang(toSatang(grossPrice - totalPrice));
}

function normalizeLedgerRows(
  reservationId: string,
  roomChargeTotal: number,
  discountTotal: number,
  discountReason: string | null,
  reservation: {
    checkin_date: string | null;
    checked_in_at: string | null;
  },
  payments: PaymentRow[]
): ReservationFolioLedgerRow[] {
  const rows: ReservationFolioLedgerRow[] = [];

  if (roomChargeTotal > 0) {
    rows.push({
      id: `room-charge-${reservationId}`,
      occurred_at: reservation.checked_in_at || `${reservation.checkin_date ?? ""}T14:00:00+07:00`,
      type: "room_charge",
      tx_type: null,
      method: null,
      amount: roomChargeTotal,
      revenue_category: "room_revenue",
      fee_template_code: null,
      template_name: null,
      note: "Room charges for this reservation",
      cashier_name: null,
      label: "Room charges",
    });
  }

  if (discountTotal > 0) {
    rows.push({
      id: `discount-${reservationId}`,
      occurred_at: reservation.checked_in_at || `${reservation.checkin_date ?? ""}T14:00:00+07:00`,
      type: "discount",
      tx_type: null,
      method: null,
      amount: discountTotal,
      revenue_category: "discount",
      fee_template_code: null,
      template_name: null,
      note: discountReason || "Reservation discount",
      cashier_name: null,
      label: "Discount",
    });
  }

  for (const row of payments) {
    const amount = fromSatang(toSatang(row.amount));
    const note = String(row.note ?? "").toLowerCase();
    const isDepositConsumption =
      row.tx_type === "refund" &&
      row.revenue_category === "deposit" &&
      note.includes("paid by deposit");
    const type: ReservationFolioLedgerRow["type"] =
      row.tx_type === "deposit"
        ? "deposit"
        : isDepositConsumption
          ? "deposit"
        : row.revenue_category === "extra_charge"
          ? "extra_charge"
          : row.tx_type === "refund"
            ? "refund"
            : "payment";

    rows.push({
      id: row.id,
      occurred_at: row.paid_at || row.created_at,
      type,
      tx_type: row.tx_type ?? null,
      method: row.method ?? null,
      amount,
      revenue_category: row.revenue_category ?? null,
      fee_template_code: row.fee_template_code ?? null,
      template_name: row.extra_fee_templates?.name ?? null,
      note: row.note ?? null,
      cashier_name: row.cashier_name ?? null,
      label: makeLedgerRowLabel(row),
      is_record_only: row.is_record_only ?? false,
      is_void_reversal: row.is_void_reversal ?? false,
      void_of: row.void_of ?? null,
      is_correction: row.is_correction ?? false,
      correction_ref: row.correction_ref ?? null,
      correction_reason: row.correction_reason ?? null,
    });
  }

  return rows.sort((a, b) => Date.parse(b.occurred_at || "") - Date.parse(a.occurred_at || ""));
}

export async function GET(_request: NextRequest, { params }: RouteParams) {
  noStore();

  try {
    const reservationId = params.id;
    if (!reservationId) {
      return NextResponse.json({ error: "Missing reservation id." }, { status: 400 });
    }

    const supabase = createServerSupabaseClient();

    const withCheckedOutSelect = `
        id,
        booking_code,
        guest_name,
        source,
        status,
        checkin_date,
        checkout_date,
        checked_in_at,
        checked_out_at,
        total_price,
        discount_type,
        discount_value,
        discount_percent,
        discount_reason,
        deposit_amount,
        deposit_note,
        deposit_paid_at,
        parent_reservation_id,
        tax_invoice_requested
      `;

    const baseSelect = `
        id,
        booking_code,
        guest_name,
        source,
        status,
        checkin_date,
        checkout_date,
        checked_in_at,
        total_price,
        discount_type,
        discount_value,
        discount_percent,
        discount_reason,
        deposit_amount,
        deposit_note,
        deposit_paid_at,
        parent_reservation_id,
        tax_invoice_requested
      `;

    const withCheckedOut = await supabase
      .from("reservations")
      .select(withCheckedOutSelect)
      .eq("id", reservationId)
      .maybeSingle();

    let reservation: ReservationRow | null = null;
    if (withCheckedOut.error && isMissingReservationColumnError(withCheckedOut.error)) {
      const fallback = await supabase
        .from("reservations")
        .select(baseSelect)
        .eq("id", reservationId)
        .maybeSingle();
      if (fallback.error) {
        return NextResponse.json({ error: fallback.error.message }, { status: 500 });
      }
      reservation = fallback.data ?? null;
    } else if (withCheckedOut.error) {
      return NextResponse.json({ error: withCheckedOut.error.message }, { status: 500 });
    } else {
      reservation = withCheckedOut.data ?? null;
    }
    if (!reservation) {
      return NextResponse.json({ error: "Reservation not found." }, { status: 404 });
    }

    const roomNumber = await resolveReservationRoomNumber(supabase, reservationId);
    const linkedReservations = await resolveLinkedStayReservations(supabase, reservation);
    const checkOutTime = await resolveHotelCheckOutTime(supabase as any, "12:00");
    const linkedStay = await resolveLinkedStay(supabase as any, reservationId, checkOutTime);
    const linkedStayPayload: ReservationFolioResponse["linked_stay"] = linkedStay
      ? {
          ...linkedStay,
          segments: linkedStay.segments.map((segment) => ({
            reservation_id: segment.reservation_id,
            booking_code: segment.booking_code ?? null,
            source: segment.source ?? "walkin",
            checkin_date: segment.checkin_date,
            checkout_date: segment.checkout_date,
            status: segment.status ?? "active",
            total_price: segment.total_price,
            is_parent: segment.is_parent,
          })),
        }
      : null;
    const linkedReservationIds = linkedReservations?.map((row) => String(row.id)) ?? [String(reservation.id)];
    const paymentMap = await fetchReservationRows(supabase, linkedReservationIds);
    const mergedPayments = [...(paymentMap.get(String(reservation.id)) ?? [])].sort((a, b) => {
      const left = Date.parse(String(b.paid_at ?? ""));
      const right = Date.parse(String(a.paid_at ?? ""));
      if (Number.isFinite(left) && Number.isFinite(right) && left !== right) return left - right;
      return String(b.created_at ?? "").localeCompare(String(a.created_at ?? ""));
    });
    const summary = buildReservationSummary(reservation, mergedPayments);
    const linkedFolioSummaries = linkedReservations
      ? linkedReservations.map((row) => {
          const payments = [...(paymentMap.get(String(row.id)) ?? [])].sort((a, b) => {
            const left = Date.parse(String(b.paid_at ?? ""));
            const right = Date.parse(String(a.paid_at ?? ""));
            if (Number.isFinite(left) && Number.isFinite(right) && left !== right) return left - right;
            return String(b.created_at ?? "").localeCompare(String(a.created_at ?? ""));
          });
          return {
            reservation_id: String(row.id),
            booking_code: row.booking_code ?? null,
            source: row.source ?? null,
            checkin_date: row.checkin_date ?? null,
            checkout_date: row.checkout_date ?? null,
            summary: buildReservationSummary(row, payments),
          };
        })
      : null;

    const response: ReservationFolioResponse = {
      success: true,
      reservation_id: reservationId,
      reservation: {
        id: reservation.id,
        booking_code: reservation.booking_code ?? null,
        guest_name: reservation.guest_name ?? null,
        source: reservation.source ?? null,
        status: reservation.status ?? null,
        room_number: roomNumber,
        checkin_date: reservation.checkin_date ?? null,
        checkout_date: reservation.checkout_date ?? null,
        checked_in_at: reservation.checked_in_at ?? null,
        checked_out_at: reservation.checked_out_at ?? null,
        deposit_note: extractDepositGeneralNote(reservation.deposit_note),
        tax_invoice_requested: Boolean(reservation.tax_invoice_requested ?? false),
      },
      summary,
      ledger: normalizeLedgerRows(
        reservationId,
        summary.room_charges_total,
        summary.discount_total,
        reservation.discount_reason ?? null,
        {
          checkin_date: reservation.checkin_date ?? null,
          checked_in_at: reservation.checked_in_at ?? null,
        },
        mergedPayments
      ),
      linked_folios: linkedFolioSummaries,
      linked_stay: linkedStayPayload,
    };

    return NextResponse.json(response);
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
