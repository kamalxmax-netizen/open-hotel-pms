import { getAuthenticatedUser } from "@/lib/server-auth";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import {
  buildLineItemsForReservation,
  getSellerSnapshotFromSettings,
  loadReservationInvoiceContext,
  sanitizeLineItems,
  TaxInvoiceError,
  totalsFromLineItems,
  upsertGuestTaxProfile,
} from "@/lib/tax-invoice/service";
import { normalizeMoney, round2, toBangkokDate } from "@/lib/tax-invoice/utils";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

export const dynamic = "force-dynamic";
export const fetchCache = "force-no-store";

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

const listQuerySchema = z.object({
  date_from: z.string().regex(DATE_RE).optional(),
  date_to: z.string().regex(DATE_RE).optional(),
  status: z.enum(["draft", "issued", "cancelled"]).optional(),
  search: z.string().trim().max(200).optional(),
  page: z.coerce.number().int().min(1).optional().default(1),
  per_page: z.coerce.number().int().min(1).max(200).optional().default(50),
  include_pending: z.coerce.boolean().optional().default(true),
});

const createSchema = z.object({
  reservation_id: z.string().uuid(),
  language: z.enum(["th", "en"]).optional().default("th"),
  issue_date: z.string().regex(DATE_RE).optional(),
  discount: z.coerce.number().min(0).max(100000000).optional().default(0),
  customer_name: z.string().trim().min(1).max(255).optional(),
  customer_tax_id: z.string().trim().max(30).optional().nullable(),
  customer_address: z.string().trim().max(2000).optional().nullable(),
  customer_branch: z.string().trim().max(255).optional().nullable(),
  is_passport: z.boolean().optional().default(false),
  guest_tax_profile_id: z.string().uuid().optional().nullable(),
  line_items: z.array(z.unknown()).optional(),
  save_customer_profile: z.boolean().optional().default(true),
  customer_is_default: z.boolean().optional().default(false),
});

type InvoiceRow = {
  id: string;
  invoice_no: string | null;
  reservation_id: string;
  status: "draft" | "issued" | "cancelled";
  issue_date: string;
  customer_name: string;
  customer_tax_id: string | null;
  grand_total: number | string;
  created_at: string;
  updated_at: string;
};

type ReservationMetaRow = {
  id: string;
  booking_code: string | null;
  guest_name: string | null;
  source: string | null;
  status: string | null;
  checkin_date: string | null;
  checkout_date: string | null;
  tax_invoice_requested: boolean | null;
};

function isMissingRelationError(error: { message?: string | null; code?: string | null } | null | undefined, relationName: string): boolean {
  const message = String(error?.message ?? "").toLowerCase();
  return (
    message.includes(`relation "${relationName.toLowerCase()}" does not exist`) ||
    message.includes(`relation '${relationName.toLowerCase()}' does not exist`) ||
    (error?.code === "42P01" && message.includes(relationName.toLowerCase()))
  );
}

function strOrNull(value: unknown): string | null {
  const text = String(value ?? "").trim();
  return text.length > 0 ? text : null;
}

function normalizeTaxIdOrNull(value: unknown, isPassport = false): string | null {
  const text = String(value ?? "").trim();
  if (!text) return null;
  if (isPassport) return text; // Accept any non-empty string for passport
  const digits = text.replace(/[^0-9]/g, "");
  if (!digits) return null;
  if (!/^\d{13}$/.test(digits)) {
    throw new TaxInvoiceError("customer_tax_id must contain 13 digits.", 400);
  }
  return digits;
}

function toInvoiceListItem(row: InvoiceRow, reservation: ReservationMetaRow | null) {
  return {
    id: String(row.id),
    invoice_no: strOrNull(row.invoice_no),
    reservation_id: String(row.reservation_id),
    status: row.status,
    issue_date: String(row.issue_date),
    customer_name: String(row.customer_name ?? ""),
    customer_tax_id: strOrNull(row.customer_tax_id),
    grand_total: round2(normalizeMoney(row.grand_total)),
    created_at: String(row.created_at ?? ""),
    updated_at: String(row.updated_at ?? ""),
    reservation: reservation
      ? {
          id: reservation.id,
          booking_code: reservation.booking_code,
          guest_name: reservation.guest_name,
          source: reservation.source,
          status: reservation.status,
          checkin_date: reservation.checkin_date,
          checkout_date: reservation.checkout_date,
          tax_invoice_requested: Boolean(reservation.tax_invoice_requested),
        }
      : null,
  };
}

export async function GET(request: NextRequest) {
  try {
    const supabase = createServerSupabaseClient();
    const user = await getAuthenticatedUser(supabase, request);
    if (!user) {
      return NextResponse.json({ success: false, error: "Unauthorized" }, { status: 401 });
    }

    const parsed = listQuerySchema.safeParse({
      date_from: request.nextUrl.searchParams.get("date_from") ?? undefined,
      date_to: request.nextUrl.searchParams.get("date_to") ?? undefined,
      status: request.nextUrl.searchParams.get("status") ?? undefined,
      search: request.nextUrl.searchParams.get("search") ?? undefined,
      page: request.nextUrl.searchParams.get("page") ?? undefined,
      per_page: request.nextUrl.searchParams.get("per_page") ?? undefined,
      include_pending: request.nextUrl.searchParams.get("include_pending") ?? undefined,
    });

    if (!parsed.success) {
      return NextResponse.json(
        { success: false, error: "Invalid query.", details: parsed.error.flatten() },
        { status: 400 }
      );
    }

    const queryInput = parsed.data;
    const dateFrom = queryInput.date_from ?? "2025-01-01";
    const dateTo = queryInput.date_to ?? "2099-12-31";

    if (dateFrom > dateTo) {
      return NextResponse.json(
        { success: false, error: "date_from must be <= date_to." },
        { status: 400 }
      );
    }

    let invoiceQuery = supabase
      .from("invoices")
      .select("id, invoice_no, reservation_id, status, issue_date, customer_name, customer_tax_id, grand_total, created_at, updated_at")
      .gte("issue_date", dateFrom)
      .lte("issue_date", dateTo)
      .order("issue_date", { ascending: false })
      .order("created_at", { ascending: false })
      .limit(5000);

    if (queryInput.status) {
      invoiceQuery = invoiceQuery.eq("status", queryInput.status);
    }

    const { data: invoiceRowsRaw, error: invoiceError } = await invoiceQuery;
    if (invoiceError && !isMissingRelationError(invoiceError, "invoices")) {
      return NextResponse.json({ success: false, error: invoiceError.message }, { status: 500 });
    }

    const invoiceRows = (invoiceRowsRaw ?? []) as InvoiceRow[];
    const reservationIds = Array.from(new Set(invoiceRows.map((row) => String(row.reservation_id))))
      .filter(Boolean);

    const reservationMap = new Map<string, ReservationMetaRow>();
    if (reservationIds.length > 0) {
      const { data: reservationRows, error: reservationError } = await supabase
        .from("reservations")
        .select("id, booking_code, guest_name, source, status, checkin_date, checkout_date, tax_invoice_requested")
        .in("id", reservationIds);

      if (reservationError) {
        return NextResponse.json({ success: false, error: reservationError.message }, { status: 500 });
      }

      (reservationRows ?? []).forEach((row: any) => {
        reservationMap.set(String(row.id), {
          id: String(row.id),
          booking_code: strOrNull(row.booking_code),
          guest_name: strOrNull(row.guest_name),
          source: strOrNull(row.source),
          status: strOrNull(row.status),
          checkin_date: strOrNull(row.checkin_date),
          checkout_date: strOrNull(row.checkout_date),
          tax_invoice_requested: Boolean(row.tax_invoice_requested ?? false),
        });
      });
    }

    const listRows = invoiceRows.map((row) => toInvoiceListItem(row, reservationMap.get(String(row.reservation_id)) ?? null));

    const search = String(queryInput.search ?? "").trim().toLowerCase();
    const searched = search
      ? listRows.filter((row) => {
          const bag = [
            row.invoice_no ?? "",
            row.customer_name,
            row.customer_tax_id ?? "",
            row.reservation?.booking_code ?? "",
            row.reservation?.guest_name ?? "",
          ]
            .join(" ")
            .toLowerCase();
          return bag.includes(search);
        })
      : listRows;

    const page = queryInput.page;
    const perPage = queryInput.per_page;
    const total = searched.length;
    const offset = (page - 1) * perPage;
    const data = searched.slice(offset, offset + perPage);

    let pendingReservations: Array<Record<string, unknown>> = [];
    if (queryInput.include_pending) {
      const { data: pendingRows, error: pendingError } = await supabase
        .from("reservations")
        .select("id, booking_code, guest_name, source, status, checkin_date, checkout_date, tax_invoice_requested, total_price")
        .eq("tax_invoice_requested", true)
        .neq("status", "cancelled")
        .order("checkout_date", { ascending: true })
        .limit(5000);

      if (pendingError) {
        return NextResponse.json({ success: false, error: pendingError.message }, { status: 500 });
      }

      const { data: issuedRows, error: issuedError } = await supabase
        .from("invoices")
        .select("reservation_id")
        .eq("status", "issued");

      if (issuedError && !isMissingRelationError(issuedError, "invoices")) {
        return NextResponse.json({ success: false, error: issuedError.message }, { status: 500 });
      }

      const issuedSet = new Set((issuedRows ?? []).map((row: any) => String(row.reservation_id)));
      const pendingFiltered = (pendingRows ?? []).filter((row: any) => !issuedSet.has(String(row.id)));
      const pendingIds = pendingFiltered.map((row: any) => String(row.id));

      const roomNumbersByReservation = new Map<string, string[]>();
      if (pendingIds.length > 0) {
        const { data: nightRows, error: nightError } = await supabase
          .from("reservation_nights")
          .select("reservation_id, rooms:room_id(room_number)")
          .in("reservation_id", pendingIds)
          .is("cancelled_at", null);

        if (nightError) {
          return NextResponse.json({ success: false, error: nightError.message }, { status: 500 });
        }

        (nightRows ?? []).forEach((row: any) => {
          const reservationId = String(row.reservation_id ?? "");
          if (!reservationId) return;
          const roomRef = Array.isArray(row.rooms) ? row.rooms[0] : row.rooms;
          const roomNumber = strOrNull(roomRef?.room_number);
          if (!roomNumber) return;
          const current = roomNumbersByReservation.get(reservationId) ?? [];
          if (!current.includes(roomNumber)) current.push(roomNumber);
          roomNumbersByReservation.set(reservationId, current);
        });
      }

      pendingReservations = pendingFiltered.map((row: any) => {
        const reservationId = String(row.id);
        const roomNumbers = (roomNumbersByReservation.get(reservationId) ?? []).sort((a, b) =>
          a.localeCompare(b, undefined, { numeric: true, sensitivity: "base" })
        );

        return {
          id: reservationId,
          reservation_id: reservationId,
          booking_code: strOrNull(row.booking_code),
          guest_name: strOrNull(row.guest_name),
          source: strOrNull(row.source),
          status: strOrNull(row.status),
          checkin_date: strOrNull(row.checkin_date),
          checkout_date: strOrNull(row.checkout_date),
          tax_invoice_requested: Boolean(row.tax_invoice_requested ?? false),
          total_amount: round2(normalizeMoney(row.total_price)),
          room_numbers: roomNumbers,
        };
      });
    }

    return NextResponse.json({
      success: true,
      data,
      items: data,
      pending_reservations: pendingReservations,
      pagination: {
        page,
        per_page: perPage,
        total,
        total_pages: total > 0 ? Math.ceil(total / perPage) : 0,
      },
    });
  } catch (err) {
    if (err instanceof TaxInvoiceError) {
      return NextResponse.json({ success: false, error: err.message }, { status: err.status });
    }
    const message = err instanceof Error ? err.message : "Internal server error";
    return NextResponse.json({ success: false, error: message }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const supabase = createServerSupabaseClient();
    const user = await getAuthenticatedUser(supabase, request);
    if (!user) {
      return NextResponse.json({ success: false, error: "Unauthorized" }, { status: 401 });
    }

    const body = await request.json().catch(() => null);
    const parsed = createSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { success: false, error: "Invalid payload.", details: parsed.error.flatten() },
        { status: 400 }
      );
    }

    const input = parsed.data;
    const reservation = await loadReservationInvoiceContext(supabase, input.reservation_id);
    if (!reservation.tax_invoice_requested) {
      return NextResponse.json(
        { success: false, error: "Tax invoice is not requested for this reservation." },
        { status: 400 }
      );
    }

    const { data: issuedExists, error: issuedExistsError } = await supabase
      .from("invoices")
      .select("id, invoice_no")
      .eq("reservation_id", input.reservation_id)
      .eq("status", "issued")
      .maybeSingle();

    if (issuedExistsError) {
      return NextResponse.json({ success: false, error: issuedExistsError.message }, { status: 500 });
    }
    if (issuedExists) {
      return NextResponse.json(
        {
          success: false,
          error: "This reservation already has an issued invoice.",
          issued_invoice_id: issuedExists.id,
          issued_invoice_no: issuedExists.invoice_no,
        },
        { status: 409 }
      );
    }

    const built = await buildLineItemsForReservation(supabase, input.reservation_id);
    const lineItems = input.line_items ? sanitizeLineItems(input.line_items) : built.line_items;
    if (lineItems.length === 0) {
      return NextResponse.json({ success: false, error: "Line items cannot be empty." }, { status: 400 });
    }

    let selectedTaxProfile: {
      id: string;
      tax_id: string;
      company_name: string;
      address: string | null;
      branch: string | null;
    } | null = null;

    if (input.guest_tax_profile_id) {
      const { data: profileRow, error: profileError } = await supabase
        .from("guest_tax_profiles")
        .select("id, tax_id, company_name, address, branch")
        .eq("id", input.guest_tax_profile_id)
        .maybeSingle();

      if (profileError) {
        return NextResponse.json({ success: false, error: profileError.message }, { status: 500 });
      }
      if (profileRow) {
        selectedTaxProfile = {
          id: String(profileRow.id),
          tax_id: String(profileRow.tax_id),
          company_name: String(profileRow.company_name),
          address: strOrNull(profileRow.address),
          branch: strOrNull(profileRow.branch),
        };
      }
    }

    const customerName =
      strOrNull(input.customer_name) ??
      selectedTaxProfile?.company_name ??
      built.reservation.guest_name ??
      "Guest";

    const customerTaxId = normalizeTaxIdOrNull(input.customer_tax_id ?? selectedTaxProfile?.tax_id ?? null, input.is_passport);
    const customerAddress =
      strOrNull(input.customer_address) ?? selectedTaxProfile?.address ?? null;
    const customerBranch =
      strOrNull(input.customer_branch) ?? selectedTaxProfile?.branch ?? "สำนักงานใหญ่";

    const discount = round2(normalizeMoney(input.discount));
    const totals = totalsFromLineItems(lineItems, discount);

    const savedProfile =
      input.save_customer_profile && customerTaxId && customerName
        ? await upsertGuestTaxProfile(supabase, {
            id: input.guest_tax_profile_id,
            guest_profile_id: reservation.guest_profile_id,
            tax_id: customerTaxId,
            company_name: customerName,
            address: customerAddress,
            branch: customerBranch,
            is_default: input.customer_is_default,
            is_passport: input.is_passport,
          })
        : null;

    const sellerSnapshot = await getSellerSnapshotFromSettings(supabase);

    const { data: inserted, error: insertError } = await supabase
      .from("invoices")
      .insert({
        reservation_id: input.reservation_id,
        invoice_no: null,
        status: "draft",
        language: input.language,
        issue_date: input.issue_date ?? toBangkokDate(),
        customer_name: customerName,
        customer_tax_id: customerTaxId,
        customer_address: customerAddress,
        customer_branch: customerBranch,
        is_passport: input.is_passport,
        guest_tax_profile_id: savedProfile?.id ?? input.guest_tax_profile_id ?? selectedTaxProfile?.id ?? null,
        booking_snapshot: built.booking_snapshot,
        line_items: lineItems,
        subtotal: totals.subtotal,
        vat_rate: totals.vat_rate,
        vat_amount: totals.vat_amount,
        grand_total: totals.grand_total,
        discount: totals.discount,
        seller_snapshot: sellerSnapshot,
        updated_by: user.id,
      })
      .select("id, invoice_no, reservation_id, status, issue_date, customer_name, customer_tax_id, customer_address, customer_branch, guest_tax_profile_id, booking_snapshot, line_items, subtotal, vat_rate, vat_amount, grand_total, discount, seller_snapshot, created_at, updated_at")
      .maybeSingle();

    if (insertError) {
      return NextResponse.json({ success: false, error: insertError.message }, { status: 500 });
    }

    return NextResponse.json({ success: true, invoice: inserted, data: inserted }, { status: 201 });
  } catch (err) {
    if (err instanceof TaxInvoiceError) {
      return NextResponse.json({ success: false, error: err.message }, { status: err.status });
    }
    const message = err instanceof Error ? err.message : "Internal server error";
    return NextResponse.json({ success: false, error: message }, { status: 500 });
  }
}
