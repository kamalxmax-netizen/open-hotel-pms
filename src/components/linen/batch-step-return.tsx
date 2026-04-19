"use client";

import React, { useState, useMemo } from "react";
import useSWR from "@/hooks/use-simple-swr";
import type { LaundryBatchItem, LaundryPendingItem, LaundryReturnSourceItem } from "@/lib/types";
import { apiDataFetcher } from "@/lib/client/api-fetcher";

interface BatchStepReturnProps {
    batchId: string;
    items: LaundryBatchItem[];
    returnSources?: LaundryReturnSourceItem[];
    onNext: (summary?: { name: string; qty: number }[]) => void;
}

export function BatchStepReturn({ batchId, items, returnSources = [], onNext }: BatchStepReturnProps) {
    const { data: pendingItems, isLoading: isPendingLoading } = useSWR<LaundryPendingItem[]>("/api/linen/pending", apiDataFetcher);
    const [returnData, setReturnData] = useState<Record<string, string>>({});
    const [resolvedPending, setResolvedPending] = useState<string[]>([]);
    const [isSubmitting, setIsSubmitting] = useState(false);
    const [isPendingSheetOpen, setIsPendingSheetOpen] = useState(false);

    // Group pending items by date
    const pendingByDate = useMemo(() => {
        if (!pendingItems) return {};
        const map: Record<string, LaundryPendingItem[]> = {};
        pendingItems.forEach(pi => {
            const date = pi.source_batch_date || pi.created_at.split("T")[0];
            if (!map[date]) map[date] = [];
            map[date].push(pi);
        });
        return map;
    }, [pendingItems]);

    const hasPending = pendingItems && pendingItems.length > 0;

    const isComplete = useMemo(() => {
        // all source items expected back MUST have an entry in returnData (can be 0)
        for (const item of returnSources) {
            if (returnData[item.id] === undefined || returnData[item.id] === "") {
                return false;
            }
        }
        return true;
    }, [returnSources, returnData]);

    const handleReturnChange = (id: string, val: string) => {
        setReturnData(prev => ({ ...prev, [id]: val }));
    };

    const toggleResolvePending = (id: string) => {
        setResolvedPending(prev => 
            prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id]
        );
    };

    const handleSubmit = async () => {
        if (!isComplete) return;
        setIsSubmitting(true);
        try {
            const returnItemsPayload = returnSources.map(item => ({
                source_batch_id: item.source_batch_id,
                linen_item_id: item.linen_item_id,
                received_qty: parseInt(returnData[item.id] || "0", 10),
                is_dayuse: item.is_dayuse,
            }));

            const payload = {
                step: "fo_return_counted",
                return_items: returnItemsPayload,
                pending_resolved: resolvedPending.map(id => ({ pending_item_id: id }))
            };

            const res = await fetch(`/api/linen/batches/${batchId}/step`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(payload)
            });

            if (!res.ok) throw new Error("Failed to submit return counts");
            const summary = returnSources
                .map((item) => ({
                    name: item.name_th ?? `Item ${item.linen_item_id}`,
                    qty: parseInt(returnData[item.id] || "0", 10),
                }))
                .filter((item) => item.qty > 0);
            onNext(summary);
        } catch (error) {
            console.error(error);
            alert("เกิดข้อผิดพลาดในการบันทึก กรุณาลองใหม่");
        } finally {
            setIsSubmitting(false);
        }
    };

    const displayItems = useMemo(() => {
        return returnSources.map(i => ({
            id: i.id,
            name: i.name_th || `Item ${i.linen_item_id}`,
            sent: i.remaining_qty,
            sourceLabel: `${i.source_business_date} #${i.source_pickup_round}`,
        }));
    }, [returnSources]);

    return (
        <div className="w-full relative">
            <div className="bg-white dark:bg-slate-900 rounded-t-xl rounded-b sm:rounded-xl border border-slate-200 dark:border-slate-800 overflow-hidden shadow-sm transition-colors">
                <div className="p-4 border-b border-slate-100 dark:border-slate-800 bg-slate-50 dark:bg-slate-800/50 flex items-center justify-between">
                    <div>
                        <h3 className="font-semibold text-slate-800 dark:text-slate-100 text-lg flex items-center gap-2">
                            <span>📋 นับผ้ารับคืน</span>
                            <span className="text-[10px] px-2 py-0.5 rounded-full bg-slate-200 dark:bg-slate-700 text-slate-600 dark:text-slate-300 font-bold uppercase transition-colors">Step 2/4</span>
                        </h3>
                    </div>
                </div>

                <div className="p-4 bg-white dark:bg-slate-900">
                    <h4 className="font-semibold text-slate-700 dark:text-slate-300 mb-3 flex items-center gap-2 text-sm">
                        <div className="w-2 h-2 bg-emerald-500 rounded-full" />
                        คืนจากการส่งรอบที่ผ่านมา
                    </h4>

                    {displayItems.length === 0 ? (
                        <div className="p-4 bg-slate-50 dark:bg-slate-800/50 rounded-xl text-center text-slate-500 dark:text-slate-400 text-sm mb-6 border border-dashed border-slate-200 dark:border-slate-700">
                            ไม่มีผ้าที่ต้องรับคืนจากรอบก่อนหน้า
                        </div>
                    ) : (
                        <>
                            <div className="flex text-[10px] font-bold text-slate-400 dark:text-slate-500 px-2 pb-2 mb-2 border-b border-slate-100 dark:border-slate-800 uppercase tracking-widest">
                                <div className="flex-1">รายการ</div>
                                <div className="w-16 text-center">ส่งไป</div>
                                <div className="w-20 text-center">รับจริง</div>
                            </div>

                            <div className="space-y-3 mb-6">
                                {displayItems.map(item => (
                                    <div key={item.id} className="flex items-center gap-2">
                                        <div className="flex-1 text-sm font-medium text-slate-700 dark:text-slate-300 pl-2">
                                            {item.name}
                                            <span className="block text-[10px] text-slate-400 dark:text-slate-500 font-normal uppercase tracking-tight">รอบ {item.sourceLabel}</span>
                                        </div>
                                        <div className="w-16 text-center text-sm font-medium text-slate-400 dark:text-slate-500 bg-slate-50 dark:bg-slate-800/50 py-1.5 rounded-md">
                                            {item.sent}
                                        </div>
                                        <div className="w-20">
                                            <input
                                                type="number"
                                                min="0"
                                                value={returnData[item.id] ?? ""}
                                                onChange={(e) => handleReturnChange(item.id, e.target.value)}
                                                className="w-full h-11 bg-white dark:bg-slate-800 border-2 border-slate-200 dark:border-slate-700 rounded-lg text-center font-bold text-slate-800 dark:text-slate-100 text-lg transition-all focus:border-[#1B4038] focus:ring-4 focus:ring-[#1B4038]/10 outline-none"
                                                placeholder="..."
                                            />
                                        </div>
                                    </div>
                                ))}
                            </div>
                        </>
                    )}

                    {isPendingLoading ? (
                        <div className="p-4 bg-slate-50 dark:bg-slate-800/50 rounded-xl text-center text-slate-400 animate-pulse text-sm">กำลังโหลดข้อมูลผ้าค้าง...</div>
                    ) : hasPending ? (
                        <div className="mt-6 border border-amber-200 dark:border-amber-900/50 rounded-xl overflow-hidden bg-amber-50/30 dark:bg-amber-950/20">
                            <div className="p-4 border-b border-amber-100 dark:border-amber-900/50 flex items-center justify-between">
                                <h4 className="font-semibold text-amber-800 dark:text-amber-400 flex items-center gap-2 text-sm">
                                    <div className="w-2 h-2 bg-amber-500 rounded-full" />
                                    ผ้าค้างเก่า ({pendingItems.length} รายการ)
                                </h4>
                                <button 
                                    onClick={() => setIsPendingSheetOpen(!isPendingSheetOpen)}
                                    className="text-[10px] font-bold text-amber-700 dark:text-amber-400 bg-amber-100 dark:bg-amber-900/50 hover:bg-amber-200 dark:hover:bg-amber-900 px-3 py-1.5 rounded-lg transition-colors shadow-sm uppercase tracking-wider"
                                >
                                    {isPendingSheetOpen ? 'ปิดรายละเอียด' : 'ดูรายละเอียด →'}
                                </button>
                            </div>
                            
                            {isPendingSheetOpen && (
                                <div className="p-3 bg-white dark:bg-slate-900 space-y-4">
                                    {Object.entries(pendingByDate).map(([date, pItems]) => (
                                        <div key={date}>
                                            <div className="text-[10px] font-bold text-slate-500 dark:text-slate-400 mb-2 px-1 uppercase tracking-tight">รอบวันที่ {date}</div>
                                            <div className="space-y-2">
                                                {pItems.map(pi => {
                                                    const isResolved = resolvedPending.includes(pi.id);
                                                    return (
                                                        <label 
                                                            key={pi.id} 
                                                            className={`flex items-center gap-3 p-3 rounded-lg border-2 cursor-pointer transition-all select-none
                                                                ${isResolved 
                                                                    ? 'border-emerald-500 bg-emerald-50 dark:bg-emerald-950/20' 
                                                                    : 'border-slate-100 dark:border-slate-800 bg-slate-50 dark:bg-slate-800/50 hover:border-amber-300 dark:hover:border-amber-700'}`}
                                                        >
                                                            <div className={`w-6 h-6 rounded-md flex items-center justify-center shrink-0 border-2 transition-colors
                                                                ${isResolved 
                                                                    ? 'bg-emerald-500 border-emerald-500 text-white' 
                                                                    : 'bg-white dark:bg-slate-800 border-slate-300 dark:border-slate-700 text-transparent'}`}
                                                            >
                                                                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" className="w-4 h-4"><polyline points="20 6 9 17 4 12"/></svg>
                                                            </div>
                                                            <div className="flex-1 flex justify-between items-center">
                                                                <span className={`text-sm font-medium ${isResolved ? 'text-emerald-800 dark:text-emerald-300' : 'text-slate-700 dark:text-slate-300'}`}>{pi.name_th}</span>
                                                                <span className={`text-sm font-bold ${isResolved ? 'text-emerald-700 dark:text-emerald-400' : 'text-amber-600 dark:text-amber-500'}`}>{pi.pending_qty} ชิ้น</span>
                                                            </div>
                                                            <input 
                                                                type="checkbox" 
                                                                className="hidden"
                                                                checked={isResolved}
                                                                onChange={() => toggleResolvePending(pi.id)}
                                                            />
                                                        </label>
                                                    );
                                                })}
                                            </div>
                                        </div>
                                    ))}
                                </div>
                            )}
                        </div>
                    ) : (
                        <div className="mt-6 border border-slate-200 dark:border-slate-800 rounded-xl p-4 bg-slate-50 dark:bg-slate-800/30 text-center text-sm text-slate-500 dark:text-slate-400 flex flex-col items-center gap-2">
                            <div className="w-8 h-8 rounded-full bg-slate-200 dark:bg-slate-800 flex items-center justify-center text-slate-400 dark:text-slate-600">
                                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="w-4 h-4"><path d="M5 12h14M12 5l7 7-7 7"/></svg>
                            </div>
                            ไม่มีผ้าค้างเก่า
                        </div>
                    )}
                </div>

                <div className="p-4 bg-slate-50 dark:bg-slate-800/50 border-t border-slate-100 dark:border-slate-800 transition-colors">
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
                           <>ถัดไป: ร้านซักเซ็นรับ <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="w-5 h-5"><path d="M5 12h14M12 5l7 7-7 7"/></svg></>
                        )}
                    </button>
                    {!isComplete && (
                        <p className="text-center text-[10px] text-rose-500 dark:text-rose-400 font-bold mt-3 uppercase tracking-tighter">
                            * กรุณากรอกช่องรับจริงให้ครบทุกรายการ ยกเว้นถ้าไม่ได้รับคืนเลยให้ใส่ 0
                        </p>
                    )}
                </div>
            </div>
        </div>
    );
}
