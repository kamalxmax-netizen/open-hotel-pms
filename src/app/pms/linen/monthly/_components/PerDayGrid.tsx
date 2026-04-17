"use client";

import React from "react";
import { LinenMonthlyDaily, LinenMonthlySummaryRow } from "@/lib/types";

interface PerDayGridProps {
  dailyData: LinenMonthlyDaily;
  summaryItems: LinenMonthlySummaryRow[];
}

export function PerDayGrid({ dailyData, summaryItems }: PerDayGridProps) {
  const days = Array.from({ length: dailyData.days_in_month }, (_, i) => i + 1);
  const sortedItems = [...summaryItems].sort((a, b) => a.item_number - b.item_number);

  // Find max qty in grid for adaptive scale
  const maxQty = Math.max(...dailyData.cells.map(c => c.qty_sent), 1);

  const getHeatmapClass = (qty: number) => {
    if (qty === 0) return "bg-slate-50/50 dark:bg-slate-800/20 text-slate-300 dark:text-slate-700";
    
    const ratio = qty / maxQty;
    if (ratio < 0.2) return "bg-emerald-50 dark:bg-emerald-950/20 text-emerald-800 dark:text-emerald-400";
    if (ratio < 0.4) return "bg-emerald-100 dark:bg-emerald-900/30 text-emerald-800 dark:text-emerald-300";
    if (ratio < 0.6) return "bg-emerald-200 dark:bg-emerald-800/40 text-emerald-900 dark:text-emerald-200";
    if (ratio < 0.8) return "bg-emerald-400 dark:bg-emerald-600/60 text-white";
    return "bg-[#1B4038] dark:bg-emerald-500 text-white";
  };

  return (
    <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl overflow-hidden shadow-sm">
      <div className="overflow-x-auto">
        <table className="w-full text-left border-collapse table-fixed">
          <thead>
            <tr className="bg-slate-50 dark:bg-slate-800/50 border-b border-slate-100 dark:border-slate-800">
              <th className="p-3 text-[10px] font-bold text-slate-400 dark:text-slate-500 uppercase tracking-widest w-40 sticky left-0 bg-slate-50 dark:bg-slate-800 z-10">รายการ / วันที่</th>
              {days.map(day => (
                <th key={day} className="p-2 text-[10px] font-bold text-slate-400 dark:text-slate-500 text-center w-10">
                  {day}
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-50 dark:divide-slate-800/50">
            {sortedItems.map(item => (
              <tr key={item.linen_item_id} className="group">
                <td className="p-3 sticky left-0 bg-white dark:bg-slate-900 z-10 border-r border-slate-50 dark:border-slate-800/50 shadow-[4px_0_8px_-4px_rgba(0,0,0,0.05)]">
                  <p className="font-bold text-slate-700 dark:text-slate-200 text-xs truncate">{item.name_th}</p>
                </td>
                {days.map(day => {
                  const cell = dailyData.cells.find(c => c.linen_item_id === item.linen_item_id && c.day_of_month === day);
                  const qty = cell?.qty_sent || 0;
                  
                  return (
                    <td 
                      key={day} 
                      className={`p-1 text-center text-[10px] font-bold transition-all hover:scale-110 cursor-pointer ${getHeatmapClass(qty)}`}
                      title={`${item.name_th} วันที่ ${day}: ${qty} ชิ้น`}
                      onClick={() => console.log(`Drill down for ${item.name_th} day ${day}`)}
                    >
                      {qty || ""}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="p-3 bg-slate-50 border-t border-slate-100 dark:bg-slate-800/50 dark:border-slate-800 flex items-center justify-between text-[10px] font-bold text-slate-400 uppercase tracking-widest">
        <span>Heatmap Scale (Max: {maxQty})</span>
        <div className="flex gap-px h-2">
          <div className="w-4 bg-emerald-50 dark:bg-emerald-950/20" />
          <div className="w-4 bg-emerald-100 dark:bg-emerald-900/30" />
          <div className="w-4 bg-emerald-200 dark:bg-emerald-800/40" />
          <div className="w-4 bg-emerald-400 dark:bg-emerald-600/60" />
          <div className="w-4 bg-[#1B4038] dark:bg-emerald-500" />
        </div>
      </div>
    </div>
  );
}
