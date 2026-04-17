"use client";

import React from "react";
import { LinenMonthlySummary } from "@/lib/types";

interface ExpenseSummaryProps {
  summary: LinenMonthlySummary;
}

export function ExpenseSummary({ summary }: ExpenseSummaryProps) {
  const formatMoney = (val: number) => {
    return new Intl.NumberFormat("th-TH", {
      style: "currency",
      currency: "THB",
      minimumFractionDigits: 0,
      maximumFractionDigits: 0,
    }).format(val);
  };

  const formatNumber = (val: number) => {
    return new Intl.NumberFormat("th-TH").format(val);
  };

  const totalNewBaht = summary.items.reduce((acc, item) => acc + item.total_baht, 0);
  const totalDayuseBaht = summary.dayuse.reduce((acc, item) => {
    // Dayuse items use the same rate as the main items (lookup by linen_item_id)
    const mainItem = summary.items.find(i => i.linen_item_id === item.linen_item_id);
    const rate = mainItem?.rate || 0;
    return acc + (item.qty * rate);
  }, 0);

  const totalNewPieces = summary.items.reduce((acc, item) => acc + item.qty_returned, 0);
  const totalDayusePieces = summary.dayuse.reduce((acc, item) => acc + item.qty, 0);

  return (
    <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl overflow-hidden shadow-sm">
      <div className="p-4 border-b border-slate-100 dark:border-slate-800 bg-[#1B4038]/5 dark:bg-emerald-500/5">
        <h2 className="text-sm font-bold text-slate-700 dark:text-slate-300 uppercase tracking-wider">Expense Summary</h2>
      </div>
      <div className="p-6">
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
          <div>
            <p className="text-xs font-medium text-slate-500 dark:text-slate-400 mb-1 uppercase tracking-tight">ยอดรวมทั้งหมด</p>
            <div className="flex items-baseline gap-2">
              <span className="text-2xl font-black text-slate-900 dark:text-slate-50">
                {formatNumber(summary.total_pieces)}
              </span>
              <span className="text-sm font-medium text-slate-500">ชิ้น</span>
            </div>
            <p className="text-lg font-bold text-[#1B4038] dark:text-emerald-400 mt-1">
              {formatMoney(summary.total_baht)}
            </p>
          </div>

          <div className="space-y-3">
            <div>
              <p className="text-[10px] font-bold text-slate-400 dark:text-slate-500 uppercase tracking-widest">หมวดหมู่ผ้า</p>
            </div>
            <div className="flex items-center justify-between text-sm">
              <span className="text-slate-600 dark:text-slate-400">ผ้าใหม่</span>
              <span className="font-semibold text-slate-900 dark:text-slate-200">
                {formatNumber(totalNewPieces)} ชิ้น ({formatMoney(totalNewBaht)})
              </span>
            </div>
            <div className="flex items-center justify-between text-sm">
              <span className="text-slate-600 dark:text-slate-400">ผ้าเก่า (Day-use)</span>
              <span className="font-semibold text-slate-900 dark:text-slate-200">
                {formatNumber(totalDayusePieces)} ชิ้น ({formatMoney(totalDayuseBaht)})
              </span>
            </div>
          </div>

          <div className="lg:col-span-2 bg-slate-50 dark:bg-slate-800/50 rounded-xl p-4 border border-slate-100 dark:border-slate-800">
            <p className="text-[10px] font-bold text-slate-400 dark:text-slate-500 uppercase tracking-widest mb-3">Extras / อื่นๆ</p>
            <div className="grid grid-cols-2 gap-4">
              {summary.extras.map((extra, idx) => (
                <div key={idx} className="flex flex-col">
                  <span className="text-xs text-slate-500 dark:text-slate-400">{extra.item_name}</span>
                  <span className="text-base font-bold text-slate-800 dark:text-slate-200">{formatNumber(extra.qty)} ชิ้น</span>
                </div>
              ))}
              {summary.extras.length === 0 && (
                <p className="text-xs text-slate-400 italic">ไม่มีรายการเพิ่มเติม</p>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
