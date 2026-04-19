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
    onSendAll: () => void;
}

export function MobileDayUseSection({
    accumulatedItems,
    towelCount,
    threshold,
    isOpen,
    onToggle,
    editedDayuse,
    onDayuseChange,
    onSendAll
}: MobileDayUseSectionProps) {
    
    const isReady = towelCount >= threshold;
    const sendableCount = accumulatedItems.reduce((sum, item) => sum + Math.max(0, Number(item.qty ?? 0)), 0);
    const selectedCount = accumulatedItems.reduce((sum, item) => sum + Math.max(0, Number(editedDayuse[item.linen_item_id] ?? 0)), 0);
    const hasSendableItems = sendableCount > 0;

    return (
        <div className="mt-8 mb-4">
            <div className="flex items-center gap-4 mb-4">
                <div className="h-px bg-slate-200 flex-1" />
                <span className="text-sm font-semibold text-slate-400 font-thai uppercase tracking-wider">ผ้าเก่า (Day Use)</span>
                <div className="h-px bg-slate-200 flex-1" />
            </div>

            <div
                className={`w-full rounded-3xl border px-5 py-4 text-left shadow-sm active:scale-[0.99] transition-all font-thai ${
                    isReady
                        ? "border-amber-200 bg-amber-50 text-amber-900 dark:border-amber-500/20 dark:bg-amber-500/10 dark:text-amber-200"
                        : "border-slate-200 bg-slate-50 text-slate-700 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-200"
                }`}
            >
                <div className="flex items-start justify-between gap-3">
                    <button type="button" onClick={onToggle} className="min-w-0 flex-1 text-left">
                        <p className="text-base font-black">ผ้าเก่า Day Use</p>
                        <p className="mt-0.5 text-xs font-medium opacity-70">
                            ผ้าขนหนูสะสม {towelCount}/{threshold} ผืน
                        </p>
                        {selectedCount > 0 && (
                            <p className="mt-1 text-xs font-black text-emerald-600 dark:text-emerald-300">
                                เลือกส่งแล้ว {selectedCount} ชิ้น
                            </p>
                        )}
                    </button>
                    <div className="flex items-center gap-2">
                        {isReady && (
                            <span className="rounded-full bg-amber-500 px-2.5 py-1 text-[10px] font-black uppercase tracking-wide text-white">
                                พร้อมส่ง
                            </span>
                        )}
                        <button
                            type="button"
                            onClick={onToggle}
                            className={`grid h-9 w-9 place-items-center rounded-full bg-white/70 text-lg transition-transform dark:bg-white/10 ${isOpen ? "rotate-180" : ""}`}
                            aria-label={isOpen ? "ซ่อนผ้าเก่า" : "ดูผ้าเก่า"}
                        >
                            ⌄
                        </button>
                    </div>
                </div>

                <button
                    type="button"
                    onClick={hasSendableItems ? onSendAll : onToggle}
                    className={`mt-4 w-full rounded-2xl px-4 py-3 text-sm font-black transition-all ${
                        hasSendableItems
                            ? "bg-amber-500 text-white shadow-sm active:scale-[0.99] hover:bg-amber-600"
                            : "bg-slate-200 text-slate-700 active:scale-[0.99] dark:bg-slate-800 dark:text-slate-200"
                    }`}
                >
                    {hasSendableItems ? `ส่งผ้าเก่าเลย ${sendableCount} ชิ้น` : "เปิดกรอกส่งผ้าเก่าเอง"}
                </button>
            </div>

            {isOpen && (
                <div className="space-y-4 animate-in fade-in slide-in-from-top-2 duration-300 mt-4">
                    <div className="p-4 bg-amber-50 dark:bg-amber-500/5 rounded-2xl border border-amber-100 dark:border-amber-500/20 mb-4">
                        <p className="text-xs text-amber-700 dark:text-amber-500 font-thai leading-relaxed">
                            <span className="font-bold">💡 ข้อมูล:</span> ระบบสะสมผ้าเก่าจากการใช้วันนี้ 
                            ผ้าขนหนูสะสมแล้ว <span className="font-black text-sm">{towelCount}</span> / {threshold} ผืน
                        </p>
                    </div>

                    {accumulatedItems.length === 0 ? (
                        <div className="rounded-2xl border border-dashed border-slate-200 bg-white/60 px-4 py-5 text-center text-sm font-bold text-slate-400 dark:border-slate-800 dark:bg-slate-900/60 dark:text-slate-600">
                            ยังไม่มียอดผ้าเก่าสะสม
                        </div>
                    ) : (
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
                    )}
                </div>
            )}
        </div>
    );
}
