"use client";

import React from "react";
import Link from "next/link";
import { format } from "date-fns";
import { th } from "date-fns/locale/th";
import { useLinenBatches } from "@/hooks/use-linen-batch";

export default function LinenHistoryPage() {
    const { batches, isLoading } = useLinenBatches();

    return (
        <div className="p-4 md:p-8 max-w-4xl mx-auto pb-20">
            <div className="flex items-center gap-3 mb-8">
                <Link 
                    href="/pms/linen"
                    className="w-10 h-10 rounded-full bg-white dark:bg-slate-800 flex items-center justify-center text-slate-500 dark:text-slate-400 hover:bg-slate-50 dark:hover:bg-slate-700 border border-slate-200 dark:border-slate-700 transition-colors shadow-sm"
                >
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="w-5 h-5"><path d="M15 18l-6-6 6-6"/></svg>
                </Link>
                <div>
                    <h1 className="text-2xl font-bold text-slate-900 dark:text-slate-100">ประวัติการรับ-ส่งผ้า</h1>
                    <p className="text-sm text-slate-500 dark:text-slate-400 mt-1">รายการทั้งหมดเรียงตามวันที่ล่าสุด</p>
                </div>
            </div>

            <div className="bg-white dark:bg-slate-900 rounded-xl border border-slate-200 dark:border-slate-800 shadow-sm overflow-hidden">
                <div className="p-4 border-b border-slate-100 dark:border-slate-800 bg-slate-50 dark:bg-slate-800/50 flex font-semibold text-slate-700 dark:text-slate-300 text-sm">
                    <div className="w-32">วันที่</div>
                    <div className="flex-1">รายละเอียด</div>
                    <div className="w-28 text-right">สถานะ</div>
                </div>
                
                {isLoading ? (
                    <div className="p-8 text-center text-slate-400 animate-pulse">กำลังโหลด...</div>
                ) : batches.length === 0 ? (
                    <div className="p-8 text-center text-slate-500">ไม่มีประวัติการรับ-ส่งผ้า</div>
                ) : (
                    <div className="divide-y divide-slate-100 dark:divide-slate-800">
                        {batches.map(batch => (
                            <Link 
                                href={`/pms/linen/batch/${batch.id}`}
                                key={batch.id} 
                                className="flex items-center p-4 hover:bg-slate-50 dark:hover:bg-slate-800/50 transition-colors group cursor-pointer"
                            >
                                <div className="w-32">
                                    <p className="font-semibold text-slate-800 dark:text-slate-200 text-sm">
                                        {format(new Date(batch.business_date), "d MMM yy", { locale: th })}
                                    </p>
                                    <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">รอบที่ {batch.pickup_round}</p>
                                </div>
                                <div className="flex-1">
                                    <p className="text-sm text-slate-700 dark:text-slate-300">
                                        ร้าน: <span className="font-medium text-slate-900 dark:text-slate-100">{batch.vendor_name || '-'}</span>
                                    </p>
                                </div>
                                <div className="w-28 text-right flex flex-col items-end gap-1">
                                    <StatusBadge status={batch.status} />
                                    <div className="text-slate-300 dark:text-slate-700 group-hover:text-slate-500 dark:group-hover:text-slate-500 transition-colors">
                                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="w-4 h-4"><path d="M9 18l6-6-6-6"/></svg>
                                    </div>
                                </div>
                            </Link>
                        ))}
                    </div>
                )}
            </div>
        </div>
    );
}

function StatusBadge({ status }: { status: string }) {
    const map: Record<string, {label: string, color: string}> = {
        'draft': { label: 'ร่าง', color: 'bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-400' },
        'fo_dirty_counted': { label: 'รอนับคืน', color: 'bg-amber-100 dark:bg-amber-900/30 text-amber-700 dark:text-amber-400' },
        'fo_return_counted': { label: 'รอร้านเซ็น', color: 'bg-amber-100 dark:bg-amber-900/30 text-amber-700 dark:text-amber-400' },
        'vendor_signed': { label: 'ร้านเซ็นแล้ว', color: 'bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-400' },
        'fo_return_signed': { label: 'ส่งงานให้ร้าน', color: 'bg-emerald-100 dark:bg-emerald-950/20 text-emerald-700 dark:text-emerald-400' },
        'closed': { label: 'เสร็จสมบูรณ์', color: 'bg-emerald-100 dark:bg-emerald-950/20 text-emerald-700 dark:text-emerald-400' },
        'partial': { label: 'เสร็จ (มีค้าง)', color: 'bg-emerald-50 dark:bg-emerald-950/10 text-emerald-600 dark:text-emerald-300 border border-emerald-100 dark:border-emerald-900/50' },
        'disputed': { label: 'ยอดไม่ตรง', color: 'bg-rose-100 dark:bg-rose-950/30 text-rose-700 dark:text-rose-400' },
    };
    
    const s = map[status] || { label: status, color: 'bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300' };
    
    return (
        <span className={`inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-bold leading-none uppercase tracking-tight ${s.color}`}>
            {s.label}
        </span>
    );
}
