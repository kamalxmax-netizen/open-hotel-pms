"use client";

import React from "react";

export function StatusBadge({ status }: { status: string }) {
    const map: Record<string, {label: string, color: string}> = {
        'draft': { label: 'ร่าง', color: 'bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-400' },
        'fo_dirty_counted': { label: 'รอนับคืน', color: 'bg-amber-100 dark:bg-amber-900/30 text-amber-700 dark:text-amber-400' },
        'fo_return_counted': { label: 'รอร้านเซ็น', color: 'bg-amber-100 dark:bg-amber-900/30 text-amber-700 dark:text-amber-400' },
        'vendor_signed': { label: 'ร้านเซ็นแล้ว', color: 'bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-400' },
        'fo_return_signed': { label: 'ส่งงานให้ร้าน', color: 'bg-emerald-100 dark:bg-emerald-950/20 text-emerald-700 dark:text-emerald-400' },
        'closed': { label: 'เสร็จสมบูรณ์', color: 'bg-emerald-100 dark:bg-emerald-950/20 text-emerald-700 dark:text-emerald-400' },
        'partial': { label: 'เสร็จ (มีค้าง)', color: 'bg-emerald-50 dark:bg-emerald-950/10 text-emerald-600 dark:text-emerald-300 border border-emerald-100 dark:border-emerald-900/50' },
        'disputed': { label: 'ยอดไม่ตรง', color: 'bg-rose-100 dark:bg-rose-950/30 text-rose-700 dark:text-rose-400' },
        // Phase 66.2 Variance Tiers
        'variance_green': { label: 'Normal', color: 'bg-emerald-500 text-white dark:bg-emerald-600' },
        'variance_yellow': { label: 'Warning', color: 'bg-amber-400 text-amber-950 dark:bg-amber-500' },
        'variance_red': { label: 'Review', color: 'bg-rose-500 text-white dark:bg-rose-600' },
        'variance_na': { label: '—', color: 'bg-slate-100 dark:bg-slate-800 text-slate-400' },
    };
    
    const s = map[status] || { label: status, color: 'bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300' };
    
    return (
        <span className={`inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-bold leading-none uppercase tracking-tight ${s.color}`}>
            {s.label}
        </span>
    );
}
