"use client";

import React from "react";
import { LinenMonthlyVariance } from "@/lib/types";
import { StatusBadge } from "@/components/linen/status-badge";

interface VarianceSectionProps {
  varianceData?: LinenMonthlyVariance;
}

export function VarianceSection({ varianceData }: VarianceSectionProps) {
  if (!varianceData) return null;

  const stats = {
    green: varianceData.rows.filter(r => r.tier === "green").length,
    yellow: varianceData.rows.filter(r => r.tier === "yellow").length,
    red: varianceData.rows.filter(r => r.tier === "red").length,
    na: varianceData.rows.filter(r => r.tier === "na").length,
  };

  return (
    <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
      <div className="bg-white dark:bg-slate-900 p-4 rounded-xl border border-slate-200 dark:border-slate-800 shadow-sm flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-full bg-emerald-100 dark:bg-emerald-950/30 flex items-center justify-center">
            <span className="w-3 h-3 rounded-full bg-emerald-500 shadow-[0_0_8px_rgba(16,185,129,0.5)]" />
          </div>
          <div>
            <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">Normal</p>
            <p className="text-xl font-black text-slate-800 dark:text-slate-100">{stats.green} รายการ</p>
          </div>
        </div>
        <StatusBadge status="variance_green" />
      </div>

      <div className="bg-white dark:bg-slate-900 p-4 rounded-xl border border-slate-200 dark:border-slate-800 shadow-sm flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-full bg-amber-100 dark:bg-amber-950/30 flex items-center justify-center">
            <span className="w-3 h-3 rounded-full bg-amber-400 shadow-[0_0_8px_rgba(251,191,36,0.5)]" />
          </div>
          <div>
            <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">Warning</p>
            <p className="text-xl font-black text-slate-800 dark:text-slate-100">{stats.yellow} รายการ</p>
          </div>
        </div>
        <StatusBadge status="variance_yellow" />
      </div>

      <div className="bg-white dark:bg-slate-900 p-4 rounded-xl border border-slate-200 dark:border-slate-800 shadow-sm flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-full bg-rose-100 dark:bg-rose-950/30 flex items-center justify-center">
            <span className="w-3 h-3 rounded-full bg-rose-500 shadow-[0_0_8px_rgba(244,63,94,0.5)]" />
          </div>
          <div>
            <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">Review</p>
            <p className="text-xl font-black text-slate-800 dark:text-slate-100">{stats.red} รายการ</p>
          </div>
        </div>
        <StatusBadge status="variance_red" />
      </div>
    </div>
  );
}
