import { getUserRole } from "@/lib/server-auth";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { fromSatang, toSatang } from "@/lib/money";
import type {
  BuildLineItemsResult,
  TaxInvoiceLineItem,
  TaxInvoiceSellerSnapshot,
  TaxInvoiceTotals,
} from "@/lib/tax-invoice/types";
import {
  compareRoomNumber,
  computeVatInclusiveTotals,
  formatThaiDateLabelFromDates,
  normalizeMoney,
  round2,
  toBangkokDate,
} from "@/lib/tax-invoice/utils";

type SupabaseServerClient = ReturnType<typeof createServerSupabaseClient>;

type ReservationInvoiceContextRow = {
  id: string;
  booking_code: string | null;
  guest_name: string | null;
  source: string | null;
  status: string | null;
  checkin_date: string | null;
  checkout_date: string | null;
  tax_invoice_requested: boolean | null;
  guest_profile_id: string | null;
};

type ReservationNightRow = {
  room_id: string | null;
  stay_date: string;
  nightly_price: number | string | null;
};

type RoomLookupRow = {
  id: string;
  room_number: string | null;
};

type ExtraChargeRow = {
  id: string;
  amount: number | string | null;
  note: string | null;
  fee_template_code: string | null;
  paid_date: string | null;
  paid_at: string | null;
};

type FeeTemplateRow = {
  code: string;
  name: string | null;
};

export class TaxInvoiceError extends Error {
  status: number;

  constructor(message: string, status = 400) {
    super(message);
    this.name = "TaxInvoiceError";
    this.status = status;
  }
}

export function isAdminRole(role: string | null): boolean {
  return String(role ?? "").trim().toLowerCase() === "admin";
}

export function isAdminOrSupervisorRole(role: string | null): boolean {
  const normalized = String(role ?? "").trim().toLowerCase();
  return normalized === "admin" || normalized === "supervisor";
}

export function canFoEditInvoiceByBusinessDate(businessDate: string, checkoutDate: string | null): boolean {
  if (!checkoutDate || !/^\d{4}-\d{2}-\d{2}$/.test(checkoutDate)) return false;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(businessDate)) return false;
  return businessDate <= checkoutDate;
}

export async function getRequestingUserRole(
  supabase: SupabaseServerClient,
  userId: string
): Promise<string | null> {
  try {
    return await getUserRole(supabase, userId);
  } catch {
    return null;
  }
}

export async function getBusinessDateFromSettings(supabase: SupabaseServerClient): Promise<string> {
  const { data, error } = await supabase
    .from("hotel_settings")
    .select("business_date")
    .eq("id", 1)
    .maybeSingle();

  if (!error && data?.business_date && /^\d{4}-\d{2}-\d{2}$/.test(String(data.business_date))) {
    return String(data.business_date);
  }

  return toBangkokDate();
}

export async function getSellerSnapshotFromSettings(
  supabase: SupabaseServerClient
): Promise<TaxInvoiceSellerSnapshot> {
  const { data } = await supabase
    .from("hotel_settings")
    .select("hotel_name, company_name, company_name_en, company_tax_id, company_address, company_address_en, company_branch, company_phone")
    .eq("id", 1)
    .maybeSingle();

  return {
    hotel_name: strOrNull(data?.hotel_name),
    company_name: strOrNull(data?.company_name),
    company_name_en: strOrNull(data?.company_name_en),
    company_tax_id: strOrNull(data?.company_tax_id),
    company_address: strOrNull(data?.company_address),
    company_address_en: strOrNull(data?.company_address_en),
    company_branch: strOrNull(data?.company_branch),
    company_phone: strOrNull(data?.company_phone),
  };
}

export async function loadReservationInvoiceContext(
  supabase: SupabaseServerClient,
  reservationId: string
): Promise<ReservationInvoiceContextRow> {
  const { data, error } = await supabase
    .from("reservations")
    .select("id, booking_code, guest_name, source, status, checkin_date, checkout_date, tax_invoice_requested, guest_profile_id")
    .eq("id", reservationId)
    .maybeSingle();

  if (error) {
    throw new TaxInvoiceError(error.message, 500);
  }
  if (!data) {
    throw new TaxInvoiceError("Reservation not found.", 404);
  }

  return {
    id: String(data.id),
    booking_code: strOrNull(data.booking_code),
    guest_name: strOrNull(data.guest_name),
    source: strOrNull(data.source),
    status: strOrNull(data.status),
    checkin_date: strOrNull(data.checkin_date),
    checkout_date: strOrNull(data.checkout_date),
    tax_invoice_requested: Boolean(data.tax_invoice_requested ?? false),
    guest_profile_id: strOrNull(data.guest_profile_id),
  };
}

export async function buildLineItemsForReservation(
  supabase: SupabaseServerClient,
  reservationId: string
): Promise<BuildLineItemsResult> {
  const reservation = await loadReservationInvoiceContext(supabase, reservationId);

  const { data: nightRows, error: nightError } = await supabase
    .from("reservation_nights")
    .select("room_id, stay_date, nightly_price")
    .eq("reservation_id", reservationId)
    .is("cancelled_at", null)
    .order("stay_date", { ascending: true });

  if (nightError) {
    throw new TaxInvoiceError(nightError.message, 500);
  }

  const nights: ReservationNightRow[] = (nightRows ?? []).map((row: any) => ({
    room_id: row.room_id ? String(row.room_id) : null,
    stay_date: String(row.stay_date),
    nightly_price: row.nightly_price,
  }));

  const roomIds = Array.from(new Set(nights.map((row) => row.room_id).filter(Boolean))) as string[];
  const roomNumberById = new Map<string, string>();
  if (roomIds.length > 0) {
    const { data: roomRows, error: roomError } = await supabase
      .from("rooms")
      .select("id, room_number")
      .in("id", roomIds);

    if (roomError) throw new TaxInvoiceError(roomError.message, 500);

    (roomRows ?? []).forEach((row: any) => {
      const casted = row as RoomLookupRow;
      roomNumberById.set(String(casted.id), String(casted.room_number ?? "?"));
    });
  }

  const groupedRoomItems = new Map<
    string,
    {
      room_id: string | null;
      room_number: string;
      unit_price_satang: number;
      stay_dates: string[];
      amount_satang: number;
    }
  >();

  for (const night of nights) {
    const roomNumber = night.room_id ? roomNumberById.get(night.room_id) ?? "?" : "?";
    const unitPriceSatang = toSatang(night.nightly_price);
    const key = `${roomNumber}::${unitPriceSatang}`;

    const bucket = groupedRoomItems.get(key) ?? {
      room_id: night.room_id,
      room_number: roomNumber,
      unit_price_satang: unitPriceSatang,
      stay_dates: [],
      amount_satang: 0,
    };

    bucket.stay_dates.push(night.stay_date);
    bucket.amount_satang += unitPriceSatang;
    groupedRoomItems.set(key, bucket);
  }

  const roomLineItems: TaxInvoiceLineItem[] = Array.from(groupedRoomItems.values())
    .sort((a, b) => {
      const leftDate = a.stay_dates.slice().sort()[0] ?? "";
      const rightDate = b.stay_dates.slice().sort()[0] ?? "";
      if (leftDate !== rightDate) return leftDate.localeCompare(rightDate);
      return compareRoomNumber(a.room_number, b.room_number);
    })
    .map((group) => {
      const sortedDates = Array.from(new Set(group.stay_dates)).sort();
      const dateLabel = formatThaiDateLabelFromDates(sortedDates);
      const quantity = sortedDates.length;
      const unitPrice = fromSatang(group.unit_price_satang);
      const amount = fromSatang(group.amount_satang);

      return {
        kind: "room_charge",
        description: `ค่าห้อง Room ${group.room_number} (${dateLabel})`,
        quantity,
        unit: "คืน",
        unit_price: round2(unitPrice),
        amount: round2(amount),
        stay_dates: sortedDates,
        room_id: group.room_id,
        room_number: group.room_number,
      };
    });

  const { data: extraRows, error: extraError } = await supabase
    .from("folio_payments")
    .select("id, amount, note, fee_template_code, paid_date, paid_at")
    .eq("reservation_id", reservationId)
    .eq("revenue_category", "extra_charge")
    .eq("tx_type", "payment")
    .eq("is_void_reversal", false)
    .eq("is_correction", false)
    .is("void_of", null)
    .order("paid_at", { ascending: true })
    .order("created_at", { ascending: true });

  if (extraError) {
    throw new TaxInvoiceError(extraError.message, 500);
  }

  const extraChargeRows: ExtraChargeRow[] = (extraRows ?? []).map((row: any) => ({
    id: String(row.id),
    amount: row.amount,
    note: strOrNull(row.note),
    fee_template_code: strOrNull(row.fee_template_code),
    paid_date: strOrNull(row.paid_date),
    paid_at: strOrNull(row.paid_at),
  }));

  const feeCodes = Array.from(
    new Set(extraChargeRows.map((row) => row.fee_template_code).filter(Boolean))
  ) as string[];
  const feeNameByCode = new Map<string, string>();
  if (feeCodes.length > 0) {
    const { data: feeRows, error: feeError } = await supabase
      .from("extra_fee_templates")
      .select("code, name")
      .in("code", feeCodes);

    if (feeError) throw new TaxInvoiceError(feeError.message, 500);

    (feeRows ?? []).forEach((row: any) => {
      const casted = row as FeeTemplateRow;
      feeNameByCode.set(String(casted.code), String(casted.name ?? "").trim());
    });
  }

  const extraLineItems: TaxInvoiceLineItem[] = extraChargeRows.map((row) => {
    const templateName = row.fee_template_code ? feeNameByCode.get(row.fee_template_code) : null;
    const note = String(row.note ?? "").trim();
    const amount = normalizeMoney(row.amount);

    return {
      kind: "extra_charge",
      description: templateName?.trim() || note || "Extra Charge",
      quantity: 1,
      unit: "รายการ",
      unit_price: round2(amount),
      amount: round2(amount),
      fee_template_code: row.fee_template_code,
      note: row.note,
    };
  });

  const lineItems = [...roomLineItems, ...extraLineItems];
  const grossTotal = lineItems.reduce((sum, item) => sum + normalizeMoney(item.amount), 0);
  const totals = computeVatInclusiveTotals(grossTotal, 0, 0.07);

  const bookingSnapshot = {
    booking_code: reservation.booking_code,
    source: reservation.source,
    checkin_date: reservation.checkin_date,
    checkout_date: reservation.checkout_date,
    nights: nights.length,
    room_numbers: Array.from(
      new Set(
        nights
          .map((row) => (row.room_id ? roomNumberById.get(row.room_id) ?? "?" : "?"))
          .filter(Boolean)
      )
    ).sort(compareRoomNumber),
  };

  return {
    reservation: {
      id: reservation.id,
      booking_code: reservation.booking_code,
      guest_name: reservation.guest_name,
      source: reservation.source,
      checkin_date: reservation.checkin_date,
      checkout_date: reservation.checkout_date,
      tax_invoice_requested: Boolean(reservation.tax_invoice_requested),
      guest_profile_id: reservation.guest_profile_id,
    },
    line_items: lineItems,
    totals,
    booking_snapshot: bookingSnapshot,
  };
}

export function sanitizeLineItems(items: unknown): TaxInvoiceLineItem[] {
  if (!Array.isArray(items)) return [];

  return items
    .map((raw): TaxInvoiceLineItem | null => {
      if (!raw || typeof raw !== "object") return null;
      const row = raw as Record<string, unknown>;

      const kind = row.kind === "extra_charge" ? "extra_charge" : "room_charge";
      const quantity = Math.max(0, Number(row.quantity ?? 0));
      const unitPrice = normalizeMoney(row.unit_price ?? 0);
      const amountRaw = row.amount !== undefined ? normalizeMoney(row.amount) : normalizeMoney(quantity * unitPrice);
      const amount = Math.max(0, amountRaw);

      const description = String(row.description ?? "").trim();
      if (!description) return null;

      return {
        kind,
        description,
        quantity: round2(quantity),
        unit: String(row.unit ?? "").trim() || (kind === "room_charge" ? "คืน" : "รายการ"),
        unit_price: round2(unitPrice),
        amount: round2(amount),
        stay_dates: Array.isArray(row.stay_dates)
          ? row.stay_dates.map((v) => String(v)).filter((v) => /^\d{4}-\d{2}-\d{2}$/.test(v))
          : undefined,
        room_id: strOrNull(row.room_id),
        room_number: strOrNull(row.room_number),
        fee_template_code: strOrNull(row.fee_template_code),
        note: strOrNull(row.note),
      };
    })
    .filter((row): row is TaxInvoiceLineItem => Boolean(row));
}

export function totalsFromLineItems(
  lineItems: TaxInvoiceLineItem[],
  discount: number
): TaxInvoiceTotals {
  const gross = lineItems.reduce((sum, row) => sum + normalizeMoney(row.amount), 0);
  return computeVatInclusiveTotals(gross, discount, 0.07);
}

export async function upsertGuestTaxProfile(
  supabase: SupabaseServerClient,
  input: {
    id?: string | null;
    guest_profile_id?: string | null;
    tax_id?: string | null;
    company_name?: string | null;
    address?: string | null;
    branch?: string | null;
    is_default?: boolean;
    is_passport?: boolean;
  }
): Promise<{ id: string } | null> {
  const isPassport = Boolean(input.is_passport);
  const taxId = isPassport
    ? String(input.tax_id ?? "").trim() || null
    : normalizeTaxId(input.tax_id);
  const companyName = String(input.company_name ?? "").trim();

  if (!taxId || !companyName) return null;

  if (!isPassport && !/^\d{13}$/.test(taxId)) {
    throw new TaxInvoiceError("customer_tax_id must contain 13 digits.", 400);
  }

  const payload = {
    guest_profile_id: strOrNull(input.guest_profile_id),
    tax_id: taxId,
    company_name: companyName,
    address: strOrNull(input.address),
    branch: strOrNull(input.branch) ?? "สำนักงานใหญ่",
    is_default: Boolean(input.is_default),
    is_passport: isPassport,
  };

  const explicitId = strOrNull(input.id);
  let recordId = explicitId;

  if (explicitId) {
    const { error } = await supabase
      .from("guest_tax_profiles")
      .update(payload)
      .eq("id", explicitId);

    if (error) throw new TaxInvoiceError(error.message, 500);
  } else {
    let existingId: string | null = null;

    if (payload.guest_profile_id) {
      const { data: existingByGuest, error: existingByGuestError } = await supabase
        .from("guest_tax_profiles")
        .select("id")
        .eq("guest_profile_id", payload.guest_profile_id)
        .eq("tax_id", payload.tax_id)
        .order("updated_at", { ascending: false })
        .limit(1)
        .maybeSingle();

      if (existingByGuestError) throw new TaxInvoiceError(existingByGuestError.message, 500);
      existingId = strOrNull(existingByGuest?.id);
    }

    if (!existingId) {
      const { data: existingGeneric, error: existingGenericError } = await supabase
        .from("guest_tax_profiles")
        .select("id")
        .eq("tax_id", payload.tax_id)
        .eq("company_name", payload.company_name)
        .order("updated_at", { ascending: false })
        .limit(1)
        .maybeSingle();

      if (existingGenericError) throw new TaxInvoiceError(existingGenericError.message, 500);
      existingId = strOrNull(existingGeneric?.id);
    }

    if (existingId) {
      const { error: updateError } = await supabase
        .from("guest_tax_profiles")
        .update(payload)
        .eq("id", existingId);

      if (updateError) throw new TaxInvoiceError(updateError.message, 500);
      recordId = existingId;
    } else {
      const { data: inserted, error: insertError } = await supabase
        .from("guest_tax_profiles")
        .insert(payload)
        .select("id")
        .maybeSingle();

      if (insertError) throw new TaxInvoiceError(insertError.message, 500);
      recordId = strOrNull(inserted?.id);
    }
  }

  if (payload.is_default && payload.guest_profile_id && recordId) {
    const { error: clearError } = await supabase
      .from("guest_tax_profiles")
      .update({ is_default: false })
      .eq("guest_profile_id", payload.guest_profile_id)
      .neq("id", recordId)
      .eq("is_default", true);

    if (clearError) throw new TaxInvoiceError(clearError.message, 500);
  }

  return recordId ? { id: recordId } : null;
}

function strOrNull(value: unknown): string | null {
  const text = String(value ?? "").trim();
  return text.length > 0 ? text : null;
}

function normalizeTaxId(value: unknown): string | null {
  const text = String(value ?? "").trim();
  if (!text) return null;
  const digits = text.replace(/[^0-9]/g, "");
  return digits || null;
}
