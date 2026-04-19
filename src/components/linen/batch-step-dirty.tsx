"use client";

import React, { useState, useMemo } from "react";
import useSWR from "@/hooks/use-simple-swr";
import { useLinenExpected } from "@/hooks/use-linen-batch";
import { DayuseSection } from "./dayuse-section";
import { apiDataFetcher } from "@/lib/client/api-fetcher";

type DayuseApiData = {
    items: { linen_item_id: number; name_th?: string; qty_accumulated?: number }[];
    dayuse_towel_count: number;
    dayuse_threshold: number;
};

type DayuseViewData = {
    accumulated: { linen_item_id: number; name_th: string; qty: number }[];
    towel_count: number;
    threshold: number;
};

const dayuseFetcher = async (url: string): Promise<DayuseViewData> => {
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

function toPositiveInteger(value: unknown) {
    const parsed = Number.parseInt(String(value ?? ""), 10);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : 0;
}

function isFullDayuseSelection(dayuseData: DayuseViewData | undefined, editedDayuse: Record<number, string>) {
    const accumulated = dayuseData?.accumulated ?? [];
    const sendable = accumulated.filter((item) => Number(item.qty ?? 0) > 0);
    if (sendable.length === 0) return false;
    return sendable.every((item) => toPositiveInteger(editedDayuse[item.linen_item_id]) === Number(item.qty ?? 0));
}

interface BatchStepDirtyProps {
    onNext: (batchId: string) => void;
}

export function BatchStepDirty({ onNext }: BatchStepDirtyProps) {
    const { expected, isLoading: isExpectedLoading, isError: expectedError } = useLinenExpected();
    const { data: dayuseData, error: dayuseError, isLoading: isDayuseLoading } = useSWR<DayuseViewData>("/api/linen/dayuse", dayuseFetcher);

    const [actualData, setActualData] = useState<Record<number, string>>({});
    const [isDayuseOpen, setIsDayuseOpen] = useState(false);
    const [editedDayuse, setEditedDayuse] = useState<Record<number, string>>({});
    const [isSubmitting, setIsSubmitting] = useState(false);

    const isComplete = useMemo(() => {
        if (!expected?.items) return false;
        // All expected items must have actual value filled
        for (const item of expected.items) {
           if (actualData[item.linen_item_id] === undefined || actualData[item.linen_item_id] === "") {
               return false;
           }
        }
        return true;
    }, [expected, actualData]);

    const handleActualChange = (id: number, val: string) => {
        setActualData(prev => ({ ...prev, [id]: val }));
    };

    const handleDayuseChange = (id: number, val: string) => {
        setEditedDayuse(prev => ({ ...prev, [id]: val }));
    };

    const handleSendAllDayuse = () => {
        const accumulated = dayuseData?.accumulated ?? [];
        const sendable = accumulated.filter((item) => Number(item.qty ?? 0) > 0);
        setIsDayuseOpen(true);
        if (sendable.length === 0) return;

        setEditedDayuse(prev => {
            const next = { ...prev };
            for (const item of sendable) {
                next[item.linen_item_id] = String(Number(item.qty ?? 0));
            }
            return next;
        });
    };

    const handleSubmit = async () => {
        if (!isComplete || !expected) return;
        const shouldClearDayuseAccumulator = isFullDayuseSelection(dayuseData, editedDayuse);
        setIsSubmitting(true);
        try {
            const itemsToSubmit = expected.items.map(item => ({
                linen_item_id: item.linen_item_id,
                is_dayuse: false,
                estimated_qty: item.estimated_qty,
                sent_by_hotel: parseInt(actualData[item.linen_item_id] || "0", 10),
            }));

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
                pickup_round: 1, // backend will auto-increment round if needed or use 1
                items: itemsToSubmit,
            };

            const res = await fetch("/api/linen/batches", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(payload),
            });

            if (!res.ok) {
                throw new Error("Failed to create batch");
            }

            const result = await res.json();
            const submittedBatchId = result?.data?.batch?.id;
            if (shouldClearDayuseAccumulator && submittedBatchId) {
                const dayuseRes = await fetch("/api/linen/dayuse", {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ action: "add_to_batch", batch_id: submittedBatchId }),
                });
                const dayuseResult = await dayuseRes.json().catch(() => null);
                if (!dayuseRes.ok) {
                    throw new Error(dayuseResult?.error || "Failed to send accumulated dayuse linen");
                }
            }
            onNext(result.data.batch.id);
        } catch (error) {
            console.error(error);
            alert("เกิดข้อผิดพลาดในการบันทึก กรุณาลองใหม่");
        } finally {
            setIsSubmitting(false);
        }
    };

    if (isExpectedLoading || isDayuseLoading) {
        return <div className="p-8 text-center text-slate-500 dark:text-slate-400 animate-pulse bg-white dark:bg-slate-900 rounded-xl border border-slate-200 dark:border-slate-800">กำลังโหลดข้อมูล...</div>;
    }

    if (!expected) {
        const message = expectedError?.message ?? dayuseError?.message ?? "ไม่สามารถโหลดข้อมูล Expected ได้";
        return <div className="p-8 text-center text-rose-500 dark:text-rose-400 bg-white dark:bg-slate-900 rounded-xl border border-rose-200 dark:border-rose-900/30">{message}</div>;
    }

    return (
        <div className="w-full">
            <div className="bg-white dark:bg-slate-900 rounded-t-xl rounded-b sm:rounded-xl border border-slate-200 dark:border-slate-800 overflow-hidden shadow-sm transition-colors">
                <div className="p-4 border-b border-slate-100 dark:border-slate-800 bg-slate-50 dark:bg-slate-800/50 flex items-center justify-between">
                    <div>
                        <h3 className="font-semibold text-slate-800 dark:text-slate-100 text-lg flex items-center gap-2">
                            <span>📝 นับผ้าส่งซัก</span>
                            <span className="text-[10px] px-2 py-0.5 rounded-full bg-slate-200 dark:bg-slate-700 text-slate-600 dark:text-slate-300 font-bold uppercase">Step 1/4</span>
                        </h3>
                    </div>
                </div>

                <div className="p-4 bg-white dark:bg-slate-900">
                    <div className="flex text-[10px] font-bold text-slate-400 dark:text-slate-500 px-2 pb-2 mb-2 border-b border-slate-100 dark:border-slate-800 uppercase tracking-widest">
                        <div className="flex-1">รายการ</div>
                        <div className="w-16 text-center">ประมาณ</div>
                        <div className="w-20 text-center">ส่งจริง</div>
                    </div>

                    <div className="space-y-3">
                        {expected.items.map(item => (
                            <div key={item.linen_item_id} className="flex items-center gap-2">
                                <div className="flex-1 text-sm font-medium text-slate-700 dark:text-slate-300 pl-2">
                                    {item.name_th}
                                </div>
                                <div className="w-16 text-center text-sm font-medium text-slate-400 dark:text-slate-500 bg-slate-50 dark:bg-slate-800/50 py-1.5 rounded-md">
                                    {item.estimated_qty}
                                </div>
                                <div className="w-20">
                                    <input
                                        type="number"
                                        min="0"
                                        value={actualData[item.linen_item_id] ?? ""}
                                        onChange={(e) => handleActualChange(item.linen_item_id, e.target.value)}
                                        className="w-full h-11 bg-white dark:bg-slate-800 border-2 border-slate-200 dark:border-slate-700 rounded-lg text-center font-bold text-slate-800 dark:text-slate-100 text-lg transition-all focus:border-[#1B4038] focus:ring-4 focus:ring-[#1B4038]/10 outline-none"
                                        placeholder="..."
                                    />
                                </div>
                            </div>
                        ))}
                    </div>

                    {dayuseData && !isDayuseOpen && (
                        <div className="mt-4 flex justify-center gap-2">
                            <button
                                type="button"
                                onClick={() => setIsDayuseOpen(true)}
                                className="text-sm font-semibold text-amber-600 dark:text-amber-400 border border-amber-200 dark:border-amber-900 bg-amber-50 dark:bg-amber-950/20 px-4 py-2 rounded-lg hover:bg-amber-100 dark:hover:bg-amber-900 transition-colors inline-flex items-center gap-2"
                            >
                                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="w-4 h-4"><path d="M12 5v14M5 12h14"/></svg>
                                ส่งผ้าเก่า {dayuseData.towel_count >= dayuseData.threshold && <span className="bg-rose-500 text-white text-[10px] px-1.5 py-0.5 rounded-full ml-1">{dayuseData.towel_count}</span>}
                            </button>
                            <button
                                type="button"
                                onClick={handleSendAllDayuse}
                                disabled={!dayuseData.accumulated.some((item) => Number(item.qty ?? 0) > 0)}
                                className="text-sm font-black text-white border border-amber-500 bg-amber-500 px-4 py-2 rounded-lg hover:bg-amber-600 disabled:cursor-not-allowed disabled:border-slate-200 disabled:bg-slate-200 disabled:text-slate-400 dark:disabled:border-slate-800 dark:disabled:bg-slate-800 dark:disabled:text-slate-600 transition-colors inline-flex items-center gap-2"
                            >
                                ส่งทั้งหมด
                            </button>
                        </div>
                    )}

                    {dayuseData && isDayuseOpen && (
                        <DayuseSection 
                            accumulatedItems={dayuseData.accumulated}
                            towelCount={dayuseData.towel_count}
                            threshold={dayuseData.threshold}
                            isOpen={isDayuseOpen}
                            onToggle={() => setIsDayuseOpen(!isDayuseOpen)}
                            editedDayuse={editedDayuse}
                            onDayuseChange={handleDayuseChange}
                            onSendAll={handleSendAllDayuse}
                        />
                    )}
                </div>

                <div className="p-4 bg-slate-50 dark:bg-slate-800/50 border-t border-slate-100 dark:border-slate-800">
                    <button
                        type="button"
                        onClick={handleSubmit}
                        disabled={!isComplete || isSubmitting}
                        className={`w-full py-3.5 rounded-xl font-bold text-white transition-all shadow-sm flex justify-center items-center gap-2
                            ${isComplete && !isSubmitting 
                                ? 'bg-[#1B4038] hover:bg-[#122b26]' 
                                : 'bg-slate-300 dark:bg-slate-800 text-slate-500 dark:text-slate-600 cursor-not-allowed shadow-none'}`}
                    >
                        {isSubmitting ? (
                           <div className="w-5 h-5 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                        ) : (
                           <>ถัดไป: นับผ้าคืน <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="w-5 h-5"><path d="M5 12h14M12 5l7 7-7 7"/></svg></>
                        )}
                    </button>
                    {!isComplete && (
                        <p className="text-center text-[10px] text-rose-500 dark:text-rose-400 font-bold mt-3 uppercase tracking-tighter">
                            * กรุณากรอกช่องส่งจริงให้ครบทุกรายการ (ใส่ 0 ได้)
                        </p>
                    )}
                </div>
            </div>
        </div>
    );
}
