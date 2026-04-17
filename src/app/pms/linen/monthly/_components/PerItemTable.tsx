"use client";

import React from "react";
import { LinenMonthlySummary, LinenMonthlyVariance } from "@/lib/types";
import { StatusBadge } from "@/components/linen/status-badge";

interface PerItemTableProps {
  summary: LinenMonthlySummary;
  varianceData?: LinenMonthlyVariance;
}

export function PerItemTable({ summary, varianceData }: PerItemTableProps) {
  const formatMoney = (val: number) => {
    return new Intl.NumberFormat("th-TH").format(val);
  };

  const formatNumber = (val: number) => {
    return new Intl.NumberFormat("th-TH").format(val);
  };

  // Sort by item number
  const sortedItems = [...summary.items].sort((a, b) => a.item_number - b.item_number);

  return (
    <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl overflow-hidden shadow-sm">
      <div className="overflow-x-auto">
        <table className="w-full text-left border-collapse">
          <thead>
            <tr className="bg-slate-50 dark:bg-slate-800/50 border-b border-slate-100 dark:border-slate-800">
              <th className="p-4 text-[10px] font-bold text-slate-400 dark:text-slate-500 uppercase tracking-widest text-center w-12 sticky top-0 bg-slate-50 dark:bg-slate-800/50">#</th>
              <th className="p-4 text-[10px] font-bold text-slate-400 dark:text-slate-500 uppercase tracking-widest sticky top-0 bg-slate-50 dark:bg-slate-800/50">รายการ</th>
              <th className="p-4 text-[10px] font-bold text-slate-400 dark:text-slate-500 uppercase tracking-widest text-right sticky top-0 bg-slate-50 dark:bg-slate-800/50">ราคา</th>
              <th className="p-4 text-[10px] font-bold text-slate-400 dark:text-slate-500 uppercase tracking-widest text-center sticky top-0 bg-slate-50 dark:bg-slate-800/50">ส่ง</th>
              <th className="p-4 text-[10px] font-bold text-slate-400 dark:text-slate-500 uppercase tracking-widest text-center sticky top-0 bg-slate-50 dark:bg-slate-800/50">คืน</th>
              <th className="p-4 text-[10px] font-bold text-slate-400 dark:text-slate-500 uppercase tracking-widest text-center sticky top-0 bg-slate-50 dark:bg-slate-800/50">ค้าง</th>
              <th className="p-4 text-[10px] font-bold text-slate-400 dark:text-slate-500 uppercase tracking-widest text-right sticky top-0 bg-slate-50 dark:bg-slate-800/50">รวมเงิน</th>
              <th className="p-4 text-[10px] font-bold text-slate-400 dark:text-slate-500 uppercase tracking-widest text-right sticky top-0 bg-slate-50 dark:bg-slate-800/50">Expected</th>
              <th className="p-4 text-[10px] font-bold text-slate-400 dark:text-slate-500 uppercase tracking-widest text-center sticky top-0 bg-slate-50 dark:bg-slate-800/50 font-sans">%</th>
              <th className="p-4 text-[10px] font-bold text-slate-400 dark:text-slate-500 uppercase tracking-widest text-center sticky top-0 bg-slate-50 dark:bg-slate-800/50">Tier</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-50 dark:divide-slate-800/50">
            {sortedItems.map((item) => {
              const varianceRow = varianceData?.rows.find(r => r.linen_item_id === item.linen_item_id);
              
              return (
                <tr key={item.linen_item_id} className="hover:bg-slate-50 dark:hover:bg-slate-800/40 transition-colors group">
                  <td className="p-4 text-xs font-bold text-slate-400 text-center">{item.item_number}</td>
                  <td className="p-4">
                    <p className="font-bold text-slate-700 dark:text-slate-200 text-sm">{item.name_th}</p>
                    <p className="text-[10px] text-slate-400 dark:text-slate-500 uppercase tracking-tight">{item.name_en}</p>
                  </td>
                  <td className="p-4 text-right text-sm font-medium text-slate-600 dark:text-slate-400">
                    {item.rate}
                  </td>
                  <td className="p-4 text-center text-sm font-bold text-slate-800 dark:text-slate-200">
                    {formatNumber(item.qty_sent)}
                  </td>
                  <td className="p-4 text-center text-sm font-medium text-slate-600 dark:text-slate-400">
                    {formatNumber(item.qty_returned)}
                  </td>
                  <td className="p-4 text-center text-sm">
                    <span className={item.qty_pending > 0 ? "font-bold text-amber-600 dark:text-amber-400" : "text-slate-300 dark:text-slate-700"}>
                      {item.qty_pending || "0"}
                    </span>
                  </td>
                  <td className="p-4 text-right text-sm font-black text-[#1B4038] dark:text-emerald-400">
                    {formatMoney(item.total_baht)}
                  </td>
                  <td className="p-4 text-right text-sm font-medium text-slate-500 dark:text-slate-400">
                    {varianceRow ? formatNumber(varianceRow.expected_qty) : "—"}
                  </td>
                  <td className="p-4 text-center text-xs font-mono font-bold text-slate-600 dark:text-slate-400">
                    {varianceRow?.variance_pct ? `${varianceRow.variance_pct.toFixed(0)}%` : "—"}
                  </td>
                  <td className="p-4 text-center">
                    {varianceRow ? (
                      <StatusBadge status={`variance_${varianceRow.tier}`} />
                    ) : (
                      <StatusBadge status="variance_na" />
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <div className="p-4 bg-slate-50/50 dark:bg-slate-800/30 border-t border-slate-100 dark:border-slate-800">
        <div className="flex flex-wrap items-center gap-6 justify-center">
          <div className="flex items-center gap-2">
            <span className="w-2 h-2 rounded-full bg-emerald-500" />
            <span className="text-[10px] font-bold text-slate-500 uppercase tracking-tight">Normal (90-110%)</span>
          </div>
          <div className="flex items-center gap-2">
            <span className="w-2 h-2 rounded-full bg-amber-400" />
            <span className="text-[10px] font-bold text-slate-500 uppercase tracking-tight">Warning (70-130%)</span>
          </div>
          <div className="flex items-center gap-2">
            <span className="w-2 h-2 rounded-full bg-rose-500" />
            <span className="text-[10px] font-bold text-slate-500 uppercase tracking-tight">Review (&lt;70, &gt;130%)</span>
          </div>
        </div>
      </div>
    </div>
  );
}
