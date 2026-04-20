import {
  abbreviatedTaxErrorResponse,
  requireAbbreviatedTaxActor,
} from "@/lib/abbreviated-tax-invoice/api-auth";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

export const dynamic = "force-dynamic";
export const fetchCache = "force-no-store";

const querySchema = z.object({
  period: z.string().uuid(),
  channel: z.enum(["ota", "walkin_direct"]).optional(),
});

export async function GET(request: NextRequest) {
  try {
    const actor = await requireAbbreviatedTaxActor(request);
    if (!actor.ok) return actor.response;

    const parsed = querySchema.safeParse({
      period: request.nextUrl.searchParams.get("period") ?? undefined,
      channel: request.nextUrl.searchParams.get("channel") ?? undefined,
    });
    if (!parsed.success) {
      return NextResponse.json(
        { success: false, error: "Invalid query.", details: parsed.error.flatten() },
        { status: 400 }
      );
    }

    let invoiceQuery = actor.supabase
      .from("abbreviated_tax_invoice")
      .select("id, invoice_no, book_no, issue_date, channel_group, status, subtotal_inc_vat, subtotal_ex_vat, vat_amount")
      .eq("audit_period_id", parsed.data.period)
      .neq("status", "cancelled")
      .order("issue_date", { ascending: true })
      .order("channel_group", { ascending: true });

    if (parsed.data.channel) {
      invoiceQuery = invoiceQuery.eq("channel_group", parsed.data.channel);
    }

    const { data: invoices, error: invoiceError } = await invoiceQuery;
    if (invoiceError) return NextResponse.json({ success: false, error: invoiceError.message }, { status: 500 });

    const invoiceIds = ((invoices ?? []) as any[]).map((invoice) => String(invoice.id));
    let lineRows: any[] = [];
    if (invoiceIds.length > 0) {
      const { data: lines, error: lineError } = await actor.supabase
        .from("abbreviated_tax_invoice_line")
        .select("*")
        .in("invoice_id", invoiceIds)
        .order("line_order", { ascending: true });
      if (lineError) return NextResponse.json({ success: false, error: lineError.message }, { status: 500 });
      lineRows = (lines ?? []) as any[];
    }

    const linesByInvoiceId = new Map<string, any[]>();
    for (const line of lineRows) {
      const invoiceId = String(line.invoice_id);
      const rows = linesByInvoiceId.get(invoiceId) ?? [];
      rows.push(line);
      linesByInvoiceId.set(invoiceId, rows);
    }

    const detail = ((invoices ?? []) as any[]).map((invoice) => ({
      ...invoice,
      lines: linesByInvoiceId.get(String(invoice.id)) ?? [],
    }));

    return NextResponse.json({
      success: true,
      period: parsed.data.period,
      channel: parsed.data.channel ?? null,
      count: detail.length,
      data: detail,
    });
  } catch (err) {
    return abbreviatedTaxErrorResponse(err);
  }
}
