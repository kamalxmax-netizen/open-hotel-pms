"use client";

import React, { useState, useMemo } from "react";
import { SignatureCanvas } from "./signature-canvas";
import { toRewashSummaryRows } from "@/lib/linen/rewash-summary";
import type { LaundryBatchItem, LaundryRewashEvent } from "@/lib/types";

interface BatchStepFoSignProps {
    batchId: string;
    items: LaundryBatchItem[];
    rewashEvents?: LaundryRewashEvent[];
    returnSummary?: { name: string; qty: number }[];
    rewashReturnSummary?: { name: string; qty: number }[];
    onDone: (token: string) => void;
}

export function BatchStepFoSign({ batchId, items, rewashEvents = [], returnSummary = [], rewashReturnSummary = [], onDone }: BatchStepFoSignProps) {
    const [signatureBlob, setSignatureBlob] = useState<Blob | null>(null);
    const [isSubmitting, setIsSubmitting] = useState(false);

    const dirtyTotal = useMemo(() => items.filter(i => !i.is_dayuse).reduce((sum, item) => sum + item.sent_by_hotel, 0), [items]);
    const dayuseTotal = useMemo(() => items.filter(i => i.is_dayuse).reduce((sum, item) => sum + item.sent_by_hotel, 0), [items]);
    const rewashItems = useMemo(() => toRewashSummaryRows(rewashEvents), [rewashEvents]);
    const rewashTotal = useMemo(() => rewashItems.reduce((sum, item) => sum + item.qty, 0), [rewashItems]);
    const returnRows = useMemo(() => {
        if (returnSummary.length > 0) return returnSummary;
        return items.filter(i => i.received_back > 0).map(i => ({ name: i.name_th ?? `Item ${i.linen_item_id}`, qty: i.received_back }));
    }, [items, returnSummary]);
    const returnTotal = useMemo(() => returnRows.reduce((sum, item) => sum + item.qty, 0), [returnRows]);
    const rewashReturnTotal = useMemo(() => rewashReturnSummary.reduce((sum, item) => sum + item.qty, 0), [rewashReturnSummary]);
    
    // Simplistic check for complete/partial
    const isComplete = useMemo(() => {
        // Technically, a batch is technically 'complete' if returnTotal >= previous pending, but here we just show an indicator
        // The backend `batch.status` will be 'closed' or 'partial' once vendor confirms.
        return true; 
    }, []);

    const handleSubmit = async () => {
        if (!signatureBlob) return;
        
        setIsSubmitting(true);
        try {
            // 1. Upload signature
            const formData = new FormData();
            formData.append("file", signatureBlob, "signature.png");
            formData.append("type", "fo_return");
            
            const uploadRes = await fetch(`/api/linen/batches/${batchId}/signature`, {
                method: "POST",
                body: formData,
            });
            
            if (!uploadRes.ok) throw new Error("Failed to upload signature");
            
            // 2. Submit step transition
            const stepPayload = {
                step: "fo_return_signed",
            };
            
            const stepRes = await fetch(`/api/linen/batches/${batchId}/step`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(stepPayload),
            });
            
            if (!stepRes.ok) throw new Error("Failed to transition step");

            // 3. Generate Vendor Token
            const tokenRes = await fetch(`/api/linen/batches/${batchId}/token`, {
                method: "POST"
            });
            
            if (!tokenRes.ok) throw new Error("Failed to generate token");
            
            const tokenData = await tokenRes.json();
            
            onDone(tokenData.data.token);
        } catch (error) {
            console.error(error);
            alert("เกิดข้อผิดพลาดในการบันทึกเซ็นรับ กรุณาลองใหม่");
        } finally {
            setIsSubmitting(false);
        }
    };

    return (
        <div className="w-full">
            <div className="bg-white dark:bg-slate-900 rounded-t-xl rounded-b sm:rounded-xl border border-slate-200 dark:border-slate-800 overflow-hidden shadow-sm transition-colors">
                <div className="p-4 border-b border-slate-100 dark:border-slate-800 bg-slate-50 dark:bg-slate-800/50 flex items-center justify-between">
                    <div>
                        <h3 className="font-semibold text-slate-800 dark:text-slate-100 text-lg flex items-center gap-2">
                            <span>✅ สรุปรับ-ส่งผ้า</span>
                            <span className="text-[10px] px-2 py-0.5 rounded-full bg-slate-200 dark:bg-slate-700 text-slate-600 dark:text-slate-300 font-bold uppercase transition-colors">Step 4/4</span>
                        </h3>
                    </div>
                </div>

                <div className="p-5 space-y-5 bg-white dark:bg-slate-900">
                    <div className="bg-emerald-50/50 dark:bg-emerald-950/20 border border-emerald-100 dark:border-emerald-900/50 rounded-xl p-5 text-center">
                        <div className="w-12 h-12 bg-white dark:bg-slate-800 rounded-full flex items-center justify-center text-emerald-500 dark:text-emerald-400 mx-auto mb-3 shadow-sm border border-emerald-100 dark:border-emerald-900/50">
                           <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="w-6 h-6"><path d="M5 12l5 5L20 7"/></svg>
                        </div>
                        <h4 className="font-bold text-slate-800 dark:text-slate-100 text-lg mb-2">ตรวจสอบความถูกต้องอีกครั้ง</h4>
                        
                        <div className="inline-block text-left text-sm text-slate-600 dark:text-slate-400 space-y-2 mt-2 bg-white dark:bg-slate-800 p-4 rounded-xl border border-slate-100 dark:border-slate-700 w-full max-w-[280px]">
                            <div className="flex justify-between border-b border-slate-100 dark:border-slate-700 pb-2">
                                <span>ผ้าเปื้อนส่งซัก</span>
                                <span className="font-bold text-blue-700 dark:text-blue-400">{dirtyTotal} ชิ้น</span>
                            </div>
                            {dayuseTotal > 0 && (
                                <div className="flex justify-between border-b border-slate-100 dark:border-slate-700 pb-2">
                                    <span>ผ้าเก่าส่งซัก</span>
                                    <span className="font-bold text-amber-600 dark:text-amber-400">{dayuseTotal} ชิ้น</span>
                                </div>
                            )}
                            {rewashTotal > 0 && (
                                <div className="border-b border-slate-100 dark:border-slate-700 pb-2">
                                    <div className="flex justify-between">
                                        <span>ผ้าซักใหม่</span>
                                        <span className="font-bold text-purple-600 dark:text-purple-400">{rewashTotal} ชิ้น</span>
                                    </div>
                                    <div className="mt-2 space-y-1 text-xs text-slate-500 dark:text-slate-400">
                                        {rewashItems.map((item) => (
                                            <div key={`fo-rewash-${item.id}`} className="flex justify-between gap-3">
                                                <span>{item.name}</span>
                                                <span className="font-semibold text-purple-600 dark:text-purple-300">{item.qty}</span>
                                            </div>
                                        ))}
                                    </div>
                                </div>
                            )}
                            <div className="flex justify-between pt-1">
                                <span>ผ้ารับคืนจากร้าน</span>
                                <span className="font-bold text-emerald-700 dark:text-emerald-400">{returnTotal} ชิ้น</span>
                            </div>
                            {returnRows.length > 0 && (
                                <div className="mt-2 space-y-1 text-xs text-slate-500 dark:text-slate-400">
                                    {returnRows.map((item, index) => (
                                        <div key={`fo-return-${index}`} className="flex justify-between gap-3">
                                            <span>{item.name}</span>
                                            <span className="font-semibold text-emerald-600 dark:text-emerald-300">{item.qty}</span>
                                        </div>
                                    ))}
                                </div>
                            )}
                            {rewashReturnTotal > 0 && (
                                <div className="border-t border-slate-100 dark:border-slate-700 pt-2">
                                    <div className="flex justify-between">
                                        <span>รับคืนผ้าซักใหม่</span>
                                        <span className="font-bold text-fuchsia-600 dark:text-fuchsia-400">{rewashReturnTotal} ชิ้น</span>
                                    </div>
                                    <div className="mt-2 space-y-1 text-xs text-slate-500 dark:text-slate-400">
                                        {rewashReturnSummary.map((item, index) => (
                                            <div key={`fo-rewash-return-${index}`} className="flex justify-between gap-3">
                                                <span>{item.name}</span>
                                                <span className="font-semibold text-fuchsia-600 dark:text-fuchsia-300">{item.qty}</span>
                                            </div>
                                        ))}
                                    </div>
                                </div>
                            )}
                        </div>
                    </div>

                    <div className="bg-slate-50 dark:bg-slate-800/50 border border-slate-200 dark:border-slate-800 rounded-xl p-4 flex flex-col items-center">
                        <h4 className="font-bold text-slate-800 dark:text-slate-100 mb-4 text-center text-sm">ลายเซ็นพนักงานโรงแรม (FO)</h4>
                        <SignatureCanvas onSign={setSignatureBlob} width={300} height={150} />
                    </div>
                </div>

                <div className="p-4 bg-slate-50 dark:bg-slate-800/50 border-t border-slate-100 dark:border-slate-800 transition-colors">
                    <button
                        type="button"
                        onClick={handleSubmit}
                        disabled={!signatureBlob || isSubmitting}
                        className={`w-full py-3.5 rounded-xl font-bold text-white transition-all shadow-sm flex justify-center items-center gap-2
                            ${signatureBlob && !isSubmitting 
                                ? 'bg-[#1B4038] hover:bg-[#122b26]' 
                                : 'bg-slate-300 dark:bg-slate-800 text-slate-500 dark:text-slate-600 cursor-not-allowed shadow-none'}`}
                    >
                        {isSubmitting ? (
                           <div className="w-5 h-5 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                        ) : (
                           <>ยืนยัน ปิดรายการ <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="w-5 h-5"><path d="M5 12l5 5L20 7"/></svg></>
                        )}
                    </button>
                    {!signatureBlob && (
                        <p className="text-center text-[10px] text-rose-500 dark:text-rose-400 font-bold mt-3 uppercase tracking-tighter">
                            * พนักงาน FO ต้องเซ็นลายเซ็นกำกับก่อนปิดรายการ
                        </p>
                    )}
                </div>
            </div>
        </div>
    );
}
