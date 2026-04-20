import {
  abbreviatedTaxErrorResponse,
  requireAbbreviatedTaxActor,
} from "@/lib/abbreviated-tax-invoice/api-auth";
import { NextRequest, NextResponse } from "next/server";

import { renderAbbreviatedA4Html } from "@/lib/abbreviated-tax-invoice/printAbbreviatedHtml";
import { computeAbbreviatedStayRange } from "@/lib/abbreviated-tax-invoice/service";
import type { AbbreviatedRenderData, AbbreviatedRenderPage, ChannelGroup } from "@/lib/abbreviated-tax-invoice/types";
import { ABBREVIATED_MAX_ROWS_PER_HALF_PAGE } from "@/lib/abbreviated-tax-invoice/types";

export const dynamic = "force-dynamic";
export const fetchCache = "force-no-store";

export async function GET(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const actor = await requireAbbreviatedTaxActor(request);
    if (!actor.ok) return actor.response;

    const queryId = String(params.id ?? "").trim();
    if (!queryId) {
      return NextResponse.json({ success: false, error: "Missing id." }, { status: 400 });
    }

    const { searchParams } = new URL(request.url);
    const mode = searchParams.get("mode") || "invoice"; // 'invoice' or 'period'
    const channelGroupFilter = searchParams.get("channel_group");
    if (mode !== "invoice" && mode !== "period") {
      return NextResponse.json({ success: false, error: "Invalid print mode." }, { status: 400 });
    }
    if (
      channelGroupFilter &&
      channelGroupFilter !== "ota" &&
      channelGroupFilter !== "walkin_direct"
    ) {
      return NextResponse.json({ success: false, error: "Invalid channel_group." }, { status: 400 });
    }
    if (mode === "period" && !channelGroupFilter) {
      return NextResponse.json(
        { success: false, error: "channel_group is required for period print mode." },
        { status: 400 }
      );
    }

    let invoicesQuery = actor.supabase
      .from("abbreviated_tax_invoice")
      .select("*, lines:abbreviated_tax_invoice_line(*)")
      .order("issue_date", { ascending: true })
      .order("invoice_no", { ascending: true });

    if (mode === "period") {
      invoicesQuery = invoicesQuery.eq("audit_period_id", queryId);
      invoicesQuery = invoicesQuery.eq("channel_group", channelGroupFilter as ChannelGroup);
    } else {
      invoicesQuery = invoicesQuery.eq("id", queryId);
    }

    const { data: invoices, error: invoiceError } = await invoicesQuery;
    if (invoiceError) return NextResponse.json({ success: false, error: invoiceError.message }, { status: 500 });
    if (!invoices || invoices.length === 0) return NextResponse.json({ success: false, error: "No invoices found." }, { status: 404 });

    const pages: AbbreviatedRenderPage[] = [];

    // Process chunking (1 A4 = 2 invoices)
    for (let i = 0; i < invoices.length; i += 2) {
      const topInv = invoices[i];
      const bottomInv = invoices[i + 1] || null;

      const buildHalfPage = (inv: any) => {
        let rows = (inv.lines || []).sort((a: any, b: any) => a.line_order - b.line_order);
        // Pad to exactly 7 rows
        const renderRows = rows.map((r: any) => ({
          line_order: r.line_order, label_th: r.label_th, quantity: r.quantity, unit_price: r.unit_price, amount: r.amount
        }));
        while (renderRows.length < ABBREVIATED_MAX_ROWS_PER_HALF_PAGE) {
          renderRows.push({ line_order: 0, label_th: "", quantity: 0, unit_price: 0, amount: 0 });
        }

        const stayRange = computeAbbreviatedStayRange(inv.issue_date);
        return {
          invoice_no: inv.invoice_no,
          book_no: inv.book_no,
          issue_date: inv.issue_date,
          stay_date_from: stayRange.from,
          stay_date_to: stayRange.to,
          rows: renderRows.slice(0, ABBREVIATED_MAX_ROWS_PER_HALF_PAGE),
          subtotal_inc_vat: inv.subtotal_inc_vat,
        };
      };

      pages.push({
        top: buildHalfPage(topInv),
        bottom: bottomInv ? buildHalfPage(bottomInv) : null
      });
    }

    const renderData: AbbreviatedRenderData = {
      channel_group: invoices[0].channel_group,
      seller: invoices[0].seller_snapshot,
      pages,
    };

    const html = renderAbbreviatedA4Html(renderData);

    return new NextResponse(html, {
      headers: {
        "content-type": "text/html; charset=utf-8",
        "cache-control": "no-store",
      },
    });
  } catch (err) {
    return abbreviatedTaxErrorResponse(err);
  }
}
