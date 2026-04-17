import { linenApiError, requireLinenAccess } from "@/lib/linen/api-auth";
import { getMonthlyDaily, getMonthlySummary } from "@/lib/linen/monthly";
import { computeMonthlyVariance } from "@/lib/linen/monthly-variance";
import { NextRequest, NextResponse } from "next/server";
import * as XLSX from "xlsx";
import { z } from "zod";

export const dynamic = "force-dynamic";
export const fetchCache = "force-no-store";

const querySchema = z.object({
  year: z.coerce.number().int().min(2020).max(2100),
  month: z.coerce.number().int().min(1).max(12),
});

function safePercent(value: number | null | undefined): string {
  if (value === null || value === undefined || !Number.isFinite(Number(value))) return "";
  return `${Number(value).toFixed(1)}%`;
}

export async function GET(request: NextRequest) {
  try {
    const parsed = querySchema.safeParse({
      year: request.nextUrl.searchParams.get("year"),
      month: request.nextUrl.searchParams.get("month"),
    });
    if (!parsed.success) {
      return NextResponse.json(
        { success: false, error: "Invalid query.", details: parsed.error.flatten() },
        { status: 400 }
      );
    }

    const { supabase } = await requireLinenAccess(request);
    const { year, month } = parsed.data;
    const [summary, daily, variance] = await Promise.all([
      getMonthlySummary(supabase, year, month),
      getMonthlyDaily(supabase, year, month),
      computeMonthlyVariance(supabase, year, month),
    ]);

    const dayHeaders = Array.from({ length: daily.days_in_month }, (_, index) => index + 1);
    const rows: unknown[][] = [[
      "",
      "รายการ/วันที่",
      "ราคา",
      "รวม",
      "รวมเงิน",
      "ตามจริง",
      "Diff Percent",
      "",
      ...dayHeaders,
      "",
      "เก่า",
    ]];

    const varianceByItem = new Map(variance.rows.map((row) => [row.linen_item_id, row]));
    const dailyByItemDay = new Map(
      daily.cells.map((cell) => [`${cell.linen_item_id}:${cell.day_of_month}`, cell.qty_sent])
    );

    for (const item of [...summary.items].sort((a, b) => a.item_number - b.item_number)) {
      const varianceRow = varianceByItem.get(item.linen_item_id);
      rows.push([
        "",
        item.name_th,
        item.rate,
        item.qty_sent,
        item.total_baht,
        varianceRow?.expected_qty ?? "",
        safePercent(varianceRow?.variance_pct),
        "",
        ...dayHeaders.map((day) => dailyByItemDay.get(`${item.linen_item_id}:${day}`) ?? 0),
        "",
        item.qty_dayuse || 0,
      ]);
    }

    for (const extra of summary.extras) {
      rows.push([
        "",
        extra.item_name,
        "",
        extra.qty,
        "",
        "",
        "",
        "",
        ...dayHeaders.map(() => ""),
        "",
        "",
      ]);
    }

    rows.push([]);
    rows.push([
      "",
      "Grand Total",
      "",
      summary.total_pieces,
      summary.total_baht,
      "",
      "",
      "",
      ...dayHeaders.map(() => ""),
      "",
      "",
    ]);

    const workbook = XLSX.utils.book_new();
    const worksheet = XLSX.utils.aoa_to_sheet(rows);
    worksheet["!cols"] = [
      { wch: 5 },
      { wch: 25 },
      { wch: 10 },
      { wch: 10 },
      { wch: 12 },
      { wch: 10 },
      { wch: 12 },
      { wch: 2 },
      ...dayHeaders.map(() => ({ wch: 4 })),
      { wch: 2 },
      { wch: 8 },
    ];

    XLSX.utils.book_append_sheet(workbook, worksheet, "สรุปรายเดือน");
    const buffer = XLSX.write(workbook, { type: "buffer", bookType: "xlsx" }) as Buffer;
    const fileName = `Linen_Monthly_${year}-${String(month).padStart(2, "0")}.xlsx`;

    const body = buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength) as ArrayBuffer;

    return new NextResponse(body, {
      headers: {
        "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "Content-Disposition": `attachment; filename="${fileName}"`,
      },
    });
  } catch (error) {
    console.error("api/linen/monthly/export GET failed", error);
    const { status, message } = linenApiError(error, "Failed to export linen monthly report.");
    return NextResponse.json({ success: false, error: message }, { status });
  }
}
