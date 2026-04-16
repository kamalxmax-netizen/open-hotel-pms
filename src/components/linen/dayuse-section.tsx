"use client";

import React from "react";

interface DayUseItem {
    linen_item_id: number;
    name_th: string;
    qty: number;
}

interface DayuseSectionProps {
    accumulatedItems: DayUseItem[];
    towelCount: number;
    threshold: number;
    isOpen: boolean;
    onToggle: () => void;
    // FO inputs
    editedDayuse: Record<number, string>;
    onDayuseChange: (linen_item_id: number, value: string) => void;
}

export function DayuseSection({
    accumulatedItems,
    towelCount,
    threshold,
    isOpen,
    onToggle,
    editedDayuse,
    onDayuseChange
}: DayuseSectionProps) {
    const isReady = towelCount >= threshold;

    return (
        <div className="mt-8 border border-slate-200 dark:border-slate-800 rounded-xl overflow-hidden bg-white dark:bg-slate-900 transition-colors">
            <div 
                className={`p-4 flex items-center justify-between cursor-pointer transition-colors ${isOpen ? 'bg-slate-50 dark:bg-slate-800 border-b border-slate-200 dark:border-slate-700' : 'hover:bg-slate-50 dark:hover:bg-slate-800/50'}`}
                onClick={onToggle}
            >
                <div className="flex items-center gap-3">
                    <div className={`w-8 h-8 rounded-full flex items-center justify-center shrink-0 ${isReady ? 'bg-amber-100 dark:bg-amber-900/50 text-amber-600 dark:text-amber-400' : 'bg-slate-100 dark:bg-slate-800 text-slate-500 dark:text-slate-400'}`}>
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="w-4 h-4">
                            <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4M7 10l5 5 5-5M12 15V3"/>
                        </svg>
                    </div>
                    <div>
                        <h4 className="font-semibold text-slate-800 dark:text-slate-100 flex items-center gap-2">
                            <span>ผ้าเก่า (Day Use)</span>
                            {isReady && !isOpen && (
                                <span className="bg-amber-500 text-white text-[10px] px-2 py-0.5 rounded-full font-medium">
                                    พร้อมส่ง {towelCount} ชิ้น
                                </span>
                            )}
                        </h4>
                        <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                            ผ้าขนหนูสะสม {towelCount}/{threshold}
                        </p>
                    </div>
                </div>

                <div className="text-slate-400">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className={`w-5 h-5 transition-transform ${isOpen ? 'rotate-180' : ''}`}>
                        <polyline points="6 9 12 15 18 9"/>
                    </svg>
                </div>
            </div>

            {isOpen && (
                <div className="p-4 bg-slate-50/50 dark:bg-slate-800/20">
                    {accumulatedItems.length === 0 ? (
                        <p className="text-sm text-slate-500 dark:text-slate-400 text-center py-4">ไม่มียอดผ้าเก่าสะสม</p>
                    ) : (
                        <div className="space-y-3">
                            <div className="flex text-xs font-medium text-slate-500 dark:text-slate-400 px-2 pb-1 border-b border-slate-200 dark:border-slate-800">
                                <div className="flex-1">รายการ</div>
                                <div className="w-16 text-center">สะสม</div>
                                <div className="w-20 text-center">ส่งจริง</div>
                            </div>
                            
                            {accumulatedItems.map(item => (
                                <div key={item.linen_item_id} className="flex items-center gap-2">
                                    <div className="flex-1 text-sm text-slate-700 dark:text-slate-300 font-medium pl-2">
                                        {item.name_th}
                                    </div>
                                    <div className="w-16 text-center text-sm text-slate-500 dark:text-slate-400 font-medium">
                                        {item.qty}
                                    </div>
                                    <div className="w-20">
                                        <input
                                            type="number"
                                            min="0"
                                            value={editedDayuse[item.linen_item_id] ?? ""}
                                            onChange={(e) => onDayuseChange(item.linen_item_id, e.target.value)}
                                            className="w-full h-10 bg-white dark:bg-slate-800 border border-slate-300 dark:border-slate-700 rounded-lg text-center font-bold text-slate-800 dark:text-slate-100 transition-all focus:border-[#1B4038] focus:ring-1 focus:ring-[#1B4038] outline-none"
                                            placeholder="..."
                                        />
                                    </div>
                                </div>
                            ))}
                        </div>
                    )}
                </div>
            )}
        </div>
    );
}
