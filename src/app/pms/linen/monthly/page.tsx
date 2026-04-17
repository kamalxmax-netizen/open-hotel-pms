"use client";

import React, { useState } from "react";
import { MonthPicker } from "./_components/MonthPicker";
import { ExpenseSummary } from "./_components/ExpenseSummary";
import { PerItemTable } from "./_components/PerItemTable";
import { PerDayGrid } from "./_components/PerDayGrid";
import { VarianceSection } from "./_components/VarianceSection";
import { CloseMonthDialog } from "./_components/CloseMonthDialog";
import { ExportButton } from "./_components/ExportButton";
import { useLinenMonthlySummary, useLinenMonthlyDaily, useLinenMonthlyVariance } from "@/hooks/use-linen-monthly";
import { startOfMonth } from "date-fns";
import { Loader2 } from "lucide-react";

export default function MonthlyLinenPage() {
  const [selectedDate, setSelectedDate] = useState(startOfMonth(new Date()));
  const [activeTab, setActiveTab] = useState<"item" | "day">("item");

  const year = selectedDate.getFullYear();
  const month = selectedDate.getMonth() + 1;

  const { data: summary, isLoading: isLoadingSummary, mutate: mutateSummary } = useLinenMonthlySummary(year, month);
  const { data: dailyData, isLoading: isLoadingDaily } = useLinenMonthlyDaily(year, month);
  const { data: varianceData, isLoading: isLoadingVariance } = useLinenMonthlyVariance(year, month);

  const isLoading = isLoadingSummary || isLoadingDaily || isLoadingVariance;

  const handleCloseMonth = async (): Promise<void> => {
    if (!summary) return;
    const res = await fetch("/api/linen/monthly/close", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ year: summary.year, month: summary.month }),
    });
    const payload = await res.json().catch(() => null);
    if (!res.ok || payload?.success === false) {
      const errors = Array.isArray(payload?.errors) ? ` (${payload.errors.join(", ")})` : "";
      throw new Error(`${payload?.error ?? "Failed to close month"}${errors}`);
    }
    await mutateSummary();
  };

  return (
    <div className="p-4 md:p-8 max-w-7xl mx-auto pb-20 space-y-6">
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-black text-slate-900 dark:text-slate-100 uppercase tracking-tight">ผ้าซัก — สรุปรายเดือน</h1>
          <p className="text-sm text-slate-500 dark:text-slate-400 mt-1">สรุปยอดรับ-ส่งผ้า, ต้นทุนรวบยอด และการวิเคราะห์ส่วนต่างรายเดือน</p>
        </div>

        <div className="flex items-center gap-3">
          <MonthPicker currentDate={selectedDate} onChange={setSelectedDate} />
          <ExportButton summary={summary} dailyData={dailyData} varianceData={varianceData} />
          <CloseMonthDialog summary={summary} onClose={handleCloseMonth} />
        </div>
      </div>

      {isLoading ? (
        <div className="h-[60vh] flex flex-col items-center justify-center text-slate-400 gap-3">
          <Loader2 className="animate-spin" size={32} />
          <p className="font-bold text-xs uppercase tracking-widest">กำลังโหลดข้อมูล...</p>
        </div>
      ) : summary && dailyData ? (
        <>
          <ExpenseSummary summary={summary} />
          
          <VarianceSection varianceData={varianceData} />

          <div className="space-y-4">
            <div className="flex items-center gap-1 bg-slate-100 dark:bg-slate-800 p-1 rounded-xl w-fit">
              <button
                onClick={() => setActiveTab("item")}
                className={`px-4 py-2 text-xs font-bold rounded-lg transition-all ${
                  activeTab === "item" 
                    ? "bg-white dark:bg-slate-900 text-[#1B4038] dark:text-emerald-400 shadow-sm" 
                    : "text-slate-500 hover:text-slate-700 dark:hover:text-slate-300"
                }`}
              >
                PER-ITEM SUMMARY
              </button>
              <button
                onClick={() => setActiveTab("day")}
                className={`px-4 py-2 text-xs font-bold rounded-lg transition-all ${
                  activeTab === "day" 
                    ? "bg-white dark:bg-slate-900 text-[#1B4038] dark:text-emerald-400 shadow-sm" 
                    : "text-slate-500 hover:text-slate-700 dark:hover:text-slate-300"
                }`}
              >
                PER-DAY GRID
              </button>
            </div>

            {activeTab === "item" ? (
              <PerItemTable summary={summary} varianceData={varianceData} />
            ) : (
              <PerDayGrid dailyData={dailyData} summaryItems={summary.items} />
            )}
          </div>
        </>
      ) : (
        <div className="h-[60vh] flex flex-col items-center justify-center text-slate-400 gap-3">
          <p className="font-bold text-xs uppercase tracking-widest text-rose-500">ไม่สามารถโหลดข้อมูลได้</p>
        </div>
      )}
    </div>
  );
}
