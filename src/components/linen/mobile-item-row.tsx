"use client";

import React from "react";

interface MobileItemRowProps {
    label: string;
    subLabel?: string;
    value: string;
    onChange: (val: string) => void;
    min?: number;
    max?: number;
    placeholder?: string;
}

export function MobileItemRow({ 
    label, 
    subLabel, 
    value, 
    onChange, 
    min = 0, 
    max = 9999,
    placeholder = "0"
}: MobileItemRowProps) {
    
    const handleIncrement = () => {
        const current = parseInt(value || "0", 10);
        if (current < max) onChange(String(current + 1));
    };

    const handleDecrement = () => {
        const current = parseInt(value || "0", 10);
        if (current > min) onChange(String(current - 1));
    };

    const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        const val = e.target.value;
        if (val === "") {
            onChange("");
            return;
        }
        const num = parseInt(val, 10);
        if (!isNaN(num) && num >= min && num <= max) {
            onChange(String(num));
        }
    };

    return (
        <div className="flex items-center gap-4 py-4 px-2 border-b border-slate-100 dark:border-slate-800/50 last:border-0 group">
            <div className="flex-1">
                <label className="text-base font-bold text-slate-800 dark:text-slate-200 font-thai block mb-0.5 group-active:text-[#1B4038] dark:group-active:text-emerald-400 transition-colors">
                    {label}
                </label>
                {subLabel && <p className="text-xs text-slate-400 dark:text-slate-500 font-thai font-medium">{subLabel}</p>}
            </div>
            
            <div className="flex items-center gap-1 bg-slate-50 dark:bg-slate-800/50 p-1.5 rounded-2xl border border-slate-200/50 dark:border-slate-700/50">
                <button
                    type="button"
                    onClick={handleDecrement}
                    className="w-10 h-10 flex items-center justify-center rounded-xl bg-white dark:bg-slate-700 text-slate-600 dark:text-slate-300 shadow-sm active:scale-90 active:bg-slate-100 dark:active:bg-slate-600 transition-all border border-slate-100 dark:border-slate-600"
                >
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" className="w-5 h-5"><path d="M5 12h14"/></svg>
                </button>
                
                <input
                    type="number"
                    inputMode="numeric"
                    pattern="[0-9]*"
                    value={value}
                    placeholder={placeholder}
                    onChange={handleInputChange}
                    className="w-14 text-center bg-transparent border-0 focus:ring-0 text-xl font-black text-[#1B4038] dark:text-emerald-400 placeholder:text-slate-300 dark:placeholder:text-slate-700"
                />

                <button
                    type="button"
                    onClick={handleIncrement}
                    className="w-10 h-10 flex items-center justify-center rounded-xl bg-[#1B4038] text-white shadow-md active:scale-90 active:bg-[#122b26] transition-all"
                >
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" className="w-5 h-5"><path d="M12 5v14M5 12h14"/></svg>
                </button>
            </div>
        </div>
    );
}
