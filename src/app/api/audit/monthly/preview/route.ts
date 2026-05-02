import { assertAdminOrSupervisor, getAuthenticatedUser } from "@/lib/server-auth";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { MonthlyAuditError, previewMonth, splitMonthlyAuditEntries, type MonthlyAuditEntry } from "@/lib/monthly-audit";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

export const dynamic = "force-dynamic";
export const fetchCache = "force-no-store";

const querySchema = z.object({
  year: z.coerce.number().int().min(2025).max(2030),
  month: z.coerce.number().int().min(1).max(12),
  filter_dayuse: z.enum(["only", "exclude"]).optional(),
  source: z.string().trim().min(1).max(50).optional(),
  tax_invoice: z.enum(["true", "false"]).optional(),
  has_corrections: z.enum(["true", "false"]).optional(),
  search: z.string().trim().max(200).optional(),
  sort_by: z.enum(["checkout_date", "guest_name", "room_number", "source", "total_revenue"]).optional().default("checkout_date"),
  sort_dir: z.enum(["asc", "desc"]).optional().default("asc"),
});

function sortEntries(
  entries: MonthlyAuditEntry[],
  sortBy: "checkout_date" | "guest_name" | "room_number" | "source" | "total_revenue",
  sortDir: "asc" | "desc"
): MonthlyAuditEntry[] {
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

export async function GET(request: NextRequest) {
  try {
    const supabase = createServerSupabaseClient();
    const user = await getAuthenticatedUser(supabase, request);
    if (!user) {
      return NextResponse.json({ success: false, error: "Unauthorized" }, { status: 401 });
    }
    await assertAdminOrSupervisor(supabase, user.id);

    const parsed = querySchema.safeParse({
      year: request.nextUrl.searchParams.get("year") ?? undefined,
      month: request.nextUrl.searchParams.get("month") ?? undefined,
      filter_dayuse: request.nextUrl.searchParams.get("filter_dayuse") ?? undefined,
      source: request.nextUrl.searchParams.get("source") ?? undefined,
      tax_invoice: request.nextUrl.searchParams.get("tax_invoice") ?? undefined,
      has_corrections: request.nextUrl.searchParams.get("has_corrections") ?? undefined,
      search: request.nextUrl.searchParams.get("search") ?? undefined,
      sort_by: request.nextUrl.searchParams.get("sort_by") ?? undefined,
      sort_dir: request.nextUrl.searchParams.get("sort_dir") ?? undefined,
    });
    if (!parsed.success) {
      return NextResponse.json(
        { success: false, error: "Invalid query.", details: parsed.error.flatten() },
        { status: 400 }
      );
    }

    const { year, month, filter_dayuse, source, tax_invoice, has_corrections, search, sort_by, sort_dir } =
      parsed.data;
    const preview = await previewMonth({ supabase, year, month, filterDayuse: filter_dayuse });

    let entries = preview.entries;

    if (source) entries = entries.filter((e) => e.source === source);
    if (tax_invoice === "true") entries = entries.filter((e) => e.tax_invoice_requested);
    if (tax_invoice === "false") entries = entries.filter((e) => !e.tax_invoice_requested);

    // Preview has no corrections yet; keep behavior explicit for shared filters UI.
    if (has_corrections === "true") entries = [];

    if (search) {
      const needle = search.toLowerCase();
      entries = entries.filter((e) =>
        e.guest_name.toLowerCase().includes(needle) ||
        (e.booking_code ?? "").toLowerCase().includes(needle) ||
        (e.room_number ?? "").toLowerCase().includes(needle)
      );
    }

    entries = sortEntries(entries, sort_by, sort_dir);

    const split = splitMonthlyAuditEntries(entries, preview.summary.pos_sales);

    return NextResponse.json({
      success: true,
      mode: "preview",
      year,
      month,
      period: null,
      entries: split.normalEntries,
      full_tax_invoice_entries: split.fullTaxInvoiceEntries,
      summary: split.summary,
      full_tax_invoice_summary: split.fullTaxInvoiceSummary,
      grand_summary: split.grandSummary,
      filters: {
        available_sources: preview.available_sources,
      },
      generated_at: preview.generated_at,
    });
  } catch (err) {
    if (err instanceof MonthlyAuditError) {
      return NextResponse.json({ success: false, error: err.message }, { status: err.status });
    }
    const message = err instanceof Error ? err.message : "Internal server error";
    const status = message === "Forbidden" ? 403 : 500;
    return NextResponse.json({ success: false, error: message }, { status });
  }
}
