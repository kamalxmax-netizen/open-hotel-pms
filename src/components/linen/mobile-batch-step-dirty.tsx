"use client";

import React, { useState, useMemo, useEffect } from "react";
import useSWR from "@/hooks/use-simple-swr";
import { useLinenExpected } from "@/hooks/use-linen-batch";
import { apiDataFetcher } from "@/lib/client/api-fetcher";
import { MobileItemRow } from "./mobile-item-row";
import { MobileExtraItemsSheet } from "./mobile-extra-items-sheet";
import { MobileDayUseSection } from "./mobile-day-use-section";
import { useRouter } from "next/navigation";

type DayuseApiData = {
    items: { linen_item_id: number; name_th?: string; qty_accumulated?: number }[];
    dayuse_towel_count: number;
    dayuse_threshold: number;
};

const dayuseFetcher = async (url: string) => {
    const data = await apiDataFetcher<DayuseApiData>(url);
    return {
        accumulated: (data.items ?? []).map(item => ({
            linen_item_id: item.linen_item_id,
            name_th: item.name_th ?? `Item ${item.linen_item_id}`,
            qty: Number(item.qty_accumulated ?? 0),
        })),
        towel_count: Number(data.dayuse_towel_count ?? 0),
        threshold: Number(data.dayuse_threshold ?? 30),
    };
};

interface MobileBatchStepDirtyProps {
    onNext: (batchId: string) => void;
    initialData?: any; // from draft
}

export function MobileBatchStepDirty({ onNext, initialData }: MobileBatchStepDirtyProps) {
    const router = useRouter();
    const { expected, isLoading: isExpectedLoading } = useLinenExpected();
    const { data: dayuseData, isLoading: isDayuseLoading } = useSWR("/api/linen/dayuse", dayuseFetcher);

    const [actualData, setActualData] = useState<Record<number, string>>(initialData?.actualData || {});
    const [extraItems, setExtraItems] = useState<{ linen_item_id: number; name_th: string; qty: number }[]>(initialData?.extraItems || []);
    const [isDayuseOpen, setIsDayuseOpen] = useState(initialData?.isDayuseOpen || false);
    const [editedDayuse, setEditedDayuse] = useState<Record<number, string>>(initialData?.editedDayuse || {});
    const [isExtraSheetOpen, setIsExtraSheetOpen] = useState(false);
    const [isSubmitting, setIsSubmitting] = useState(false);

    // Save draft to localStorage
    const handleSaveDraft = () => {
        if (!expected) return;
        const draftKey = `linen_draft_${expected.business_date}_1`;
        const draftData = {
            actualData,
            extraItems,
            isDayuseOpen,
            editedDayuse,
            timestamp: Date.now()
        };
        localStorage.setItem(draftKey, JSON.stringify(draftData));
        alert("บันทึกร่างเรียบร้อยแล้ว");
        router.push("/linen-mobile");
    };

    const handleActualChange = (id: number, val: string) => {
        setActualData(prev => ({ ...prev, [id]: val }));
    };

    const handleExtraAdd = (newItems: { linen_item_id: number; name_th: string; qty: number }[]) => {
        setExtraItems(prev => {
            const next = [...prev];
            for (const item of newItems) {
                const existingIdx = next.findIndex(i => i.linen_item_id === item.linen_item_id);
                if (existingIdx >= 0) {
                    next[existingIdx].qty += item.qty;
                } else {
                    next.push(item);
                }
            }
            return next;
        });
    };

    const handleRemoveExtra = (id: number) => {
        setExtraItems(prev => prev.filter(i => i.linen_item_id !== id));
    };

    const isComplete = useMemo(() => {
        if (!expected?.items) return false;
        // Check if all expected items have a value
        for (const item of expected.items) {
            if (actualData[item.linen_item_id] === undefined || actualData[item.linen_item_id] === "") return false;
        }
        return true;
    }, [expected, actualData]);

    const handleSubmit = async () => {
        if (!isComplete || !expected) return;
        setIsSubmitting(true);
        try {
            const itemsToSubmit = expected.items.map(item => ({
                linen_item_id: item.linen_item_id,
                is_dayuse: false,
                estimated_qty: item.estimated_qty,
                sent_by_hotel: parseInt(actualData[item.linen_item_id] || "0", 10),
            }));

            // Add extra items
            for (const extra of extraItems) {
                itemsToSubmit.push({
                    linen_item_id: extra.linen_item_id,
                    is_dayuse: false,
                    estimated_qty: 0,
                    sent_by_hotel: extra.qty
                });
            }

            // Include dayuse if any
            if (dayuseData?.accumulated) {
                for (const du of dayuseData.accumulated) {
                    const sentStr = editedDayuse[du.linen_item_id];
                    if (sentStr && parseInt(sentStr, 10) > 0) {
                        itemsToSubmit.push({
                            linen_item_id: du.linen_item_id,
                            is_dayuse: true,
                            estimated_qty: du.qty,
                            sent_by_hotel: parseInt(sentStr, 10),
                        });
                    }
                }
            }

            const payload = {
                business_date: expected.business_date,
                pickup_round: 1,
                items: itemsToSubmit,
            };

            const res = await fetch("/api/linen/batches", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(payload),
            });

            if (!res.ok) throw new Error("Failed to create batch");

            const result = await res.json();
            
            // Clear draft on success
            localStorage.removeItem(`linen_draft_${expected.business_date}_1`);
            
            onNext(result.data.batch.id);
        } catch (error) {
            console.error(error);
            alert("เกิดข้อผิดพลาดในการบันทึก กรุณาลองใหม่");
        } finally {
            setIsSubmitting(false);
        }
    };

    if (isExpectedLoading || isDayuseLoading) {
        return <div className="py-20 text-center text-slate-400 animate-pulse font-thai">กำลังโหลดข้อมูล...</div>;
    }

    if (!expected) return <div className="p-8 text-center text-rose-500 font-thai">ไม่พบข้อมูล Expected</div>;

    return (
        <div className="flex flex-col h-full bg-white rounded-3xl shadow-lg border border-slate-100 overflow-hidden mb-24">
            <div className="p-5 border-b border-slate-100 bg-slate-50 flex justify-between items-center">
                <div>
                    <h2 className="text-xl font-bold text-slate-900 font-thai">1. นับผ้าส่งซัก</h2>
                    <p className="text-sm text-slate-500 font-thai">วันที่ {expected.business_date} รอบ 1</p>
                </div>
            </div>

            <div className="flex-1 overflow-y-auto p-5">
                <div className="space-y-2">
                    {expected.items.map(item => (
                        <MobileItemRow
                            key={item.linen_item_id}
                            label={item.name_th}
                            subLabel={`ประมาณ: ${item.estimated_qty}`}
                            value={actualData[item.linen_item_id] ?? ""}
                            onChange={(val) => handleActualChange(item.linen_item_id, val)}
                            placeholder="..."
                        />
                    ))}

                    {/* Extra Items List */}
                    {extraItems.length > 0 && (
                        <div className="pt-6">
                            <h3 className="text-xs font-bold text-slate-400 uppercase tracking-widest mb-4">รายการพิเศษ</h3>
                            <div className="space-y-4">
                                {extraItems.map(item => (
                                    <div key={item.linen_item_id} className="relative">
                                        <MobileItemRow
                                            label={item.name_th}
                                            value={String(item.qty)}
                                            onChange={(val) => {
                                                const num = parseInt(val, 10);
                                                setExtraItems(prev => prev.map(i => i.linen_item_id === item.linen_item_id ? { ...i, qty: isNaN(num) ? 0 : num } : i));
                                            }}
                                        />
                                        <button 
                                            onClick={() => handleRemoveExtra(item.linen_item_id)}
                                            className="absolute -top-1 right-0 text-xs text-rose-500 font-bold px-2 py-1"
                                        >
                                            ลบ
                                        </button>
                                    </div>
                                ))}
                            </div>
                        </div>
                    )}

                    <button
                        type="button"
                        onClick={() => setIsExtraSheetOpen(true)}
                        className="w-full mt-6 py-4 border-2 border-dashed border-slate-200 rounded-2xl text-slate-500 font-bold flex items-center justify-center gap-2 active:bg-slate-50 transition-all font-thai"
                    >
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" className="w-5 h-5"><path d="M12 5v14M5 12h14"/></svg>
                        เพิ่มรายการพิเศษ
                    </button>

                    <MobileDayUseSection
                        accumulatedItems={dayuseData?.accumulated || []}
                        towelCount={dayuseData?.towel_count || 0}
                        threshold={dayuseData?.threshold || 30}
                        isOpen={isDayuseOpen}
                        onToggle={() => setIsDayuseOpen(!isDayuseOpen)}
                        editedDayuse={editedDayuse}
                        onDayuseChange={(id, val) => setEditedDayuse(prev => ({ ...prev, [id]: val }))}
                    />
                </div>
            </div>

            <div className="p-5 bg-white border-t border-slate-100 flex gap-3 shadow-[0_-5px_20px_rgba(0,0,0,0.03)] fixed bottom-0 left-0 right-0 max-w-lg mx-auto z-40">
                <button
                    type="button"
                    onClick={handleSaveDraft}
                    className="flex-1 py-4 bg-slate-100 text-slate-700 font-bold rounded-2xl active:scale-95 transition-all text-base border border-slate-200 font-thai flex items-center justify-center gap-2"
                >
                    💾 บันทึกร่าง
                </button>
                <button
                    type="button"
                    onClick={handleSubmit}
                    disabled={!isComplete || isSubmitting}
                    className={`flex-[1.5] py-4 rounded-2xl font-bold text-white transition-all shadow-lg text-base flex justify-center items-center gap-2
                        ${isComplete && !isSubmitting 
                            ? 'bg-[#1B4038] active:scale-95' 
                            : 'bg-slate-300 cursor-not-allowed shadow-none'}`}
                >
                    {isSubmitting ? <div className="w-5 h-5 border-2 border-white/30 border-t-white rounded-full animate-spin" /> : <>ถัดไป <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" className="w-5 h-5"><path d="M5 12h14M12 5l7 7-7 7"/></svg></>}
                </button>
            </div>

            <MobileExtraItemsSheet 
                isOpen={isExtraSheetOpen}
                onClose={() => setIsExtraSheetOpen(false)}
                onAdd={handleExtraAdd}
                existingItemIds={[]}
            />
        </div>
    );
}
