"use client";

import React, { useMemo } from "react";
import useSWR from "@/hooks/use-simple-swr";
import { apiDataFetcher } from "@/lib/client/api-fetcher";
import { Loader2 } from "lucide-react";
import type { LinenMonthlyMegaResponse, LinenMonthlyColumn } from "@/lib/types";

interface VendorMonthlyData {
  meta: {
    hotel_name: string;
    vendor_name: string;
    year: number;
    month: number;
    generated_at: string;
    expires_at: string;
  };
  grid: LinenMonthlyMegaResponse;
}

const THAI_MONTHS = [
  "", "มกราคม", "กุมภาพันธ์", "มีนาคม", "เมษายน", "พฤษภาคม", "มิถุนายน",
  "กรกฎาคม", "สิงหาคม", "กันยายน", "ตุลาคม", "พฤศจิกายน", "ธันวาคม",
];

function formatThaiMonth(year: number, month: number): string {
  return `${THAI_MONTHS[month]} ${year + 543}`;
}

interface DayColumn {
  day: number;
  label: string;
  kind: "N" | "O";
  columnKey: string;
}

export default function VendorMonthlyPage({ params }: { params: { token: string } }) {
  const { data, isLoading, error } = useSWR<VendorMonthlyData>(
    `/api/linen/vendor/monthly/${params.token}`,
    apiDataFetcher
  );

  const { dayColumns, rows, totals } = useMemo(() => {
    if (!data?.grid) return { dayColumns: [], rows: [], totals: { qty: 0, baht: 0 } };

    const grid = data.grid;
    const cols: DayColumn[] = [];

    // Build day columns: split N and O when both exist
    const dayMap = new Map<number, LinenMonthlyColumn[]>();
    for (const col of grid.columns) {
      if (!dayMap.has(col.day_of_month)) dayMap.set(col.day_of_month, []);
      dayMap.get(col.day_of_month)!.push(col);
    }

    const sortedDays = Array.from(dayMap.keys()).sort((a, b) => a - b);
    for (const day of sortedDays) {
      const dayCols = dayMap.get(day)!;
      const hasN = dayCols.some((c) => c.kind === "N");
      const hasO = dayCols.some((c) => c.kind === "O");

      if (hasN && hasO) {
        // Split into two columns
        const nCol = dayCols.find((c) => c.kind === "N")!;
        const oCol = dayCols.find((c) => c.kind === "O")!;
        cols.push({ day, label: `${day}`, kind: "N", columnKey: nCol.key });
        cols.push({ day, label: `${day}(เก่า)`, kind: "O", columnKey: oCol.key });
      } else if (hasN) {
        const nCol = dayCols.find((c) => c.kind === "N")!;
        cols.push({ day, label: `${day}`, kind: "N", columnKey: nCol.key });
      } else if (hasO) {
        const oCol = dayCols.find((c) => c.kind === "O")!;
        cols.push({ day, label: `${day}(เก่า)`, kind: "O", columnKey: oCol.key });
      }
    }

    // Build rows
    const rowItems = grid.rows.map((row) => {
      const cells = cols.map((col) => {
        const cell = row.cells.find((c) => c.column_key === col.columnKey);
        return cell?.qty ?? 0;
      });
      return {
        id: row.linen_item_id,
        name: row.name_th,
        totalQty: row.total_qty,
        totalBaht: row.total_baht,
        cells,
      };
    });

    // Totals per column
    const totalCells = cols.map((col) => grid.totals.per_column[col.columnKey] ?? 0);

    return {
      dayColumns: cols,
      rows: rowItems,
      totals: {
        cells: totalCells,
        qty: grid.totals.grand_total_qty,
        baht: grid.totals.grand_total_baht,
      },
    };
  }, [data]);

  const handlePrint = () => {
    window.print();
  };

  if (isLoading) {
    return (
      <div className="min-h-screen bg-slate-50 flex items-center justify-center p-4">
        <div className="flex flex-col items-center gap-3">
          <Loader2 className="animate-spin text-[#1B4038]" size={32} />
          <p className="font-bold text-xs uppercase tracking-widest text-slate-400 font-thai">กำลังโหลดสรุปรายเดือน...</p>
        </div>
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="min-h-screen bg-slate-50 flex items-center justify-center p-4">
        <div className="bg-white p-8 rounded-3xl shadow-xl border border-slate-200 text-center max-w-sm w-full">
          <div className="w-16 h-16 bg-rose-50 text-rose-500 rounded-full flex items-center justify-center mx-auto mb-4 border border-rose-100">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" className="w-8 h-8">
              <circle cx="12" cy="12" r="10" />
              <line x1="12" y1="8" x2="12" y2="12" />
              <line x1="12" y1="16" x2="12.01" y2="16" />
            </svg>
          </div>
          <h2 className="text-xl font-bold text-slate-800 mb-2 font-thai">เข้าถึงไม่สำเร็จ</h2>
          <p className="text-slate-400 font-thai">ลิงก์นี้ไม่ถูกต้อง หรือหมดอายุไปแล้ว</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-slate-50 text-slate-900 pb-20 font-thai">
      {/* Header */}
      <div className="bg-[#1B4038] px-6 pt-10 pb-12 text-white rounded-b-[3rem] shadow-lg relative overflow-hidden">
        <div className="absolute top-0 right-0 p-8 opacity-10">
          <svg viewBox="0 0 24 24" fill="currentColor" className="w-48 h-48">
            <path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z" />
          </svg>
        </div>
        <div className="relative z-10">
          <h1 className="text-2xl font-black tracking-tight uppercase">สรุปรายเดือน — ผ้าซักรีด</h1>
          <div className="flex items-center gap-2 mt-3">
            <div className="px-3 py-1 bg-white/10 rounded-full border border-white/20 text-sm font-bold">
              โรงแรม {data.meta.hotel_name}
            </div>
            {data.meta.vendor_name && (
              <div className="px-3 py-1 bg-white/10 rounded-full border border-white/20 text-sm font-bold">
                {data.meta.vendor_name}
              </div>
            )}
          </div>
          <p className="text-emerald-100/70 mt-4 flex items-center gap-2 text-sm font-medium">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" className="w-4 h-4">
              <rect x="3" y="4" width="18" height="18" rx="2" ry="2" />
              <line x1="16" y1="2" x2="16" y2="6" />
              <line x1="8" y1="2" x2="8" y2="6" />
              <line x1="3" y1="10" x2="21" y2="10" />
            </svg>
            {formatThaiMonth(data.meta.year, data.meta.month)}
          </p>
        </div>
      </div>

      {/* Print Button */}
      <div className="max-w-7xl mx-auto mt-6 px-4 flex justify-end print:hidden">
        <button
          onClick={handlePrint}
          className="flex items-center gap-2 px-6 py-3 bg-[#1B4038] text-white rounded-xl font-bold text-sm hover:bg-[#122b26] transition-all shadow-sm"
        >
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="w-4 h-4">
            <polyline points="6 9 6 2 18 2 18 9" />
            <path d="M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2" />
            <rect x="6" y="14" width="12" height="8" />
          </svg>
          พิมพ์ / PDF
        </button>
      </div>

      {/* Table */}
      <div className="max-w-7xl mx-auto mt-4 px-4">
        <div className="bg-white border border-slate-200 rounded-2xl overflow-hidden shadow-sm">
          <div className="overflow-x-auto">
            <table className="w-full text-xs border-separate border-spacing-0">
              <thead className="sticky top-0 z-20 bg-white">
                <tr>
                  <th className="sticky left-0 z-30 bg-slate-50 border-b border-r border-slate-200 px-4 py-3 text-left min-w-[180px] font-bold text-slate-600 shadow-[2px_0_5px_rgba(0,0,0,0.02)]">
                    รายการ
                  </th>
                  {dayColumns.map((col, i) => (
                    <th
                      key={`${col.columnKey}-${i}`}
                      className={`border-b border-r border-slate-200 px-2 py-3 text-center min-w-[50px] font-bold ${
                        col.kind === "O" ? "bg-amber-50 text-amber-700" : "bg-slate-50 text-slate-600"
                      }`}
                    >
                      {col.label}
                    </th>
                  ))}
                  <th className="border-b border-r border-slate-200 bg-emerald-50 px-4 py-3 text-right min-w-[80px] font-bold text-emerald-700">
                    รวมชิ้น
                  </th>
                  <th className="border-b border-slate-200 bg-emerald-50 px-4 py-3 text-right min-w-[100px] font-bold text-emerald-700">
                    รวมเงิน
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {rows.map((row) => (
                  <tr key={row.id} className="hover:bg-slate-50/50 transition-colors">
                    <td className="sticky left-0 z-10 bg-white border-r border-slate-100 px-4 py-3 font-bold text-slate-800 shadow-[2px_0_5px_rgba(0,0,0,0.02)]">
                      {row.name}
                    </td>
                    {row.cells.map((qty, i) => (
                      <td
                        key={i}
                        className={`border-r border-slate-100 px-2 py-3 text-center font-medium ${
                          qty === 0 ? "text-slate-300" : "text-slate-700"
                        }`}
                      >
                        {qty === 0 ? "-" : qty}
                      </td>
                    ))}
                    <td className="border-r border-slate-100 bg-emerald-50/50 px-4 py-3 text-right font-bold text-slate-700">
                      {row.totalQty}
                    </td>
                    <td className="bg-emerald-50/50 px-4 py-3 text-right font-bold text-[#1B4038]">
                      ฿{new Intl.NumberFormat().format(row.totalBaht)}
                    </td>
                  </tr>
                ))}
              </tbody>
              <tfoot className="sticky bottom-0 z-20 bg-slate-50 font-bold border-t-2 border-slate-200">
                <tr>
                  <td className="sticky left-0 bg-slate-50 border-r border-slate-200 px-4 py-3 shadow-[2px_0_5px_rgba(0,0,0,0.02)]">
                    รวมทั้งหมด
                  </td>
                  {totals.cells?.map((qty, i) => (
                    <td key={i} className="border-r border-slate-200 px-2 py-3 text-center">
                      {qty === 0 ? "-" : qty}
                    </td>
                  ))}
                  <td className="border-r border-slate-200 bg-emerald-100 px-4 py-3 text-right text-emerald-800">
                    {totals.qty}
                  </td>
                  <td className="bg-emerald-100 px-4 py-3 text-right text-[#1B4038]">
                    ฿{new Intl.NumberFormat().format(totals.baht)}
                  </td>
                </tr>
              </tfoot>
            </table>
          </div>
        </div>

        {/* Footer info */}
        <div className="mt-4 text-center text-[10px] text-slate-300 uppercase tracking-tighter">
          Hotel Laundry System • Vendor Monthly Statement • {data.meta.hotel_name}
        </div>
      </div>

      {/* Print styles */}
      <style jsx global>{`
        @media print {
          @page {
            size: A4 landscape;
            margin: 8mm;
          }
          body {
            -webkit-print-color-adjust: exact;
            print-color-adjust: exact;
          }
          .print\\:hidden {
            display: none !important;
          }
        }
      `}</style>
    </div>
  );
}
