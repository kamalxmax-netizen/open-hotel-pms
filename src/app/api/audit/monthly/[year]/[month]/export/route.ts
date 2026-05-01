import { assertAdminOrSupervisor, getAuthenticatedUser } from "@/lib/server-auth";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import {
  attachFullTaxInvoiceInfo,
  computeSummary,
  loadIssuedFullTaxInvoiceMap,
  loadMonthlyPosSalesSummary,
  previewMonth,
  splitMonthlyAuditEntries,
  type MonthlyAuditEntry,
  type MonthlyAuditPosSalesSummary,
} from "@/lib/monthly-audit";
import { NextRequest, NextResponse } from "next/server";
import * as XLSX from "xlsx";
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
  filter_dayuse: z.enum(["only", "exclude"]).optional(),
  sort_by: z.enum(["checkout_date", "guest_name", "room_number", "source", "total_revenue"]).optional().default("checkout_date"),
  sort_dir: z.enum(["asc", "desc"]).optional().default("asc"),
  mode: z.enum(["snapshot", "preview"]).optional().default("snapshot"),
  format: z.enum(["json", "csv", "xlsx"]).optional().default("json"),
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

function sortEntries<T extends MonthlyAuditEntry & { is_corrected?: boolean }>(
  entries: T[],
  sortBy: "checkout_date" | "guest_name" | "room_number" | "source" | "total_revenue",
  sortDir: "asc" | "desc"
): T[] {
  const sorted = [...entries].sort((a, b) => {
    const av =
      sortBy === "total_revenue"
        ? Number(a.total_revenue ?? 0)
        : String((a as any)[sortBy] ?? "").toLowerCase();
    const bv =
      sortBy === "total_revenue"
        ? Number(b.total_revenue ?? 0)
        : String((b as any)[sortBy] ?? "").toLowerCase();

    if (av < bv) return -1;
    if (av > bv) return 1;
    return 0;
  });

  if (sortDir === "desc") sorted.reverse();
  return sorted;
}

function applyEntryFilters<T extends MonthlyAuditEntry & { is_corrected?: boolean }>(
  entries: T[],
  query: z.infer<typeof querySchema>
) {
  let filtered = entries;

  if (query.source) filtered = filtered.filter((entry) => entry.source === query.source);
  if (query.tax_invoice === "true") filtered = filtered.filter((entry) => entry.tax_invoice_requested);
  if (query.tax_invoice === "false") filtered = filtered.filter((entry) => !entry.tax_invoice_requested);
  if (query.has_corrections === "true") filtered = filtered.filter((entry) => Boolean(entry.is_corrected));
  if (query.has_corrections === "false") filtered = filtered.filter((entry) => !entry.is_corrected);

  if (query.search) {
    const needle = query.search.toLowerCase();
    filtered = filtered.filter((entry) =>
      entry.guest_name.toLowerCase().includes(needle) ||
      (entry.booking_code ?? "").toLowerCase().includes(needle) ||
      (entry.room_number ?? "").toLowerCase().includes(needle)
    );
  }

  return sortEntries(filtered, query.sort_by, query.sort_dir);
}

function buildMonthlyAuditWorkbook(params: {
  year: number;
  month: number;
  status: string;
  mode: "snapshot" | "preview";
  entries: Array<MonthlyAuditEntry & { is_corrected?: boolean }>;
  fullTaxInvoiceEntries?: Array<MonthlyAuditEntry & { is_corrected?: boolean }>;
  posSales: MonthlyAuditPosSalesSummary;
}) {
  const { year, month, status, mode, entries, fullTaxInvoiceEntries = [], posSales } = params;
  const summary = computeSummary(entries, posSales);
  const fullTaxInvoiceSummary = computeSummary(fullTaxInvoiceEntries);
  const workbook = XLSX.utils.book_new();

  const summaryRows: unknown[][] = [
    ["Monthly Audit", `${year}-${String(month).padStart(2, "0")}`, mode === "preview" ? "Preview Live" : status],
    [],
    ["Source", "Count", "Room Revenue", "Extra Revenue", "POS Revenue", "Total Revenue", "Cash", "Transfer", "Credit Card", "Other", "Total Paid", "Refund", "Outstanding", "Tax Invoice"],
    ...Object.entries(summary.by_source)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([source, row]) => [
        source,
        row.count,
        row.room_revenue,
        row.extra_revenue,
        row.pos_revenue,
        row.total_revenue,
        row.paid_cash,
        row.paid_transfer,
        row.paid_credit_card,
        row.paid_other,
        row.total_paid,
        row.refund_total,
        row.outstanding,
        row.tax_invoice_count,
      ]),
    [
      "Total",
      summary.totals.count,
      summary.totals.room_revenue,
      summary.totals.extra_revenue,
      summary.totals.pos_revenue,
      summary.totals.total_revenue,
      summary.totals.paid_cash,
      summary.totals.paid_transfer,
      summary.totals.paid_credit_card,
      summary.totals.paid_other,
      summary.totals.total_paid,
      summary.totals.refund_total,
      summary.totals.outstanding,
      summary.totals.tax_invoice_count,
    ],
  ];

  const entryRows: unknown[][] = [
    [
      "Booking Code",
      "Guest Name",
      "Source",
      "Room",
      "Room Type",
      "Check-in",
      "Check-out",
      "Nights",
      "Room Revenue",
      "Extra Revenue",
      "POS Revenue",
      "Total Revenue",
      "Cash",
      "Transfer",
      "Credit Card",
      "Other",
      "Total Paid",
      "Refund",
      "Outstanding",
      "Tax Invoice",
      "Corrected",
    ],
    ...entries.map((entry) => [
      entry.booking_code ?? "",
      entry.guest_name ?? "",
      entry.source,
      entry.room_number ?? "",
      entry.room_type_name ?? "",
      entry.checkin_date,
      entry.checkout_date,
      entry.total_nights,
      entry.room_revenue,
      entry.extra_revenue,
      entry.pos_revenue,
      entry.total_revenue,
      entry.paid_cash,
      entry.paid_transfer,
      entry.paid_credit_card,
      entry.paid_other,
      entry.total_paid,
      entry.refund_total,
      entry.outstanding,
      entry.tax_invoice_requested ? "Yes" : "No",
      entry.is_corrected ? "Yes" : "No",
    ]),
  ];

  const fullTaxInvoiceRows: unknown[][] = [
    [
      "Invoice No",
      "Issue Date",
      "Booking Code",
      "Guest Name",
      "Source",
      "Room",
      "Room Type",
      "Check-in",
      "Check-out",
      "Nights",
      "Room Revenue",
      "Extra Revenue",
      "POS Revenue",
      "Total Revenue",
      "Cash",
      "Transfer",
      "Credit Card",
      "Other",
      "Total Paid",
      "Refund",
      "Outstanding",
      "Tax Invoice",
      "Corrected",
    ],
    ...fullTaxInvoiceEntries.map((entry) => [
      entry.full_tax_invoice?.invoice_no ?? "",
      entry.full_tax_invoice?.issue_date ?? "",
      entry.booking_code ?? "",
      entry.guest_name ?? "",
      entry.source,
      entry.room_number ?? "",
      entry.room_type_name ?? "",
      entry.checkin_date,
      entry.checkout_date,
      entry.total_nights,
      entry.room_revenue,
      entry.extra_revenue,
      entry.pos_revenue,
      entry.total_revenue,
      entry.paid_cash,
      entry.paid_transfer,
      entry.paid_credit_card,
      entry.paid_other,
      entry.total_paid,
      entry.refund_total,
      entry.outstanding,
      entry.tax_invoice_requested ? "Yes" : "No",
      entry.is_corrected ? "Yes" : "No",
    ]),
    [],
    [
      "Total",
      "",
      "",
      "",
      "",
      "",
      "",
      "",
      "",
      "",
      fullTaxInvoiceSummary.totals.room_revenue,
      fullTaxInvoiceSummary.totals.extra_revenue,
      fullTaxInvoiceSummary.totals.pos_revenue,
      fullTaxInvoiceSummary.totals.total_revenue,
      fullTaxInvoiceSummary.totals.paid_cash,
      fullTaxInvoiceSummary.totals.paid_transfer,
      fullTaxInvoiceSummary.totals.paid_credit_card,
      fullTaxInvoiceSummary.totals.paid_other,
      fullTaxInvoiceSummary.totals.total_paid,
      fullTaxInvoiceSummary.totals.refund_total,
      fullTaxInvoiceSummary.totals.outstanding,
      fullTaxInvoiceSummary.totals.tax_invoice_count,
      "",
    ],
  ];

  const posRows: unknown[][] = [
    ["POS Sales", `${year}-${String(month).padStart(2, "0")}`, mode === "preview" ? "Preview Live" : status],
    [],
    ["Items", posSales.item_count],
    ["Orders", posSales.order_count],
    ["Total Qty", posSales.total_quantity],
    ["Walk-in Total", posSales.walkin_total],
    ["Guest Charge Total", posSales.guest_charge_total],
    ["Total Sales", posSales.total_sales],
    [],
    ["Item", "Qty", "Walk-in Qty", "Walk-in", "Guest Charge Qty", "Guest Charge", "Total Sales", "Orders"],
    ...posSales.items.map((item) => [
      item.product_name,
      item.quantity,
      item.walkin_quantity,
      item.walkin_total,
      item.guest_charge_quantity,
      item.guest_charge_total,
      item.total_sales,
      item.order_count,
    ]),
  ];

  const summarySheet = XLSX.utils.aoa_to_sheet(summaryRows);
  const entriesSheet = XLSX.utils.aoa_to_sheet(entryRows);
  const fullTaxInvoiceSheet = XLSX.utils.aoa_to_sheet(fullTaxInvoiceRows);
  const posSheet = XLSX.utils.aoa_to_sheet(posRows);
  summarySheet["!cols"] = [
    { wch: 14 }, { wch: 10 }, { wch: 13 }, { wch: 13 }, { wch: 12 }, { wch: 14 },
    { wch: 12 }, { wch: 12 }, { wch: 12 }, { wch: 12 }, { wch: 12 }, { wch: 12 },
    { wch: 12 }, { wch: 12 },
  ];
  entriesSheet["!cols"] = [
    { wch: 24 }, { wch: 26 }, { wch: 12 }, { wch: 10 }, { wch: 16 },
    { wch: 12 }, { wch: 12 }, { wch: 8 },
    ...Array.from({ length: 11 }, () => ({ wch: 12 })),
    { wch: 12 }, { wch: 10 },
  ];
  fullTaxInvoiceSheet["!cols"] = [
    { wch: 16 }, { wch: 12 }, { wch: 24 }, { wch: 26 }, { wch: 12 },
    { wch: 10 }, { wch: 16 }, { wch: 12 }, { wch: 12 }, { wch: 8 },
    ...Array.from({ length: 11 }, () => ({ wch: 12 })),
    { wch: 12 }, { wch: 10 },
  ];
  posSheet["!cols"] = [
    { wch: 32 },
    { wch: 10 },
    { wch: 12 },
    { wch: 14 },
    { wch: 16 },
    { wch: 16 },
    { wch: 14 },
    { wch: 10 },
  ];

  XLSX.utils.book_append_sheet(workbook, summarySheet, "Summary");
  XLSX.utils.book_append_sheet(workbook, posSheet, "POS Sales");
  XLSX.utils.book_append_sheet(workbook, entriesSheet, "Entries");
  XLSX.utils.book_append_sheet(workbook, fullTaxInvoiceSheet, "Full Tax Invoice");
  return XLSX.write(workbook, { type: "buffer", bookType: "xlsx" }) as Buffer;
}

function buildCsvResponse(params: {
  year: number;
  month: number;
  entries: Array<MonthlyAuditEntry & { is_corrected?: boolean }>;
  fullTaxInvoiceEntries?: Array<MonthlyAuditEntry & { is_corrected?: boolean }>;
  filePrefix: string;
}) {
  const { year, month, entries, fullTaxInvoiceEntries = [], filePrefix } = params;
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

  if (fullTaxInvoiceEntries.length > 0) {
    csvRows.push("");
    csvRows.push(["Full Tax Invoice"].map(csvEscape).join(","));
    csvRows.push([
      "Invoice No",
      "Issue Date",
      ...headers,
    ].map(csvEscape).join(","));

    for (const e of fullTaxInvoiceEntries) {
      const rowValues = [
        e.full_tax_invoice?.invoice_no ?? "",
        e.full_tax_invoice?.issue_date ?? "",
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
  }

  const csvContent = csvRows.join("\n");
  const fileName = `${filePrefix}-${year}-${String(month).padStart(2, "0")}.csv`;

  return new NextResponse(csvContent, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${fileName}"`,
    },
  });
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
      filter_dayuse: request.nextUrl.searchParams.get("filter_dayuse") ?? undefined,
      sort_by: request.nextUrl.searchParams.get("sort_by") ?? undefined,
      sort_dir: request.nextUrl.searchParams.get("sort_dir") ?? undefined,
      mode: request.nextUrl.searchParams.get("mode") ?? undefined,
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

    if (query.mode === "preview") {
      const preview = await previewMonth({ supabase, year, month, filterDayuse: query.filter_dayuse });
      const filteredEntries = applyEntryFilters(
        preview.entries.map((entry) => ({ ...entry, is_corrected: false })),
        query
      );
      const split = splitMonthlyAuditEntries(filteredEntries, preview.summary.pos_sales);
      const summary = split.summary;

      if (query.format === "xlsx") {
        const buffer = buildMonthlyAuditWorkbook({
          year,
          month,
          status: "preview",
          mode: "preview",
          entries: split.normalEntries,
          fullTaxInvoiceEntries: split.fullTaxInvoiceEntries,
          posSales: preview.summary.pos_sales,
        });
        const body = buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength) as ArrayBuffer;
        const fileName = `monthly-audit-preview-${year}-${String(month).padStart(2, "0")}.xlsx`;
        return new NextResponse(body, {
          headers: {
            "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
            "Content-Disposition": `attachment; filename="${fileName}"`,
          },
        });
      }

      if (query.format === "csv") {
        return buildCsvResponse({
          year,
          month,
          entries: split.normalEntries,
          fullTaxInvoiceEntries: split.fullTaxInvoiceEntries,
          filePrefix: "monthly-audit-preview",
        });
      }

      return NextResponse.json({
        success: true,
        year,
        month,
        status: "preview",
        entries: split.normalEntries,
        full_tax_invoice_entries: split.fullTaxInvoiceEntries,
        summary,
        full_tax_invoice_summary: split.fullTaxInvoiceSummary,
        grand_summary: split.grandSummary,
      });
    }

    // Load period — must be audited or locked
    const { data: period, error: periodError } = await supabase
      .from("monthly_audit_periods")
      .select("id, status, summary_json")
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

    entries = applyEntryFilters(entries, query);

    const savedPosSales = (period.summary_json as any)?.pos_sales;
    const posSales = savedPosSales ?? await loadMonthlyPosSalesSummary({ supabase, year, month });
    const issuedFullTaxInvoiceMap = await loadIssuedFullTaxInvoiceMap(
      supabase,
      entries.map((entry) => entry.reservation_id)
    );
    entries = attachFullTaxInvoiceInfo(entries, issuedFullTaxInvoiceMap);
    const split = splitMonthlyAuditEntries(entries, posSales);
    const summary = split.summary;

    if (query.format === "xlsx") {
      const buffer = buildMonthlyAuditWorkbook({
        year,
        month,
        status: String(period.status),
        mode: "snapshot",
        entries: split.normalEntries,
        fullTaxInvoiceEntries: split.fullTaxInvoiceEntries,
        posSales,
      });
      const body = buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength) as ArrayBuffer;
      const fileName = `monthly-audit-${year}-${String(month).padStart(2, "0")}.xlsx`;
      return new NextResponse(body, {
        headers: {
          "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
          "Content-Disposition": `attachment; filename="${fileName}"`,
        },
      });
    }

    if (query.format === "csv") {
      return buildCsvResponse({
        year,
        month,
        entries: split.normalEntries,
        fullTaxInvoiceEntries: split.fullTaxInvoiceEntries,
        filePrefix: "monthly-audit",
      });
    }

    return NextResponse.json({
      success: true,
      year,
      month,
      status: period.status,
      entries: split.normalEntries,
      full_tax_invoice_entries: split.fullTaxInvoiceEntries,
      summary,
      full_tax_invoice_summary: split.fullTaxInvoiceSummary,
      grand_summary: split.grandSummary,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Internal server error";
    const status = message === "Forbidden" ? 403 : 500;
    return NextResponse.json({ success: false, error: message }, { status });
  }
}
