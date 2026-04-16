"use client";

import React from "react";
import { MobileItemRow } from "./mobile-item-row";

interface MobileDayUseSectionProps {
    accumulatedItems: { linen_item_id: number; name_th: string; qty: number }[];
    towelCount: number;
    threshold: number;
    isOpen: boolean;
    onToggle: () => void;
    editedDayuse: Record<number, string>;
    onDayuseChange: (id: number, val: string) => void;
}

export function MobileDayUseSection({
    accumulatedItems,
    towelCount,
    threshold,
    isOpen,
    onToggle,
    editedDayuse,
    onDayuseChange
}: MobileDayUseSectionProps) {
    
    const showBadge = towelCount >= threshold;

    return (
        <div className="mt-8 mb-4">
            <div className="flex items-center gap-4 mb-4">
                <div className="h-px bg-slate-200 flex-1" />
                <span className="text-sm font-semibold text-slate-400 font-thai uppercase tracking-wider">ผ้าเก่า (Day Use)</span>
                <div className="h-px bg-slate-200 flex-1" />
            </div>

            {isOpen && (
                <div className="space-y-4 animate-in fade-in slide-in-from-top-2 duration-300">
                    <div className="p-4 bg-amber-50 dark:bg-amber-500/5 rounded-2xl border border-amber-100 dark:border-amber-500/20 mb-4">
                        <p className="text-xs text-amber-700 dark:text-amber-500 font-thai leading-relaxed">
                            <span className="font-bold">💡 ข้อมูล:</span> ระบบสะสมผ้าเก่าจากการใช้วันนี้ 
                            ผ้าขนหนูสะสมแล้ว <span className="font-black text-sm">{towelCount}</span> / {threshold} ผืน
                        </p>
                    </div>

                    <div className="space-y-1">
                        {accumulatedItems.map(item => (
                            <MobileItemRow
                                key={item.linen_item_id}
                                label={item.name_th}
                                subLabel={`สะสมแล้ว: ${item.qty}`}
                                value={editedDayuse[item.linen_item_id] ?? ""}
                                onChange={(val) => onDayuseChange(item.linen_item_id, val)}
                                placeholder="0"
                            />
                        ))}
                    </div>
                </div>
            )}
        </div>
    );
}
