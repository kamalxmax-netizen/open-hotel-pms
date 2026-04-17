"use client";

import React, { useState } from "react";
import { format, addMonths, subMonths, startOfMonth } from "date-fns";
import { th } from "date-fns/locale/th";
import { ChevronLeft, ChevronRight, Calendar } from "lucide-react";

interface MonthPickerProps {
  currentDate: Date;
  onChange: (date: Date) => void;
}

export function MonthPicker({ currentDate, onChange }: MonthPickerProps) {
  const [useBuddhistYear, setUseBuddhistYear] = useState(true);

  const handlePrevMonth = () => onChange(subMonths(currentDate, 1));
  const handleNextMonth = () => onChange(addMonths(currentDate, 1));

  const formatYear = (date: Date) => {
    const year = date.getFullYear();
    return useBuddhistYear ? year + 543 : year;
  };

  const monthLabel = format(currentDate, "MMMM", { locale: th });
  const yearLabel = formatYear(currentDate);

  return (
    <div className="flex items-center gap-2 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-1 shadow-sm">
      <button
        onClick={handlePrevMonth}
        className="p-2 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-lg transition-colors text-slate-500 dark:text-slate-400"
      >
        <ChevronLeft size={20} />
      </button>

      <div className="flex items-center gap-2 px-3 min-w-[160px] justify-center">
        <Calendar size={16} className="text-[#1B4038] dark:text-emerald-500" />
        <span className="font-bold text-slate-800 dark:text-slate-100 uppercase tracking-tight">
          {monthLabel} {yearLabel}
        </span>
      </div>

      <button
        onClick={handleNextMonth}
        className="p-2 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-lg transition-colors text-slate-500 dark:text-slate-400"
      >
        <ChevronRight size={20} />
      </button>

      <div className="h-6 w-px bg-slate-200 dark:bg-slate-800 mx-1" />

      <button
        onClick={() => setUseBuddhistYear(!useBuddhistYear)}
        className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-all ${
          useBuddhistYear 
            ? "bg-[#1B4038]/10 text-[#1B4038] dark:bg-emerald-500/20 dark:text-emerald-400" 
            : "text-slate-400 hover:bg-slate-50 dark:hover:bg-slate-800"
        }`}
      >
        {useBuddhistYear ? "พ.ศ." : "ค.ศ."}
      </button>
    </div>
  );
}
