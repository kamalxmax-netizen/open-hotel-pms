"use client";

import React from "react";

interface SummaryItem {
    name: string;
    qty: number;
}

interface MobileBatchStepSummaryProps {
    title: string;
    items: SummaryItem[];
    totalLabel?: string;
}

export function MobileBatchStepSummary({ title, items, totalLabel = "รวม" }: MobileBatchStepSummaryProps) {
    const total = items.reduce((sum, i) => sum + i.qty, 0);

    if (items.length === 0) return null;

    return (
        <div className="mb-6 animate-in fade-in slide-in-from-bottom-2 duration-300">
            <h3 className="text-sm font-bold text-slate-400 dark:text-slate-500 uppercase tracking-widest mb-3 flex items-center gap-2">
                <div className="w-1.5 h-1.5 rounded-full bg-[#1B4038] dark:bg-emerald-500" />
                {title}
            </h3>
            <div className="space-y-2 bg-white dark:bg-slate-900 rounded-2xl p-4 shadow-sm border border-slate-100 dark:border-slate-800">
                {items.map((item, idx) => (
                    <div key={idx} className="flex items-end gap-2 text-base">
                        <span className="text-slate-600 dark:text-slate-400 font-thai shrink-0">{item.name}</span>
                        <div className="flex-1 border-b-2 border-dotted border-slate-100 dark:border-slate-800 mb-1" />
                        <span className="font-bold text-slate-900 dark:text-slate-100 shrink-0">{item.qty}</span>
                    </div>
                ))}
                
                <div className="pt-2 mt-2 border-t border-slate-100 dark:border-slate-800 flex items-center justify-between">
                    <span className="text-sm font-bold text-slate-500 dark:text-slate-500">{totalLabel}</span>
                    <span className="text-2xl font-bold text-[#1B4038] dark:text-emerald-400">{total} <span className="text-sm font-medium text-slate-400 dark:text-slate-600 font-thai">ชิ้น</span></span>
                </div>
            </div>
        </div>
    );
}
