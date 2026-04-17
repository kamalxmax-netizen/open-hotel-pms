"use client";

import React from "react";
import { format } from "date-fns";
import { th } from "date-fns/locale/th";
import type { LaundryBatch } from "@/lib/types";
import { ChevronRight, FileText, Package, AlertCircle } from "lucide-react";

interface LinenHistoryTableProps {
    batches: LaundryBatch[];
    isLoading: boolean;
    onViewDetail: (batch: LaundryBatch) => void;
}

export function LinenHistoryTable({ batches, isLoading, onViewDetail }: LinenHistoryTableProps) {
    if (isLoading) {
        return (
            <div className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 shadow-sm overflow-hidden p-12 text-center">
                <div className="animate-spin w-8 h-8 border-4 border-emerald-500 border-t-transparent rounded-full mx-auto mb-4" />
                <p className="text-slate-400 font-thai">กำลังดึงข้อมูลประวัติ...</p>
            </div>
        );
    }

    if (batches.length === 0) {
        return (
            <div className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 shadow-sm overflow-hidden p-12 text-center">
                <div className="w-16 h-16 bg-slate-50 dark:bg-slate-800 rounded-full flex items-center justify-center mx-auto mb-4">
                    <Package className="w-8 h-8 text-slate-300" />
                </div>
                <h3 className="text-lg font-bold text-slate-700 dark:text-slate-300 font-thai">ไม่พบรายการที่ค้นหา</h3>
                <p className="text-sm text-slate-500 font-thai">ลองเปลี่ยนตัวกรองหรือคำค้นหาใหม่</p>
            </div>
        );
    }

    return (
        <div className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 shadow-sm overflow-hidden">
            <div className="overflow-x-auto">
                <table className="w-full text-sm font-thai">
                    <thead>
                        <tr className="bg-slate-50 dark:bg-slate-800/50 border-b border-slate-200 dark:border-slate-700">
                            <th className="px-6 py-4 text-left font-bold text-slate-400 uppercase tracking-widest text-[10px]">Business Date</th>
                            <th className="px-6 py-4 text-left font-bold text-slate-400 uppercase tracking-widest text-[10px]">Round</th>
                            <th className="px-6 py-4 text-left font-bold text-slate-400 uppercase tracking-widest text-[10px]">Vendor</th>
                            <th className="px-6 py-4 text-right font-bold text-slate-400 uppercase tracking-widest text-[10px]">Total Items</th>
                            <th className="px-6 py-4 text-center font-bold text-slate-400 uppercase tracking-widest text-[10px]">Status</th>
                            <th className="px-6 py-4 text-right font-bold text-slate-400 uppercase tracking-widest text-[10px]">Actions</th>
                        </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                        {batches.map((batch) => (
                            <tr 
                                key={batch.id} 
                                className="group hover:bg-slate-50 dark:hover:bg-slate-800/50 transition-colors cursor-pointer"
                                onClick={() => onViewDetail(batch)}
                            >
                                <td className="px-6 py-4">
                                    <div className="flex items-center gap-2">
                                        <div className="w-8 h-8 rounded-lg bg-emerald-50 dark:bg-emerald-900/20 flex items-center justify-center">
                                            <FileText className="w-4 h-4 text-emerald-600" />
                                        </div>
                                        <span className="font-bold text-slate-900 dark:text-slate-100">
                                            {format(new Date(batch.business_date), "d MMM yyyy", { locale: th })}
                                        </span>
                                    </div>
                                </td>
                                <td className="px-6 py-4">
                                    <span className="px-2.5 py-1 bg-slate-100 dark:bg-slate-800 rounded-full text-xs font-bold text-slate-600 dark:text-slate-400">
                                        รอบ {batch.pickup_round}
                                    </span>
                                </td>
                                <td className="px-6 py-4 text-slate-600 dark:text-slate-400 font-medium">
                                    {batch.vendor_name || "-"}
                                </td>
                                <td className="px-6 py-4 text-right font-black text-slate-900 dark:text-slate-100">
                                    {batch.total_sent || 0}
                                </td>
                                <td className="px-6 py-4 text-center">
                                    <StatusBadge status={batch.status} />
                                </td>
                                <td className="px-6 py-4 text-right">
                                    <button className="p-2 rounded-full hover:bg-white dark:hover:bg-slate-700 text-slate-400 group-hover:text-emerald-500 transition-all">
                                        <ChevronRight className="w-5 h-5" />
                                    </button>
                                </td>
                            </tr>
                        ))}
                    </tbody>
                </table>
            </div>
        </div>
    );
}

function StatusBadge({ status }: { status: string }) {
    const map: Record<string, { label: string; color: string }> = {
        draft: { 
            label: "ร่าง (Draft)", 
            color: "bg-slate-100 dark:bg-slate-800 text-slate-600" 
        },
        disputed: { 
            label: "ยอดไม่ตรง", 
            color: "bg-rose-100 dark:bg-rose-950/30 text-rose-700 dark:text-rose-400 ring-1 ring-rose-200/50" 
        },
        closed: { 
            label: "สมบูรณ์", 
            color: "bg-emerald-100 dark:bg-emerald-950/20 text-emerald-700 dark:text-emerald-400 ring-1 ring-emerald-200/50" 
        },
        partial: { 
            label: "สมบูรณ์ (ค้าง)", 
            color: "bg-emerald-50 dark:bg-emerald-950/10 text-emerald-600 dark:text-emerald-300 border border-emerald-100/50" 
        },
        // Pending states
        fo_dirty_counted: { label: "รอนับคืน", color: "bg-amber-100 dark:bg-amber-900/30 text-amber-700 dark:text-amber-400" },
        fo_return_counted: { label: "รอร้านเซ็น", color: "bg-amber-100 dark:bg-amber-900/30 text-amber-700 dark:text-amber-400" },
        vendor_signed: { label: "รอ FO เซ็นรับ", color: "bg-amber-100 dark:bg-amber-900/30 text-amber-700 dark:text-amber-400" },
        fo_return_signed: { label: "ส่งซักแล้ว", color: "bg-amber-100 dark:bg-amber-900/30 text-amber-700 dark:text-amber-400" },
    };

    const s = map[status] || { label: status, color: "bg-slate-100 text-slate-600" };

    return (
        <span className={`inline-flex items-center px-2.5 py-1 rounded-full text-[10px] font-black uppercase tracking-tight shadow-sm ${s.color}`}>
            {s.label}
        </span>
    );
}
