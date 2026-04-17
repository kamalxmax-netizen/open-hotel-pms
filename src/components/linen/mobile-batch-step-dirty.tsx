"use client";

import React, { useState, useMemo, useEffect, useRef } from "react";
import useSWR from "@/hooks/use-simple-swr";
import { useLinenExpected } from "@/hooks/use-linen-batch";
import { useLinenDashboard } from "@/hooks/use-linen-dashboard";
import { apiDataFetcher } from "@/lib/client/api-fetcher";
import { MobileItemRow } from "./mobile-item-row";
import { MobileExtraItemsSheet } from "./mobile-extra-items-sheet";
import { MobileRewashModal } from "./mobile-rewash-modal";
import { MobileDayUseSection } from "./mobile-day-use-section";
import { useRouter } from "next/navigation";
import type { LaundryRewashCreateItem } from "@/lib/types";

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
    onNext: (batchId?: string) => void;
    initialData?: any; // from draft
    batchId?: string | null;
    batchDetail?: any;
}

export function MobileBatchStepDirty({ onNext, initialData, batchId, batchDetail }: MobileBatchStepDirtyProps) {
    const router = useRouter();
    const { expected, isLoading: isExpectedLoading } = useLinenExpected();
    const { dashboard, isLoading: isDashboardLoading } = useLinenDashboard();
    const { data: dayuseData, isLoading: isDayuseLoading } = useSWR("/api/linen/dayuse", dayuseFetcher);

    const [actualData, setActualData] = useState<Record<number, string>>(initialData?.actualData || {});
    const [extraItems, setExtraItems] = useState<{ linen_item_id: number; name_th: string; qty: number }[]>(initialData?.extraItems || []);
    const [rewashItems, setRewashItems] = useState<(any & { name_th: string; preview_url?: string })[]>(initialData?.rewashItems || []);
    const [isDayuseOpen, setIsDayuseOpen] = useState(initialData?.isDayuseOpen || false);
    const [editedDayuse, setEditedDayuse] = useState<Record<number, string>>(initialData?.editedDayuse || {});
    const [isExtraSheetOpen, setIsExtraSheetOpen] = useState(false);
    const [isRewashModalOpen, setIsRewashModalOpen] = useState(false);
    const [isSubmitting, setIsSubmitting] = useState(false);
    const hydratedFromBatchRef = useRef(false);

    const pickupRound = useMemo(() => {
        const draftRound = Number(initialData?.pickupRound ?? initialData?.pickup_round);
        if (Number.isInteger(draftRound) && draftRound > 0) return draftRound;
        const existingRound = Number(batchDetail?.batch?.pickup_round);
        if (Number.isInteger(existingRound) && existingRound > 0) return existingRound;
        if (!expected || !dashboard || dashboard.business_date !== expected.business_date) return 1;
        const maxRound = Math.max(0, ...(dashboard.batches_today ?? []).map((batch) => Number(batch.pickup_round ?? 0)));
        return maxRound + 1;
    }, [batchDetail, dashboard, expected, initialData]);

    useEffect(() => {
        if (!batchDetail?.items || !expected?.items || hydratedFromBatchRef.current || initialData) return;

        const expectedIds = new Set(expected.items.map((item) => Number(item.linen_item_id)));
        const nextActualData: Record<number, string> = {};
        const nextEditedDayuse: Record<number, string> = {};
        const nextExtraItems: { linen_item_id: number; name_th: string; qty: number }[] = [];

        for (const item of batchDetail.items) {
            const itemId = Number(item.linen_item_id);
            const qty = String(Number(item.sent_by_hotel ?? 0));
            if (item.is_dayuse) {
                nextEditedDayuse[itemId] = qty;
                continue;
            }
            if (expectedIds.has(itemId)) {
                nextActualData[itemId] = qty;
            } else {
                nextExtraItems.push({
                    linen_item_id: itemId,
                    name_th: item.name_th ?? `Item ${itemId}`,
                    qty: Number(item.sent_by_hotel ?? 0),
                });
            }
        }

        setActualData(nextActualData);
        setEditedDayuse(nextEditedDayuse);
        setExtraItems(nextExtraItems);
        setIsDayuseOpen(Object.keys(nextEditedDayuse).length > 0);
        hydratedFromBatchRef.current = true;
    }, [batchDetail, expected, initialData]);

    // Save draft to localStorage
    const handleSaveDraft = () => {
        if (!expected) return;
        const draftKey = `linen_draft_${expected.business_date}_${pickupRound}`;
        const draftData = {
            actualData,
            extraItems,
            rewashItems,
            isDayuseOpen,
            editedDayuse,
            pickupRound,
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

    const handleAddRewash = (item: any) => {
        setRewashItems(prev => [...prev, item]);
    };

    const handleRemoveRewash = (idx: number) => {
        setRewashItems(prev => prev.filter((_, i) => i !== idx));
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
                pickup_round: pickupRound,
                items: itemsToSubmit,
                rewash_items: rewashItems.map(({ name_th, preview_url, ...rest }) => rest),
            };

            const res = await fetch(batchId ? `/api/linen/batches/${batchId}` : "/api/linen/batches", {
                method: batchId ? "PATCH" : "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(payload),
            });

            const result = await res.json().catch(() => null);
            if (!res.ok) {
                throw new Error(result?.error || "Failed to create batch");
            }

            // Clear draft on success
            localStorage.removeItem(`linen_draft_${expected.business_date}_${pickupRound}`);

            onNext(batchId ? undefined : result.data.batch.id);
        } catch (error) {
            console.error(error);
            const message = error instanceof Error ? error.message : "Unknown error";
            alert(`เกิดข้อผิดพลาดในการบันทึก: ${message}`);
        } finally {
            setIsSubmitting(false);
        }
    };

    if (isExpectedLoading || isDashboardLoading || isDayuseLoading) {
        return <div className="py-20 text-center text-slate-400 animate-pulse font-thai">กำลังโหลดข้อมูล...</div>;
    }

    if (!expected) return <div className="p-8 text-center text-rose-500 font-thai">ไม่พบข้อมูล Expected</div>;

    return (
        <div className="flex flex-col h-full bg-white rounded-3xl shadow-lg border border-slate-100 overflow-hidden mb-24">
            <div className="p-5 border-b border-slate-100 bg-slate-50 flex justify-between items-center">
                <div>
                    <h2 className="text-2xl font-bold text-slate-900 font-thai">1. นับผ้าส่งซัก</h2>
                    <p className="text-sm text-slate-500 font-thai">วันที่ {expected.business_date} รอบ {pickupRound}</p>
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

                    <div className="flex gap-2">
                        <button
                            type="button"
                            onClick={() => setIsExtraSheetOpen(true)}
                            className="flex-1 mt-6 py-4 border-2 border-dashed border-slate-200 rounded-2xl text-slate-500 font-bold flex items-center justify-center gap-2 active:bg-slate-50 transition-all font-thai"
                        >
                            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" className="w-5 h-5"><path d="M12 5v14M5 12h14" /></svg>
                            เพิ่มรายการพิเศษ
                        </button>

                        <button
                            type="button"
                            onClick={() => setIsRewashModalOpen(true)}
                            className="flex-1 mt-6 py-4 border-2 border-dashed border-purple-200 bg-purple-50/30 rounded-2xl text-purple-600 font-bold flex items-center justify-center gap-2 active:bg-purple-50 transition-all font-thai"
                        >
                            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" className="w-5 h-5"><path d="M12 5v14M5 12h14" /></svg>
                            เพิ่มผ้าซักใหม่
                        </button>
                    </div>

                    {/* Rewash Items List */}
                    {rewashItems.length > 0 && (
                        <div className="pt-6">
                            <h3 className="text-xs font-bold text-purple-400 uppercase tracking-widest mb-4">ผ้าซักใหม่ (Rewash)</h3>
                            <div className="space-y-3">
                                {rewashItems.map((item, idx) => (
                                    <div key={idx} className="bg-purple-50 border border-purple-100 rounded-2xl p-4 flex items-center justify-between">
                                        <div className="flex items-center gap-3">
                                            <div className="w-10 h-10 rounded-lg bg-white border border-purple-200 flex items-center justify-center overflow-hidden">
                                                {item.preview_url ? (
                                                    <img src={item.preview_url} alt="Proof" className="w-full h-full object-cover" />
                                                ) : (
                                                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="w-5 h-5 text-purple-300"><path d="M12 5v14M5 12h14"/></svg>
                                                )}
                                            </div>
                                            <div>
                                                <p className="font-bold text-purple-900 font-thai">{item.name_th}</p>
                                                <p className="text-xs text-purple-500 font-thai">จำนวน: {item.qty} ชิ้น {item.is_dayuse && " (Day Use)"}</p>
                                            </div>
                                        </div>
                                        <button 
                                            onClick={() => handleRemoveRewash(idx)}
                                            className="text-xs text-rose-500 font-bold"
                                        >
                                            ลบ
                                        </button>
                                    </div>
                                ))}
                            </div>
                        </div>
                    )}

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
                    {isSubmitting ? <div className="w-5 h-5 border-2 border-white/30 border-t-white rounded-full animate-spin" /> : <>ถัดไป <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" className="w-5 h-5"><path d="M5 12h14M12 5l7 7-7 7" /></svg></>}
                </button>
            </div>

            <MobileExtraItemsSheet
                isOpen={isExtraSheetOpen}
                onClose={() => setIsExtraSheetOpen(false)}
                onAdd={handleExtraAdd}
                existingItemIds={[
                    ...expected.items.map((item) => item.linen_item_id),
                    ...extraItems.map((item) => item.linen_item_id),
                ]}
            />

            <MobileRewashModal
                isOpen={isRewashModalOpen}
                onClose={() => setIsRewashModalOpen(false)}
                onAdd={handleAddRewash}
                batchId={batchId || undefined}
            />
        </div>
    );
}
