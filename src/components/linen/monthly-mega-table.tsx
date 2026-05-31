"use client";

import React, { useMemo, useState, useEffect } from "react";
import useSWR from "@/hooks/use-simple-swr";
import { apiDataFetcher } from "@/lib/client/api-fetcher";
import { useAdminRole } from "@/hooks/use-admin-role";
import { useSearchParams } from "next/navigation";
import type { LinenMonthlyMegaResponse, LinenMonthlyColumn, LinenMonthlyMegaRow } from "@/lib/types";
import { Loader2, RefreshCw, AlertCircle, Printer } from "lucide-react";

interface MonthlyMegaTableProps {
    year: number;
    month: number;
}

export function MonthlyMegaTable({ year, month }: MonthlyMegaTableProps) {
    const { isAdmin, role } = useAdminRole();
    const searchParams = useSearchParams();

    const [filters, setFilters] = useState({
        include_n: true,
        include_o: true,
        include_rw: searchParams.get("include_rw") !== "false",
    });

    // Sync include_rw to URL
    useEffect(() => {
        const url = new URL(window.location.href);
        url.searchParams.set("include_rw", String(filters.include_rw));
        window.history.replaceState(null, "", url.toString());
    }, [filters.include_rw]);
    
    const queryParams = useMemo(() => {
        const p = new URLSearchParams();
        if (filters.include_n) p.append("include_n", "true");
        if (filters.include_o) p.append("include_o", "true");
        if (filters.include_rw) p.append("include_rw", "true");
        return p.toString();
    }, [filters]);

    const { data, isLoading, error, mutate } = useSWR<LinenMonthlyMegaResponse>(
        `/api/linen/monthly/${year}/${month}/grid?${queryParams}`,
        apiDataFetcher
    );

    const [isReopening, setIsReopening] = useState(false);

    const { days, dayCols } = useMemo(() => {
        if (!data?.columns) return { days: [], dayCols: {} };
        
        const dayMap: Record<number, Record<number, LinenMonthlyColumn[]>> = {};
        const uniqueDays: number[] = [];

        data.columns.forEach(col => {
            if (!dayMap[col.day_of_month]) {
                dayMap[col.day_of_month] = {};
                uniqueDays.push(col.day_of_month);
            }
            if (!dayMap[col.day_of_month][col.pickup_round]) {
                dayMap[col.day_of_month][col.pickup_round] = [];
            }
            dayMap[col.day_of_month][col.pickup_round].push(col);
        });

        uniqueDays.sort((a, b) => a - b);
        return { days: uniqueDays, dayCols: dayMap };
    }, [data]);

    const handleReopen = async () => {
        const reason = window.prompt("กรุณาระบุเหตุผลในการเปิดรอบเดือนใหม่ (อย่างน้อย 10 ตัวอักษร)");
        if (!reason) return;
        if (reason.trim().length < 10) {
            alert("เหตุผลต้องมีอย่างน้อย 10 ตัวอักษร");
            return;
        }
        if (!confirm("ยืนยันการเปิดรอบเดือนใหม่? ข้อมูลที่มีอยู่จะถูกอนุญาตให้แก้ไขได้อีกครั้ง")) return;
        setIsReopening(true);
        try {
            const res = await fetch(`/api/linen/monthly/${year}/${month}/reopen`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ reason: reason.trim() }),
            });
            if (!res.ok) throw new Error("Failed to reopen month");
            await mutate();
            alert("เปิดรอบเดือนสำเร็จ");
        } catch (err) {
            console.error(err);
            alert("เกิดข้อผิดพลาดในการเปิดรอบเดือน");
        } finally {
            setIsReopening(false);
        }
    };

    if (isLoading) {
        return (
            <div className="h-96 flex flex-col items-center justify-center text-slate-400 gap-3 bg-white rounded-3xl border border-slate-100 shadow-sm">
                <Loader2 className="animate-spin" size={32} />
                <p className="font-bold text-xs uppercase tracking-widest font-thai">กำลังประมวลผล Mega Table...</p>
            </div>
        );
    }

    if (error || !data) {
        return (
            <div className="h-96 flex flex-col items-center justify-center text-rose-500 gap-3 bg-white rounded-3xl border border-slate-100 shadow-sm p-8 text-center">
                <AlertCircle size={48} />
                <h3 className="text-xl font-bold font-thai">ไม่สามารถโหลดข้อมูล Mega Table ได้</h3>
                <p className="text-sm font-thai opacity-70">โปรดตรวจสอบว่า Agent B ได้เพิ่ม API Endpoint แล้ว หรือลองรีเฟรชหน้าจอ</p>
                <button onClick={() => mutate()} className="mt-4 px-6 py-2 bg-slate-100 text-slate-700 rounded-xl font-bold font-thai hover:bg-slate-200 transition-all">
                    ลองใหม่อีกครั้ง
                </button>
            </div>
        );
    }

    return (
        <div className="space-y-4">
            <div className="flex justify-between items-center bg-white dark:bg-slate-900 p-4 rounded-2xl border border-slate-100 dark:border-slate-800 shadow-sm">
                <div className="flex items-center gap-6">
                    <div>
                        <p className="text-[10px] font-bold text-slate-400 uppercase tracking-[0.2em] mb-1">Grand Total Qty</p>
                        <p className="text-2xl font-black text-slate-900 dark:text-slate-100 font-thai">{new Intl.NumberFormat().format(data.totals.grand_total_qty)}</p>
                    </div>
                    <div className="w-px h-10 bg-slate-100 dark:bg-slate-800" />
                    <div>
                        <p className="text-[10px] font-bold text-slate-400 uppercase tracking-[0.2em] mb-1">Grand Total Baht</p>
                        <p className="text-2xl font-black text-[#1B4038] dark:text-emerald-400 font-thai">฿{new Intl.NumberFormat().format(data.totals.grand_total_baht)}</p>
                    </div>
                </div>

                <div className="flex items-center gap-4">
                    <div className="flex items-center gap-2 bg-slate-50 dark:bg-slate-800 p-1.5 rounded-xl border border-slate-100 dark:border-slate-700">
                        <label className="flex items-center gap-2 px-3 py-1.5 rounded-lg cursor-pointer transition-colors hover:bg-white dark:hover:bg-slate-700">
                            <input
                                type="checkbox"
                                checked={filters.include_n}
                                onChange={(e) => setFilters(f => ({ ...f, include_n: e.target.checked }))}
                                className="w-4 h-4 rounded border-slate-300 text-emerald-600 focus:ring-emerald-500"
                            />
                            <span className="text-xs font-bold text-slate-600 dark:text-slate-400 font-thai">ยอดคาดการณ์ (N)</span>
                        </label>
                        <div className="w-px h-4 bg-slate-200 dark:bg-slate-700" />
                        <label className="flex items-center gap-2 px-3 py-1.5 rounded-lg cursor-pointer transition-colors hover:bg-white dark:hover:bg-slate-700">
                            <input
                                type="checkbox"
                                checked={filters.include_o}
                                onChange={(e) => setFilters(f => ({ ...f, include_o: e.target.checked }))}
                                className="w-4 h-4 rounded border-slate-300 text-amber-600 focus:ring-amber-500"
                            />
	                            <span className="text-xs font-bold text-slate-600 dark:text-slate-400 font-thai">ยอดส่งเกิน (O)</span>
	                        </label>
	                        <div className="w-px h-4 bg-slate-200 dark:bg-slate-700" />
	                        <label className="flex items-center gap-2 px-3 py-1.5 rounded-lg cursor-pointer transition-colors hover:bg-white dark:hover:bg-slate-700">
	                            <input
	                                type="checkbox"
	                                checked={filters.include_rw}
	                                onChange={(e) => setFilters(f => ({ ...f, include_rw: e.target.checked }))}
	                                className="w-4 h-4 rounded border-slate-300 text-purple-600 focus:ring-purple-500"
	                            />
	                            <span className="text-xs font-bold text-slate-600 dark:text-slate-400 font-thai">ซักใหม่ (RW)</span>
	                        </label>
	                    </div>

	                    <button
	                        onClick={() => window.print()}
	                        className="flex items-center gap-2 px-4 py-2.5 bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300 border border-slate-200 dark:border-slate-700 rounded-xl font-bold text-xs hover:bg-slate-200 dark:hover:bg-slate-700 transition-all print:hidden"
	                    >
	                        <Printer className="w-4 h-4" />
	                        Print / PDF
	                    </button>

	                    {isAdmin && (
	                        <button
	                            onClick={handleReopen}
	                            disabled={isReopening}
	                            className="flex items-center gap-2 px-6 py-3 bg-rose-50 text-rose-600 border border-rose-100 rounded-xl font-bold font-thai hover:bg-rose-100 active:scale-95 transition-all disabled:opacity-50"
	                        >
	                            {isReopening ? <Loader2 className="animate-spin w-4 h-4" /> : <RefreshCw className="w-4 h-4" />}
	                            Reopen Month
	                        </button>
	                    )}
	                </div>
	            </div>

            <div className="card bg-white dark:bg-slate-900 border-slate-200 dark:border-slate-800 overflow-hidden shadow-sm flex flex-col h-[70vh]">
                <div className="flex-1 overflow-auto relative scrollbar-thin scrollbar-thumb-slate-200 dark:scrollbar-thumb-slate-800">
                    <table className="w-full text-xs font-thai border-separate border-spacing-0">
                        <thead className="sticky top-0 z-30 bg-white dark:bg-slate-900">
                            {/* Day Header */}
                            <tr>
                                <th rowSpan={3} className="sticky left-0 z-40 bg-slate-50 dark:bg-slate-800 border-b border-r border-slate-200 dark:border-slate-700 px-4 py-2 text-left min-w-[200px] shadow-[2px_0_5px_rgba(0,0,0,0.02)]">
                                    รายการสินค้า (Items)
                                </th>
                                <th rowSpan={3} className="sticky left-[200px] z-40 bg-slate-50 dark:bg-slate-800 border-b border-r border-slate-200 dark:border-slate-700 px-4 py-2 text-right min-w-[80px]">Total Qty</th>
                                <th rowSpan={3} className="sticky left-[280px] z-40 bg-slate-50 dark:bg-slate-800 border-b border-r border-slate-200 dark:border-slate-700 px-4 py-2 text-right min-w-[100px]">Total Baht</th>
                                <th rowSpan={3} className="sticky left-[380px] z-40 bg-slate-50 dark:bg-slate-800 border-b border-r border-slate-200 dark:border-slate-700 px-4 py-2 text-right min-w-[80px] text-purple-600">Total RW</th>
                                
                                {days.map(day => {
                                    const dayObj = dayCols[day];
                                    let totalCols = 0;
                                    Object.values(dayObj).forEach(roundCols => totalCols += roundCols.length);
                                    
                                    return (
                                        <th key={day} colSpan={totalCols} className="bg-slate-50 dark:bg-slate-800 border-b border-r border-slate-200 dark:border-slate-700 px-4 py-2 text-center font-bold">
                                            วันที่ {day}
                                        </th>
                                    );
                                })}
                            </tr>
                            {/* Round Header */}
                            <tr>
                                {days.map(day => {
                                    const dayObj = dayCols[day];
                                    return Object.entries(dayObj).map(([round, cols]) => (
                                        <th key={`${day}_R${round}`} colSpan={cols.length} className="bg-white dark:bg-slate-900 border-b border-r border-slate-100 dark:border-slate-800 px-2 py-1 text-center font-bold text-[10px] text-slate-500">
                                            Round {round}
                                        </th>
                                    ));
                                })}
                            </tr>
                            {/* Kind Header */}
                            <tr>
                                {data.columns.map(col => (
                                    <th key={col.key} className={`border-b border-r border-slate-100 dark:border-slate-800 px-2 py-1 text-center font-black text-[9px] min-w-[40px] ${
                                        col.kind === 'RW' ? 'bg-purple-50 text-purple-600' : 
                                        col.kind === 'N' ? 'bg-emerald-50 text-emerald-600' : 'bg-amber-50 text-amber-600'
                                    }`}>
                                        {col.kind}
                                    </th>
                                ))}
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                            {data.rows.map(row => (
                                <tr key={row.linen_item_id} className="hover:bg-slate-50 dark:hover:bg-slate-800/50 transition-colors">
                                    <td className="sticky left-0 z-20 bg-white dark:bg-slate-900 border-r border-slate-100 dark:border-slate-800 px-4 py-3 font-bold text-slate-800 dark:text-slate-200 shadow-[2px_0_5px_rgba(0,0,0,0.02)]">
                                        {row.name_th}
                                    </td>
                                    <td className="sticky left-[200px] z-20 bg-white dark:bg-slate-900 border-r border-slate-100 dark:border-slate-800 px-4 py-3 text-right font-bold text-slate-600">
                                        {row.total_qty}
                                    </td>
                                    <td className="sticky left-[280px] z-20 bg-white dark:bg-slate-900 border-r border-slate-100 dark:border-slate-800 px-4 py-3 text-right font-bold text-[#1B4038] dark:text-emerald-400">
                                        {new Intl.NumberFormat().format(row.total_baht)}
                                    </td>
                                    <td className="sticky left-[380px] z-20 bg-white dark:bg-slate-900 border-r border-slate-100 dark:border-slate-800 px-4 py-3 text-right font-bold text-purple-600">
                                        {row.total_rewash_qty}
                                    </td>
                                    {data.columns.map(col => {
                                        const cell = row.cells.find(c => c.column_key === col.key);
                                        return (
                                            <td key={col.key} className={`border-r border-slate-50 dark:border-slate-800 px-2 py-3 text-center text-[11px] font-medium ${
                                                col.kind === 'RW' ? 'bg-purple-50/20 text-purple-700' : ''
                                            }`}>
                                                {cell?.qty || "-"}
                                            </td>
                                        );
                                    })}
                                </tr>
                            ))}
                        </tbody>
                        <tfoot className="sticky bottom-0 z-30 bg-slate-50 dark:bg-slate-800 font-bold border-t-2 border-slate-200 dark:border-slate-700">
                            <tr>
                                <td className="sticky left-0 bg-slate-50 dark:bg-slate-800 border-r border-slate-200 px-4 py-3 shadow-[2px_0_5px_rgba(0,0,0,0.02)]">TOTAL QTY</td>
                                <td className="sticky left-[200px] bg-slate-50 dark:bg-slate-800 border-r border-slate-200 px-4 py-3 text-right">{data.totals.grand_total_qty}</td>
                                <td className="sticky left-[280px] bg-slate-50 dark:bg-slate-800 border-r border-slate-200 px-4 py-3 text-right text-emerald-600">฿{new Intl.NumberFormat().format(data.totals.grand_total_baht)}</td>
                                <td className="sticky left-[380px] bg-slate-50 dark:bg-slate-800 border-r border-slate-200 px-4 py-3 text-right text-purple-600">{data.totals.rewash_total_qty}</td>
                                {data.columns.map(col => (
                                    <td key={col.key} className="border-r border-slate-200 px-2 py-3 text-center">
                                        {data.totals.per_column[col.key] || "-"}
                                    </td>
                                ))}
                            </tr>
                        </tfoot>
                    </table>
                </div>
            </div>

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
                    .card {
                        height: auto !important;
                        overflow: visible !important;
                    }
                    .overflow-auto {
                        overflow: visible !important;
                    }
                    .sticky {
                        position: static !important;
                    }
                }
            `}</style>
        </div>
    );
}
