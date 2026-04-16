"use client";

import React from "react";
import type { LinenDashboard } from "@/lib/types";

interface LinenDashboardCardsProps {
    dashboard?: LinenDashboard;
    isLoading?: boolean;
}

export function LinenDashboardCards({ dashboard, isLoading }: LinenDashboardCardsProps) {
    if (isLoading) {
        return (
            <div className="grid grid-cols-3 gap-4 mb-6">
                {[1,2,3].map(i => (
                    <div key={i} className="bg-slate-100 rounded-xl p-4 h-[88px] animate-pulse" />
                ))}
            </div>
        );
    }

    if (!dashboard) return null;

    return (
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-6">
            <div className="bg-blue-50 dark:bg-blue-900/20 border border-blue-100 dark:border-blue-800 p-4 rounded-xl shadow-sm flex flex-col justify-center">
                <p className="text-sm text-blue-600 dark:text-blue-400 font-medium mb-1 flex items-center justify-between">
                    <span>ส่งซักวันนี้ (ชิ้น)</span>
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="w-4 h-4 opacity-50">
                        <path d="M5 12h14M12 5l7 7-7 7"/>
                    </svg>
                </p>
                <p className="text-3xl font-bold text-blue-900 dark:text-blue-100">{dashboard.total_sent || 0}</p>
            </div>
            
            <div className="bg-emerald-50 dark:bg-emerald-900/20 border border-emerald-100 dark:border-emerald-800 p-4 rounded-xl shadow-sm flex flex-col justify-center">
                <p className="text-sm text-emerald-600 dark:text-emerald-400 font-medium mb-1 flex items-center justify-between">
                    <span>รับคืนวันนี้ (ชิ้น)</span>
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="w-4 h-4 opacity-50">
                        <path d="M19 12H5M12 19l-7-7 7-7"/>
                    </svg>
                </p>
                <p className="text-3xl font-bold text-emerald-900 dark:text-emerald-100">{dashboard.total_received || 0}</p>
            </div>
            
            <div className="bg-amber-50 dark:bg-amber-900/20 border border-amber-100 dark:border-amber-800 p-4 rounded-xl shadow-sm flex flex-col justify-center">
                <p className="text-sm text-amber-600 dark:text-amber-400 font-medium mb-1 flex items-center justify-between">
                    <span>ยอดค้างสะสม (ชิ้น)</span>
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="w-4 h-4 opacity-50">
                        <circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/>
                    </svg>
                </p>
                <p className="text-3xl font-bold text-amber-900 dark:text-amber-100">{dashboard.total_pending || 0}</p>
            </div>
        </div>
    );
}
