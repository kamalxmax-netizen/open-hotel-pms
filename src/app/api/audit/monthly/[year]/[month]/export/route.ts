import { assertAdminOrSupervisor, getAuthenticatedUser } from "@/lib/server-auth";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { computeSummary, type MonthlyAuditEntry } from "@/lib/monthly-audit";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

export const dynamic = "force-dynamic";
export const fetchCache = "force-no-store";

const paramsSchema = z.object({
  year: z.coerce.number().int().min(2025).max(2030),
  month: z.coerce.number().int().min(1).max(12),
});

const querySchema = z.object({
  source: z.string().trim().min(1).max(50).optional(),
  tax_invoice: z.enum(["true", "false"]).optional(),
  has_corrections: z.enum(["true", "false"]).optional(),
  search: z.string().trim().max(200).optional(),
  format: z.enum(["json", "csv"]).optional().default("json"),
});

function num(value: unknown): number {
  const n = Number(value ?? 0);
  return Number.isFinite(n) ? Math.round(n * 100) / 100 : 0;
}

function str(value: unknown): string {
  return String(value ?? "").trim();
}

function csvEscape(value: unknown): string {
  const input = String(value ?? "");
  const protectedValue = /^[=+\-@\t\r]/.test(input) ? `'${input}` : input;
  if (/[",\n\r]/.test(protectedValue)) {
    return `"${protectedValue.replace(/"/g, '""')}"`;
  }
  return protectedValue;
}

export async function GET(
  request: NextRequest,
  { params }: { params: { year: string; month: string } }
) {
  try {
    const supabase = createServerSupabaseClient();
    const user = await getAuthenticatedUser(supabase, request);
    if (!user) {
      return NextResponse.json({ success: false, error: "Unauthorized" }, { status: 401 });
    }
    await assertAdminOrSupervisor(supabase, user.id);

    const parsedParams = paramsSchema.safeParse(params);
    if (!parsedParams.success) {
      return NextResponse.json(
        { success: false, error: "Invalid params.", details: parsedParams.error.flatten() },
        { status: 400 }
      );
    }

    const parsedQuery = querySchema.safeParse({
      source: request.nextUrl.searchParams.get("source") ?? undefined,
      tax_invoice: request.nextUrl.searchParams.get("tax_invoice") ?? undefined,
      has_corrections: request.nextUrl.searchParams.get("has_corrections") ?? undefined,
      search: request.nextUrl.searchParams.get("search") ?? undefined,
      format: request.nextUrl.searchParams.get("format") ?? undefined,
    });
    if (!parsedQuery.success) {
      return NextResponse.json(
        { success: false, error: "Invalid query.", details: parsedQuery.error.flatten() },
        { status: 400 }
      );
    }

    const { year, month } = parsedParams.data;
    const query = parsedQuery.data;

    // Load period — must be audited or locked
    const { data: period, error: periodError } = await supabase
      .from("monthly_audit_periods")
      .select("id, status")
      .eq("year", year)
      .eq("month", month)
      .maybeSingle();

    if (periodError) {
      return NextResponse.json({ success: false, error: periodError.message }, { status: 500 });
    }
    if (!period) {
      return NextResponse.json(
        { success: false, error: `No audit period found for ${year}-${String(month).padStart(2, "0")}.` },
        { status: 404 }
      );
    }
    if (period.status !== "audited" && period.status !== "locked") {
      return NextResponse.json(
        { success: false, error: `Export requires audited or locked period. Current: ${period.status}` },
        { status: 409 }
      );
    }

    // Load entries (corrected values already applied to entry rows)
    let entriesQuery = supabase
      .from("monthly_audit_entries")
      .select("*")
      .eq("period_id", period.id)
      .order("checkout_date", { ascending: true });

    if (query.source) entriesQuery = entriesQuery.eq("source", query.source);
    if (query.tax_invoice === "true") entriesQuery = entriesQuery.eq("tax_invoice_requested", true);
    if (query.tax_invoice === "false") entriesQuery = entriesQuery.eq("tax_invoice_requested", false);

    const { data: entriesData, error: entriesError } = await entriesQuery;
    if (entriesError) {
      return NextResponse.json({ success: false, error: entriesError.message }, { status: 500 });
    }

    // Load corrections for marking which entries were corrected
    const entryIds = ((entriesData ?? []) as any[]).map((e: any) => String(e.id));
    const correctedEntryIds = new Set<string>();

    if (entryIds.length > 0) {
      const { data: corrections } = await supabase
        .from("monthly_audit_corrections")
        .select("entry_id")
        .in("entry_id", entryIds);

      for (const c of (corrections ?? []) as any[]) {
        correctedEntryIds.add(String(c.entry_id));
      }
    }

    let entries: (MonthlyAuditEntry & { is_corrected: boolean })[] = ((entriesData ?? []) as any[]).map((e: any) => ({
      id: String(e.id),
      period_id: String(e.period_id),
      reservation_id: String(e.reservation_id),
      booking_code: e.booking_code ?? null,
      guest_name: str(e.guest_name),
      source: str(e.source),
      checkin_date: str(e.checkin_date),
      checkout_date: str(e.checkout_date),
      room_number: e.room_number ?? null,
      room_type_name: e.room_type_name ?? null,
      total_nights: Number(e.total_nights ?? 1),
      room_revenue: num(e.room_revenue),
      extra_revenue: num(e.extra_revenue),
      pos_revenue: num(e.pos_revenue),
      total_revenue: num(e.total_revenue),
      paid_cash: num(e.paid_cash),
      paid_transfer: num(e.paid_transfer),
      paid_credit_card: num(e.paid_credit_card),
      paid_other: num(e.paid_other),
      total_paid: num(e.total_paid),
      refund_total: num(e.refund_total),
      outstanding: num(e.outstanding),
      tax_invoice_requested: Boolean(e.tax_invoice_requested),
      tax_invoice_name: e.tax_invoice_name ?? null,
      tax_id: e.tax_id ?? null,
      nationality: e.nationality ?? null,
      passport_number: e.passport_number ?? null,
      id_card_number: e.id_card_number ?? null,
      guest_count: Number(e.guest_count ?? 1),
      is_corrected: correctedEntryIds.has(String(e.id)),
    }));

    if (query.has_corrections === "true") {
      entries = entries.filter((entry) => entry.is_corrected);
    } else if (query.has_corrections === "false") {
      entries = entries.filter((entry) => !entry.is_corrected);
    }

    if (query.search) {
      const needle = query.search.toLowerCase();
      entries = entries.filter((entry) =>
        entry.guest_name.toLowerCase().includes(needle) ||
        (entry.booking_code ?? "").toLowerCase().includes(needle) ||
        (entry.room_number ?? "").toLowerCase().includes(needle)
      );
    }

    const summary = computeSummary(entries);

    if (query.format === "csv") {
      const headers = [
        "Booking Code", "Guest Name", "Source", "Room", "Room Type",
        "Check-in", "Check-out", "Nights",
        "Room Revenue", "Extra Revenue", "POS Revenue", "Total Revenue",
        "Cash", "Transfer", "Credit Card", "Other", "Total Paid",
        "Refund", "Outstanding",
        "Tax Invoice", "Corrected",
      ];

      const csvRows = [headers.map(csvEscape).join(",")];
      for (const e of entries) {
        const rowValues = [
          e.booking_code ?? "",
          e.guest_name ?? "",
          e.source,
          e.room_number ?? "",
          e.room_type_name ?? "",
          e.checkin_date,
          e.checkout_date,
          e.total_nights,
          e.room_revenue,
          e.extra_revenue,
          e.pos_revenue,
          e.total_revenue,
          e.paid_cash,
          e.paid_transfer,
          e.paid_credit_card,
          e.paid_other,
          e.total_paid,
          e.refund_total,
          e.outstanding,
          e.tax_invoice_requested ? "Yes" : "No",
          e.is_corrected ? "Yes" : "No",
        ];
        csvRows.push(rowValues.map(csvEscape).join(","));
      }

      const csvContent = csvRows.join("\n");
      const fileName = `monthly-audit-${year}-${String(month).padStart(2, "0")}.csv`;

      return new NextResponse(csvContent, {
        headers: {
          "Content-Type": "text/csv; charset=utf-8",
          "Content-Disposition": `attachment; filename="${fileName}"`,
        },
      });
    }

    return NextResponse.json({
      success: true,
      year,
      month,
      status: period.status,
      entries,
      summary,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Internal server error";
    const status = message === "Forbidden" ? 403 : 500;
    return NextResponse.json({ success: false, error: message }, { status });
  }
}
