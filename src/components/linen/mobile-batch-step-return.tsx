"use client";

import React, { useState, useMemo } from "react";
import { MobileItemRow } from "./mobile-item-row";

interface ReturnItem {
    source_batch_id: string;
    source_business_date: string;
    source_pickup_round: number;
    linen_item_id: number;
    name_th?: string;
    remaining_qty: number;
    is_dayuse: boolean;
}

interface MobileBatchStepReturnProps {
    batchId: string;
    items: any[];
    returnSources: ReturnItem[];
    onNext: () => void;
}

export function MobileBatchStepReturn({ batchId, returnSources, onNext }: MobileBatchStepReturnProps) {
    const [returnQtys, setReturnQtys] = useState<Record<string, string>>({});
    const [isSubmitting, setIsSubmitting] = useState(false);

    const handleQtyChange = (key: string, val: string) => {
        setReturnQtys(prev => ({ ...prev, [key]: val }));
    };

    const handleSubmit = async () => {
        setIsSubmitting(true);
        try {
            const items = returnSources.map(s => {
                const key = `${s.source_batch_id}_${s.linen_item_id}_${s.is_dayuse}`;
                return {
                    source_batch_id: s.source_batch_id,
                    linen_item_id: s.linen_item_id,
                    received_qty: parseInt(returnQtys[key] || "0", 10),
                    is_dayuse: s.is_dayuse,
                };
            });

            const res = await fetch(`/api/linen/batches/${batchId}/step`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    step: "fo_return_counted",
                    return_items: items,
                }),
            });

            if (!res.ok) throw new Error("Failed to submit returns");
            onNext();
        } catch (error) {
            console.error(error);
            alert("เกิดข้อผิดพลาดในการบันทึก");
        } finally {
            setIsSubmitting(false);
        }
    };

    if (returnSources.length === 0) {
        return (
            <div className="flex flex-col h-[400px] justify-center items-center bg-white rounded-3xl p-8 text-center shadow-lg border border-slate-100">
                <div className="w-20 h-20 bg-slate-50 rounded-full flex items-center justify-center text-slate-300 mb-6 border border-slate-100">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" className="w-10 h-10 shadow-sm">
                        <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/>
                    </svg>
                </div>
                <h3 className="text-xl font-bold text-slate-800 font-thai mb-2">ไม่มีผ้ารอรับคืน</h3>
                <p className="text-sm text-slate-500 font-thai mb-8">ข้ามขั้นตอนนี้เพื่อไปหน้าถัดไป</p>
                <button
                    onClick={onNext}
                    className="w-full py-4 bg-[#1B4038] text-white font-bold rounded-2xl shadow-lg active:scale-95 transition-all"
                >
                    ถัดไป
                </button>
            </div>
        );
    }

    return (
        <div className="flex flex-col h-full bg-white rounded-3xl shadow-lg border border-slate-100 overflow-hidden mb-24">
            <div className="p-5 border-b border-slate-100 bg-slate-50 flex justify-between items-center">
                <div>
                    <h2 className="text-xl font-bold text-slate-900 font-thai">2. นับผ้ารับคืน</h2>
                    <p className="text-sm text-slate-500 font-thai">รับคืนจากร้านซักรีด</p>
                </div>
            </div>

            <div className="flex-1 overflow-y-auto p-5">
                <div className="space-y-4">
                    {returnSources.map(s => {
                        const key = `${s.source_batch_id}_${s.linen_item_id}_${s.is_dayuse}`;
                        return (
                            <div key={key}>
                                <div className="flex items-center gap-2 mb-2">
                                    <div className="w-1 bg-amber-400 h-4 rounded-full" />
                                    <span className="text-xs font-bold text-amber-600 uppercase tracking-widest">
                                        คืนจาก {s.source_business_date} รอบ {s.source_pickup_round}
                                    </span>
                                </div>
                                <MobileItemRow
                                    label={`${s.name_th ?? `Item ${s.linen_item_id}`}${s.is_dayuse ? ' (Day Use)' : ''}`}
                                    subLabel={`ส่งไป: ${s.remaining_qty}`}
                                    value={returnQtys[key] ?? ""}
                                    onChange={(val) => handleQtyChange(key, val)}
                                    max={s.remaining_qty}
                                    placeholder={String(s.remaining_qty)}
                                />
                            </div>
                        );
                    })}
                </div>
            </div>

            <div className="p-5 bg-white border-t border-slate-100 fixed bottom-0 left-0 right-0 max-w-lg mx-auto z-40 shadow-[0_-5px_20px_rgba(0,0,0,0.03)]">
                <button
                    type="button"
                    onClick={handleSubmit}
                    disabled={isSubmitting}
                    className="w-full py-4 bg-[#1B4038] text-white font-bold rounded-2xl shadow-lg active:scale-95 transition-all text-base flex justify-center items-center gap-2"
                >
                    {isSubmitting ? <div className="w-5 h-5 border-2 border-white/30 border-t-white rounded-full animate-spin" /> : <>ถัดไป <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" className="w-5 h-5"><path d="M5 12h14M12 5l7 7-7 7"/></svg></>}
                </button>
            </div>
        </div>
    );
}
