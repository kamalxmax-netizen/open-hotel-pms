"use client";

import React from "react";
import { format } from "date-fns";
import { th } from "date-fns/locale/th";
import useSWR from "@/hooks/use-simple-swr";
import { useLinenDashboard } from "@/hooks/use-linen-dashboard";
import { useLinenMonthlySummary } from "@/hooks/use-linen-monthly";
import { apiDataFetcher } from "@/lib/client/api-fetcher";
import type { LaundryRewashPendingResponse, LinenEditAuditLog } from "@/lib/types";
import { LinenSummaryCards } from "@/components/linen/linen-summary-cards";
import { LinenQuickLinks } from "@/components/linen/linen-quick-links";
import { LinenRecentActivity } from "@/components/linen/linen-recent-activity";
import { LinenDailySnapshotSection } from "@/components/linen/linen-daily-snapshot-section";

export default function LinenDashboardPage() {
    const { dashboard, isLoading } = useLinenDashboard();
    const { data: rewashData, isLoading: isRewashLoading } = useSWR<LaundryRewashPendingResponse>("/api/linen/rewash/pending", apiDataFetcher);
    const { data: editData, isLoading: isEditsLoading } = useSWR<LinenEditAuditLog[]>("/api/linen/edits/recent", apiDataFetcher);
    const now = new Date();
    const { data: monthlySummary, isLoading: isMonthlyLoading } = useLinenMonthlySummary(now.getFullYear(), now.getMonth() + 1);

    const todayDate = format(new Date(), "dd MMMM yyyy", { locale: th });
    const recentRewash = rewashData?.events ?? [];

    // Use dashboard-level totals instead of manual calculation to avoid type errors
    const summaryData = {
        today_sent_count: dashboard?.batches_today?.length || 0,
        today_sent_qty: dashboard?.total_sent || 0,
        pending_return_count: dashboard?.total_pending || 0,
        open_rewash_count: recentRewash.length,
        mtd_baht: monthlySummary?.total_baht || 0
    };

    const recentEdits = editData ?? [];
    const combinedLoading = isLoading || isRewashLoading || isMonthlyLoading || isEditsLoading;

    return (
        <div className="max-w-[1600px] mx-auto p-6 space-y-6 pb-24">
            <header className="flex flex-col md:flex-row md:items-end justify-between gap-4">
                <div>
                    <h1 className="text-2xl font-bold text-slate-900 dark:text-slate-100 font-thai">Linen & Laundry</h1>
                    <p className="text-sm text-slate-500 dark:text-slate-400 mt-1 font-thai tracking-wide">
                        การจัดการผ้าและค่าซักรีด — <span className="text-[#1B4038] dark:text-emerald-400 font-bold">Admin & Audit</span>
                    </p>
                </div>
                <div className="text-right hidden md:block">
                    <p className="text-xs font-bold text-slate-400 uppercase tracking-[0.2em]">Business Date</p>
                    <p className="text-sm font-bold text-slate-700 dark:text-slate-300 font-thai">{todayDate}</p>
                </div>
            </header>

            <LinenSummaryCards data={summaryData} isLoading={combinedLoading} />

            <LinenDailySnapshotSection />
            
            <LinenQuickLinks />

            <div className="grid grid-cols-1 gap-6">
                <div>
                    <div className="flex items-center gap-2 mb-4">
                        <div className="w-1.5 h-6 bg-[#1B4038] dark:bg-emerald-500 rounded-full" />
                        <h2 className="text-lg font-bold text-slate-800 dark:text-slate-200 font-thai">กิจกรรมล่าสุด</h2>
                    </div>
                    <LinenRecentActivity 
                        batches={dashboard?.batches_today || []} 
                        edits={recentEdits}
                        rewash={recentRewash}
                        isLoading={combinedLoading} 
                    />
                </div>
            </div>
        </div>
    );
}

// StatusBadge removed as it's now inside LinenRecentActivity
