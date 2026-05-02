import { assertAdminOrSupervisor, getAuthenticatedUser } from "@/lib/server-auth";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import {
  attachFullTaxInvoiceInfo,
  computeSummary,
  getMonthlyAuditTaxChannel,
  loadIssuedFullTaxCoverageMap,
  loadMonthlyPosSalesSummary,
  splitMonthlyAuditEntries,
  type MonthlyAuditEntry,
} from "@/lib/monthly-audit";
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
  sort_by: z.enum(["checkout_date", "guest_name", "room_number", "source", "total_revenue"]).optional().default("checkout_date"),
  sort_dir: z.enum(["asc", "desc"]).optional().default("asc"),
});

function num(value: unknown): number {
  const n = Number(value ?? 0);
  return Number.isFinite(n) ? Math.round(n * 100) / 100 : 0;
}

function str(value: unknown): string {
  return String(value ?? "").trim();
}

function channelDisplayLabel(actual: string, taxInvoice: string): string {
  if (actual === "walkin" && taxInvoice === "ota") return "Walk-in(O)";
  if (taxInvoice === "ota" || taxInvoice === "agent") return "OTA";
  if (taxInvoice === "direct") return "Direct";
  return "Walk-in";
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
      sort_by: request.nextUrl.searchParams.get("sort_by") ?? undefined,
      sort_dir: request.nextUrl.searchParams.get("sort_dir") ?? undefined,
    });
    if (!parsedQuery.success) {
      return NextResponse.json(
        { success: false, error: "Invalid query.", details: parsedQuery.error.flatten() },
        { status: 400 }
      );
    }

    const { year, month } = parsedParams.data;
    const query = parsedQuery.data;

    // Load period
    const { data: period, error: periodError } = await supabase
      .from("monthly_audit_periods")
      .select("*")
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

    // Load entries
    // Pagination intentionally omitted for current boutique-hotel scale (<300 entries/month).
    let entriesQuery = supabase
      .from("monthly_audit_entries")
      .select("*")
      .eq("period_id", period.id)
      .order(query.sort_by, { ascending: query.sort_dir === "asc" });

    const { data: entriesData, error: entriesError } = await entriesQuery;
    if (entriesError) {
      return NextResponse.json({ success: false, error: entriesError.message }, { status: 500 });
    }

    // Load corrections for all entries
    const entryIds = ((entriesData ?? []) as any[]).map((e: any) => String(e.id));
    let correctionsMap = new Map<string, any[]>();
    let channelFlagMap = new Map<string, any>();

    if (entryIds.length > 0) {
      const { data: corrections } = await supabase
        .from("monthly_audit_corrections")
        .select("*")
        .in("entry_id", entryIds)
        .order("corrected_at", { ascending: false });

      for (const c of (corrections ?? []) as any[]) {
        const eid = String(c.entry_id);
        if (!correctionsMap.has(eid)) correctionsMap.set(eid, []);
        correctionsMap.get(eid)!.push({
          id: String(c.id),
          entry_id: eid,
          field_name: String(c.field_name),
          old_value: c.old_value ?? null,
          new_value: c.new_value ?? null,
          reason: c.reason ?? null,
          corrected_by: c.corrected_by ?? null,
          corrected_at: String(c.corrected_at),
        });
      }

      const { data: channelFlags, error: channelFlagError } = await supabase
        .from("monthly_audit_channel_flag")
        .select("*")
        .in("entry_id", entryIds);

      if (channelFlagError) {
        return NextResponse.json({ success: false, error: channelFlagError.message }, { status: 500 });
      }

      channelFlagMap = new Map(
        ((channelFlags ?? []) as any[]).map((flag: any) => [String(flag.entry_id), flag])
      );
    }

    // Shape entries
    let entries: MonthlyAuditEntry[] = ((entriesData ?? []) as any[]).map((e: any) => ({
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
      channel_flag: (() => {
        const flag = channelFlagMap.get(String(e.id));
        const actual = str(flag?.actual_channel || e.source);
        const taxInvoice = str(flag?.tax_invoice_channel || actual);
        return {
          actual_channel: actual,
          tax_invoice_channel: taxInvoice,
          display_label: channelDisplayLabel(actual, taxInvoice),
          reason: flag?.reason ?? null,
          flagged_by_user_id: flag?.flagged_by_user_id ?? null,
          flagged_at: flag?.flagged_at ? String(flag.flagged_at) : null,
        };
      })(),
      corrections: correctionsMap.get(String(e.id)) ?? [],
    }));

    const savedPosSales = (period.summary_json as any)?.pos_sales;
    const posSales = savedPosSales ?? await loadMonthlyPosSalesSummary({ supabase, year, month });
    const monthCoverageMap = await loadIssuedFullTaxCoverageMap(supabase, entries);
    const monthEntries = attachFullTaxInvoiceInfo(entries, monthCoverageMap);
    const monthSplit = splitMonthlyAuditEntries(monthEntries, posSales);

    // Apply filters
    if (query.source) {
      entries = entries.filter((e) => getMonthlyAuditTaxChannel(e) === query.source);
    }
    if (query.tax_invoice === "true") {
      entries = entries.filter((e) => e.tax_invoice_requested);
    } else if (query.tax_invoice === "false") {
      entries = entries.filter((e) => !e.tax_invoice_requested);
    }

    if (query.has_corrections === "true") {
      entries = entries.filter((e) => (e.corrections?.length ?? 0) > 0);
    } else if (query.has_corrections === "false") {
      entries = entries.filter((e) => (e.corrections?.length ?? 0) === 0);
    }

    if (query.search) {
      const needle = query.search.toLowerCase();
      entries = entries.filter((e) =>
        e.guest_name.toLowerCase().includes(needle) ||
        (e.booking_code ?? "").toLowerCase().includes(needle) ||
        (e.room_number ?? "").toLowerCase().includes(needle)
      );
    }

    const issuedFullTaxInvoiceMap = await loadIssuedFullTaxCoverageMap(supabase, entries);
    entries = attachFullTaxInvoiceInfo(entries, issuedFullTaxInvoiceMap);
    const split = splitMonthlyAuditEntries(entries, period.summary_json?.pos_sales ?? undefined);

    // Compute summary from filtered normal entries
    const summary = computeSummary(split.normalEntries, posSales);
    const splitWithPos = splitMonthlyAuditEntries(entries, posSales);

    // Available sources for filter dropdown
    const allSources = Array.from(
      new Set(monthEntries.map((entry) => getMonthlyAuditTaxChannel(entry)))
    )
      .filter(Boolean)
      .sort();

    return NextResponse.json({
      success: true,
      period: {
        id: String(period.id),
        year: Number(period.year),
        month: Number(period.month),
        status: String(period.status),
        closed_at: period.closed_at ?? null,
        audited_at: period.audited_at ?? null,
      },
      entries: splitWithPos.normalEntries,
      full_tax_invoice_entries: splitWithPos.fullTaxInvoiceEntries,
      summary,
      full_tax_invoice_summary: splitWithPos.fullTaxInvoiceSummary,
      grand_summary: splitWithPos.grandSummary,
      month_summary: monthSplit.summary,
      month_full_tax_invoice_summary: monthSplit.fullTaxInvoiceSummary,
      month_grand_summary: monthSplit.grandSummary,
      filters: {
        available_sources: allSources,
      },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Internal server error";
    const status = message === "Forbidden" ? 403 : 500;
    return NextResponse.json({ success: false, error: message }, { status });
  }
}
