"use client";

import React from "react";
import Link from "next/link";
import { format } from "date-fns";
import { th } from "date-fns/locale/th";
import { useLinenDashboard } from "@/hooks/use-linen-dashboard";
import { LinenDashboardCards } from "@/components/linen/linen-dashboard-cards";

export default function LinenDashboardPage() {
    const { dashboard, isLoading } = useLinenDashboard();

    const todayDate = format(new Date(), "dd MMMM yyyy", { locale: th });

    return (
        <div className="p-4 md:p-8 max-w-4xl mx-auto pb-20">
            <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 mb-6">
                <div>
                    <h1 className="text-2xl font-bold text-slate-900 dark:text-slate-100">Linen & Laundry</h1>
                    <p className="text-sm text-slate-500 dark:text-slate-400 mt-1">สรุปข้อมูลประจำวันที่ {todayDate}</p>
                </div>
                
                <div className="flex items-center gap-2">
                    <Link 
                        href="/pms/linen/history"
                        className="px-4 py-2 bg-white dark:bg-slate-800 text-slate-700 dark:text-slate-200 font-medium text-sm rounded-xl border border-slate-300 dark:border-slate-700 hover:bg-slate-50 dark:hover:bg-slate-700 transition-colors"
                    >
                        ประวัติย้อนหลัง
                    </Link>
                    <Link 
                        href="/pms/linen/batch/new"
                        className="px-4 py-2 bg-[#1B4038] text-white font-medium text-sm rounded-xl shadow-[0_4px_12px_rgba(27,64,56,0.25)] hover:bg-[#122b26] transition-colors flex items-center gap-2"
                    >
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="w-4 h-4">
                            <path d="M12 5v14M5 12h14"/>
                        </svg>
                        รับ-ส่งผ้า
                    </Link>
                </div>
            </div>

            <LinenDashboardCards dashboard={dashboard} isLoading={isLoading} />

            {!isLoading && dashboard?.batches_today && dashboard.batches_today.length > 0 && (
                <div className="bg-white dark:bg-slate-900 rounded-xl border border-slate-200 dark:border-slate-800 overflow-hidden shadow-sm">
                    <div className="p-4 border-b border-slate-100 dark:border-slate-800 bg-slate-50 dark:bg-slate-800/50">
                        <h2 className="font-semibold text-slate-800 dark:text-slate-200">รายการรับ-ส่งผ้าของวันนี้</h2>
                    </div>
                    <div>
                        {dashboard.batches_today.map(batch => (
                            <Link 
                                href={`/pms/linen/batch/${batch.id}`} 
                                key={batch.id}
                                className="flex items-center justify-between p-4 border-b border-slate-50 dark:border-slate-800/50 last:border-0 hover:bg-slate-50 dark:hover:bg-slate-800/50 transition-colors group"
                            >
                                <div className="flex items-center gap-3">
                                    <div className="w-10 h-10 rounded-full bg-[#1B4038]/10 text-[#1B4038] dark:bg-emerald-500/20 dark:text-emerald-400 flex items-center justify-center shrink-0">
                                        <span className="font-bold text-sm">R{batch.pickup_round}</span>
                                    </div>
                                    <div>
                                        <p className="font-medium text-slate-800 dark:text-slate-200 text-sm">รอบที่ {batch.pickup_round}</p>
                                        <p className="text-xs text-slate-500 dark:text-slate-400 mt-1 flex items-center gap-1.5">
                                            <span>สถานะ</span>
                                            <StatusBadge status={batch.status} />
                                        </p>
                                    </div>
                                </div>
                                <div className="text-slate-400 dark:text-slate-600 group-hover:text-slate-600 dark:group-hover:text-slate-400 transition-colors">
                                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="w-5 h-5">
                                        <path d="M9 18l6-6-6-6"/>
                                    </svg>
                                </div>
                            </Link>
                        ))}
                    </div>
                </div>
            )}

            {!isLoading && (!dashboard?.batches_today || dashboard.batches_today.length === 0) && (
                <div className="bg-slate-50 dark:bg-slate-900/50 border-2 border-dashed border-slate-200 dark:border-slate-800 rounded-xl p-8 text-center flex flex-col items-center justify-center">
                    <div className="w-16 h-16 bg-white dark:bg-slate-800 rounded-full flex items-center justify-center text-slate-300 dark:text-slate-700 mb-4 shadow-sm border border-slate-100 dark:border-slate-700">
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="w-8 h-8">
                            <path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z"></path><polyline points="3.27 6.96 12 12.01 20.73 6.96"></polyline><line x1="12" y1="22.08" x2="12" y2="12"></line>
                        </svg>
                    </div>
                    <h3 className="font-semibold text-slate-700 dark:text-slate-300 mb-1">ยังไม่มีรายการรับ-ส่งผ้าวันนี้</h3>
                    <p className="text-sm text-slate-500 dark:text-slate-400 max-w-sm mb-6">กดปุ่มรับ-ส่งผ้าด้านบนเมื่อร้านซักรีดมารับผ้าเปื้อน หรือจะเริ่มการนับผ้าเผื่อเวลาก่อนที่ร้านจะมาถึงก็ได้เช่นกัน</p>
                    <Link 
                        href="/pms/linen/batch/new"
                        className="px-5 py-2.5 bg-[#1B4038] text-white font-medium text-sm rounded-xl shadow-[0_2px_8px_rgba(27,64,56,0.25)] hover:bg-[#122b26] transition-colors"
                    >
                        เริ่มนับผ้ารอบใหม่
                    </Link>
                </div>
            )}
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
