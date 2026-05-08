import { computeFeeSummary, toLocalDate } from "@/lib/folio-fees";
import { listNights } from "@/lib/dates";
import { fromSatang, toSatang } from "@/lib/money";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { requireStaffAuth } from "@/lib/server-auth";
import type { FolioPrintData } from "@/lib/folio/printFolioHtml";
import { unstable_noStore as noStore } from "next/cache";
import { NextRequest, NextResponse } from "next/server";

type RouteParams = { params: { id: string } };

type PaymentRow = {
  id: string;
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
  phone: string | null;
  status: string | null;
  checkin_date: string | null;
  checkout_date: string | null;
  checked_in_at: string | null;
  total_price: number | string | null;
  discount_type: string | null;
  discount_value: number | string | null;
  discount_percent: number | string | null;
  deposit_amount: number | string | null;
  guest_profile_id: string | null;
};

function toNumber(value: unknown): number {
  const num = typeof value === "number" ? value : Number(value);
  return Number.isFinite(num) ? num : 0;
}

function isMissingOptionalPaymentField(error: { code?: string | null; message?: string | null } | null | undefined): boolean {
  if (!error) return false;
  const code = String(error.code ?? "").toUpperCase();
  if (code === "42P01" || code === "42703" || code === "PGRST200" || code === "PGRST204") return true;
  const message = String(error.message ?? "").toLowerCase();
  return (
    message.includes("extra_fee_templates") ||
    message.includes("fee_template_code") ||
    message.includes("is_record_only") ||
    message.includes("could not find a relationship") ||
    (message.includes("column") && message.includes("does not exist"))
  );
}

function normalizePaymentRows(rows: any[]): PaymentRow[] {
  return rows.map((row) => {
    const templateValue = Array.isArray(row.extra_fee_templates)
      ? row.extra_fee_templates[0] ?? null
      : row.extra_fee_templates ?? null;
    return {
      id: String(row.id ?? ""),
      tx_type: row.tx_type,
      method: row.method,
      amount: row.amount,
      note: row.note ?? null,
      paid_at: String(row.paid_at ?? ""),
      paid_date: String(row.paid_date ?? ""),
      created_at: String(row.created_at ?? ""),
      revenue_category: row.revenue_category ?? null,
      fee_template_code: row.fee_template_code ?? null,
      cashier_name: row.cashier_name ?? null,
      is_record_only: row.is_record_only ?? false,
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

async function fetchPaymentRows(supabase: ReturnType<typeof createServerSupabaseClient>, reservationId: string): Promise<PaymentRow[]> {
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
    cashier_name
  `;

  const richRes = await supabase
    .from("folio_payments")
    .select(richSelect)
    .eq("reservation_id", reservationId)
    .order("paid_at", { ascending: true })
    .order("created_at", { ascending: true });

  if (!richRes.error) return normalizePaymentRows(richRes.data ?? []);

  if (!isMissingOptionalPaymentField(richRes.error)) {
    throw new Error(richRes.error.message);
  }

  const baseRes = await supabase
    .from("folio_payments")
    .select(baseSelect)
    .eq("reservation_id", reservationId)
    .order("paid_at", { ascending: true })
    .order("created_at", { ascending: true });

  if (baseRes.error) throw new Error(baseRes.error.message);
  return normalizePaymentRows(baseRes.data ?? []);
}

async function resolveRoomNumber(supabase: ReturnType<typeof createServerSupabaseClient>, reservationId: string): Promise<string | null> {
  const today = toLocalDate(new Date());
  const { data, error } = await supabase
    .from("reservation_nights")
    .select("room_id, stay_date, rooms(room_number)")
    .eq("reservation_id", reservationId)
    .is("cancelled_at", null)
    .order("stay_date", { ascending: true });

  if (error) throw new Error(error.message);
  const rows = data ?? [];
  const preferred =
    rows.find((row: any) => String(row?.stay_date ?? "") <= today && row?.room_id) ??
    rows.find((row: any) => Boolean(row?.room_id)) ??
    null;
  const roomRef = Array.isArray(preferred?.rooms) ? preferred.rooms[0] : preferred?.rooms;
  return roomRef?.room_number ? String(roomRef.room_number) : null;
}

async function countActiveNights(
  supabase: ReturnType<typeof createServerSupabaseClient>,
  reservationId: string,
  reservation: Pick<ReservationRow, "checkin_date" | "checkout_date">
): Promise<number | null> {
  const { data, error } = await supabase
    .from("reservation_nights")
    .select("id")
    .eq("reservation_id", reservationId)
    .is("cancelled_at", null);

  if (!error && Array.isArray(data) && data.length > 0) return data.length;

  try {
    return listNights(String(reservation.checkin_date ?? ""), String(reservation.checkout_date ?? "")).length;
  } catch {
    return null;
  }
}

async function resolveGuestProfile(
  supabase: ReturnType<typeof createServerSupabaseClient>,
  guestProfileId: string | null
): Promise<{ email: string | null; address: string | null }> {
  if (!guestProfileId) return { email: null, address: null };
  const { data, error } = await supabase
    .from("guest_profiles")
    .select("email, address, address_line1")
    .eq("id", guestProfileId)
    .maybeSingle();

  if (error) throw new Error(error.message);
  return {
    email: data?.email ? String(data.email) : null,
    address: data?.address ? String(data.address) : data?.address_line1 ? String(data.address_line1) : null,
  };
}

function computeDiscountTotal(reservation: ReservationRow, nightCount: number | null): number {
  const totalPrice = fromSatang(toSatang(reservation.total_price));
  const discountValue = fromSatang(toSatang(reservation.discount_value ?? reservation.discount_percent));
  if (totalPrice <= 0 || discountValue <= 0) return 0;
  if (reservation.discount_type === "fixed_total") return discountValue;
  if (reservation.discount_type === "fixed_per_night") return discountValue * Math.max(0, nightCount ?? 0);
  const percent = Math.max(0, Math.min(100, discountValue));
  if (percent <= 0) return 0;
  if (percent >= 100) return totalPrice;
  const grossPrice = totalPrice / (1 - percent / 100);
  return fromSatang(toSatang(grossPrice - totalPrice));
}

function normalizePrintMoney(value: unknown): number {
  return fromSatang(toSatang(value));
}

function isDepositLedgerRow(row: PaymentRow): boolean {
  const revenueCategory = String(row.revenue_category ?? "").toLowerCase();
  const note = String(row.note ?? "").toLowerCase();
  if (row.tx_type === "deposit") return true;
  if (revenueCategory === "deposit") return true;
  if (note.includes("paid by deposit")) return true;
  return note.includes("deposit") && note.includes("refund");
}

function makePaymentDescription(row: PaymentRow, roomNumber: string | null): string {
  const roomSuffix = roomNumber ? ` ห้อง ${roomNumber}` : "";
  const note = String(row.note ?? "").trim();
  const lowerNote = note.toLowerCase();
  const method = row.method === "cash"
    ? "เงินสด"
    : row.method === "transfer"
      ? "โอนเงิน"
      : row.method === "credit_card"
        ? "บัตรเครดิต"
        : "อื่นๆ";

  if (row.tx_type === "deposit" || (row.tx_type === "payment" && row.revenue_category === "deposit")) {
    return `รับเงินมัดจำด้วย${method}${roomSuffix}`;
  }
  if (row.tx_type === "refund") {
    if (row.revenue_category === "deposit" && lowerNote.includes("paid by deposit")) return `ชำระด้วยเงินมัดจำ${roomSuffix}`;
    if (row.revenue_category === "deposit") return `คืนเงินมัดจำ${roomSuffix}`;
    return `คืนเงิน${roomSuffix}`;
  }
  if (row.revenue_category === "extra_charge") return row.extra_fee_templates?.name || note || `ค่าใช้จ่ายเพิ่มเติม${roomSuffix}`;
  return `ชำระค่าห้องพักด้วย${method}${roomSuffix}`;
}

function buildLedgerRows(
  reservation: ReservationRow,
  payments: PaymentRow[],
  roomNumber: string | null,
  nightCount: number | null
): FolioPrintData["ledger_rows"] {
  const feeSummary = computeFeeSummary(toNumber(reservation.total_price), toNumber(reservation.deposit_amount), payments);
  const discountTotal = computeDiscountTotal(reservation, nightCount);
  const rows: FolioPrintData["ledger_rows"] = [];

  if (feeSummary.room_charges_total > 0) {
    rows.push({
      date: reservation.checkin_date,
      description: roomNumber ? `ค่าห้องพัก ห้อง ${roomNumber}` : "ค่าห้องพัก",
      amount: feeSummary.room_charges_total,
      kind: "charge",
    });
  }

  if (discountTotal > 0) {
    rows.push({
      date: reservation.checkin_date,
      description: "ส่วนลด",
      amount: discountTotal,
      kind: "discount",
    });
  }

  for (const row of payments) {
    if (row.is_record_only === true || isDepositLedgerRow(row)) continue;
    const amount = normalizePrintMoney(row.amount);
    if (amount <= 0) continue;
    const isExtraCharge = row.revenue_category === "extra_charge";
    const kind = isExtraCharge
      ? row.tx_type === "refund" ? "discount" : "charge"
      : row.tx_type === "refund" ? "refund" : "payment";

    rows.push({
      date: row.paid_date || row.paid_at || row.created_at,
      description: makePaymentDescription(row, roomNumber),
      amount,
      kind,
    });
  }

  return rows;
}

export async function GET(request: NextRequest, { params }: RouteParams) {
  noStore();

  try {
    const reservationId = params.id;
    if (!reservationId) {
      return NextResponse.json({ success: false, error: "Missing reservation id." }, { status: 400 });
    }

    const supabase = createServerSupabaseClient();
    const auth = await requireStaffAuth(supabase, request);
    if (auth.error) return auth.error;

    const { data: reservation, error: reservationError } = await supabase
      .from("reservations")
      .select(`
        id,
        booking_code,
        guest_name,
        phone,
        status,
        checkin_date,
        checkout_date,
        checked_in_at,
        total_price,
        discount_type,
        discount_value,
        discount_percent,
        deposit_amount,
        guest_profile_id
      `)
      .eq("id", reservationId)
      .maybeSingle();

    if (reservationError) {
      return NextResponse.json({ success: false, error: reservationError.message }, { status: 500 });
    }
    if (!reservation) {
      return NextResponse.json({ success: false, error: "Reservation not found." }, { status: 404 });
    }

    const reservationRow = reservation as ReservationRow;
    const [payments, roomNumber, nightCount, guestProfile] = await Promise.all([
      fetchPaymentRows(supabase, reservationId),
      resolveRoomNumber(supabase, reservationId),
      countActiveNights(supabase, reservationId, reservationRow),
      resolveGuestProfile(supabase, reservationRow.guest_profile_id ?? null),
    ]);

    const feeSummary = computeFeeSummary(toNumber(reservationRow.total_price), toNumber(reservationRow.deposit_amount), payments);
    const discountTotal = computeDiscountTotal(reservationRow, nightCount);
    const totalCharges = Math.max(0, fromSatang(toSatang(feeSummary.grand_total) - toSatang(discountTotal)));
    const totalPayments = normalizePrintMoney(feeSummary.total_paid);
    const rawBalanceDue = fromSatang(toSatang(totalCharges) - toSatang(totalPayments));
    const balanceDue = Math.abs(rawBalanceDue) < 0.005 ? 0 : rawBalanceDue;

    const payload: FolioPrintData & { success: true } = {
      success: true,
      reservation: {
        booking_code: reservationRow.booking_code ?? null,
        status: reservationRow.status ?? null,
        checkin_date: reservationRow.checkin_date ?? null,
        checkout_date: reservationRow.checkout_date ?? null,
        nights: nightCount,
        room_number: roomNumber,
        guest_name: reservationRow.guest_name ?? null,
        guest_phone: reservationRow.phone ?? null,
        guest_email: guestProfile.email,
        guest_address: guestProfile.address,
      },
      ledger_rows: buildLedgerRows(reservationRow, payments, roomNumber, nightCount),
      total_charges: totalCharges,
      total_payments: totalPayments,
      balance_due: balanceDue,
      total_amount: totalCharges,
    };

    return NextResponse.json(payload);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ success: false, error: message }, { status: 500 });
  }
}
