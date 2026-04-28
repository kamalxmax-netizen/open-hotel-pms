import { getAuthenticatedUser } from "@/lib/server-auth";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { extractReservationIdsFromBookingSnapshot, TaxInvoiceError } from "@/lib/tax-invoice/service";
import { toInvoiceYearMonthYYMM } from "@/lib/tax-invoice/utils";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

export const dynamic = "force-dynamic";
export const fetchCache = "force-no-store";

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

const issueSchema = z.object({
  issue_date: z.string().regex(DATE_RE).optional(),
});

type InvoiceIssueRow = {
  id: string;
  invoice_no: string | null;
  reservation_id: string;
  booking_snapshot?: unknown;
  status: "draft" | "issued" | "cancelled";
  issue_date: string;
  reservations: {
    id: string;
    checkout_date: string | null;
    tax_invoice_requested: boolean | null;
  } | null;
};

function isUniqueViolation(error: { code?: string | null; message?: string | null }, indexName: string): boolean {
  return error.code === "23505" && String(error.message ?? "").includes(indexName);
}

async function loadInvoiceForIssue(
  supabase: ReturnType<typeof createServerSupabaseClient>,
  invoiceId: string
): Promise<InvoiceIssueRow> {
  const { data, error } = await supabase
    .from("invoices")
    .select("id, invoice_no, reservation_id, booking_snapshot, status, issue_date, reservations:reservation_id(id, checkout_date, tax_invoice_requested)")
    .eq("id", invoiceId)
    .maybeSingle();

  if (error) throw new TaxInvoiceError(error.message, 500);
  if (!data) throw new TaxInvoiceError("Invoice not found.", 404);
  return data as unknown as InvoiceIssueRow;
}

export async function POST(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const invoiceId = String(params.id ?? "").trim();
    if (!invoiceId) {
      return NextResponse.json({ success: false, error: "Missing invoice id." }, { status: 400 });
    }

    const supabase = createServerSupabaseClient();
    const user = await getAuthenticatedUser(supabase, request);
    if (!user) {
      return NextResponse.json({ success: false, error: "Unauthorized" }, { status: 401 });
    }

    const body = await request.json().catch(() => null);
    const parsed = issueSchema.safeParse(body ?? {});
    if (!parsed.success) {
      return NextResponse.json(
        { success: false, error: "Invalid payload.", details: parsed.error.flatten() },
        { status: 400 }
      );
    }

    const current = await loadInvoiceForIssue(supabase, invoiceId);
    if (current.status === "cancelled") {
      return NextResponse.json({ success: false, error: "Cancelled invoice cannot be issued." }, { status: 400 });
    }

    const reservationIds = extractReservationIdsFromBookingSnapshot(current.booking_snapshot, current.reservation_id);
    const { data: reservationRows, error: reservationError } = await supabase
      .from("reservations")
      .select("id, tax_invoice_requested")
      .in("id", reservationIds);

    if (reservationError) {
      return NextResponse.json({ success: false, error: reservationError.message }, { status: 500 });
    }

    if ((reservationRows ?? []).length !== reservationIds.length || (reservationRows ?? []).some((row: any) => !row.tax_invoice_requested)) {
      return NextResponse.json(
        { success: false, error: "Tax invoice must still be requested for every selected reservation." },
        { status: 400 }
      );
    }

    const { data: existingIssuedRows, error: existingIssuedError } = await supabase
      .from("invoices")
      .select("id, invoice_no, reservation_id, booking_snapshot")
      .eq("status", "issued")
      .limit(5000);

    if (existingIssuedError) {
      return NextResponse.json({ success: false, error: existingIssuedError.message }, { status: 500 });
    }

    const overlappingIssued = (existingIssuedRows ?? []).find((row: any) => {
      if (String(row.id) === current.id) return false;
      const existingReservationIds = extractReservationIdsFromBookingSnapshot(row.booking_snapshot, row.reservation_id);
      return existingReservationIds.some((reservationId) => reservationIds.includes(reservationId));
    });

    if (overlappingIssued) {
      return NextResponse.json(
        {
          success: false,
          error: "One or more selected reservations already have an issued invoice.",
          existing_invoice: overlappingIssued,
        },
        { status: 409 }
      );
    }

    if (current.status === "issued" && current.invoice_no) {
      const { data: issuedInvoice } = await supabase
        .from("invoices")
        .select("id, invoice_no, reservation_id, status, issue_date, issued_by, updated_at")
        .eq("id", current.id)
        .maybeSingle();
      return NextResponse.json({ success: true, invoice: issuedInvoice, data: issuedInvoice, already_issued: true });
    }

    const issueDate = parsed.data.issue_date ?? current.issue_date;
    const yymm = toInvoiceYearMonthYYMM(issueDate);

    let lastError: string | null = null;

    for (let attempt = 0; attempt < 5; attempt += 1) {
      const { data: nextNo, error: nextNoError } = await supabase.rpc("next_invoice_no", { p_yy: yymm });
      if (nextNoError) {
        return NextResponse.json({ success: false, error: nextNoError.message }, { status: 500 });
      }

      const invoiceNo = String(nextNo ?? "").trim();
      if (!invoiceNo) {
        return NextResponse.json({ success: false, error: "Unable to generate invoice number." }, { status: 500 });
      }

      const { data: updated, error: updateError } = await supabase
        .from("invoices")
        .update({
          invoice_no: invoiceNo,
          status: "issued",
          issue_date: issueDate,
          issued_by: user.id,
          updated_by: user.id,
        })
        .eq("id", invoiceId)
        .eq("status", "draft")
        .select("id, invoice_no, reservation_id, status, issue_date, issued_by, updated_at")
        .maybeSingle();

      if (!updateError && updated) {
        return NextResponse.json({ success: true, invoice: updated, data: updated });
      }

      if (updateError) {
        if (isUniqueViolation(updateError, "idx_invoices_invoice_no_unique")) {
          lastError = updateError.message;
          continue;
        }
        if (isUniqueViolation(updateError, "idx_invoices_reservation_issued_unique")) {
          const { data: existingIssued } = await supabase
            .from("invoices")
            .select("id, invoice_no, reservation_id, status, issue_date, issued_by, updated_at")
            .eq("reservation_id", current.reservation_id)
            .eq("status", "issued")
            .maybeSingle();

          return NextResponse.json(
            {
              success: false,
              error: "This reservation already has an issued invoice.",
              existing_invoice: existingIssued ?? null,
            },
            { status: 409 }
          );
        }

        return NextResponse.json({ success: false, error: updateError.message }, { status: 500 });
      }

      const refreshed = await loadInvoiceForIssue(supabase, invoiceId);
      if (refreshed.status === "issued" && refreshed.invoice_no) {
        const { data: issuedInvoice } = await supabase
          .from("invoices")
          .select("id, invoice_no, reservation_id, status, issue_date, issued_by, updated_at")
          .eq("id", refreshed.id)
          .maybeSingle();
        return NextResponse.json({ success: true, invoice: issuedInvoice, data: issuedInvoice, already_issued: true });
      }
    }

    return NextResponse.json(
      { success: false, error: lastError ?? "Unable to issue invoice after retries." },
      { status: 500 }
    );
  } catch (err) {
    if (err instanceof TaxInvoiceError) {
      return NextResponse.json({ success: false, error: err.message }, { status: err.status });
    }
    const message = err instanceof Error ? err.message : "Internal server error";
    return NextResponse.json({ success: false, error: message }, { status: 500 });
  }
}
