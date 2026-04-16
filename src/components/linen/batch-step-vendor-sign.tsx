"use client";

import React, { useState, useMemo } from "react";
import { SignatureCanvas } from "./signature-canvas";
import type { LaundryBatchItem, LaundryPendingItem } from "@/lib/types";

interface BatchStepVendorSignProps {
    batchId: string;
    items: LaundryBatchItem[];
    pendingItems: LaundryPendingItem[]; // all active global pending, or specific to what's left? 
                                        // The backend will leave pending items unresolved if they weren't checked in step 2.
    onNext: () => void;
}

export function BatchStepVendorSign({ batchId, items, pendingItems, onNext }: BatchStepVendorSignProps) {
    const [signatureBlob, setSignatureBlob] = useState<Blob | null>(null);
    const [vendorName, setVendorName] = useState("");
    const [isSubmitting, setIsSubmitting] = useState(false);

    const dirtyTotal = useMemo(() => items.filter(i => !i.is_dayuse).reduce((sum, item) => sum + item.sent_by_hotel, 0), [items]);
    const dayuseTotal = useMemo(() => items.filter(i => i.is_dayuse).reduce((sum, item) => sum + item.sent_by_hotel, 0), [items]);
    const returnTotal = useMemo(() => items.reduce((sum, item) => sum + item.received_back, 0), [items]);
    // Note: If we just resolved some pending items in step 2, they will still be in pendingItems list unless we mutate SWR or wait for real backend state. 
    // We'll just show a count of any unresolved pending for simplicity or rely on server state.
    
    // Group return items
    const returnItemsList = useMemo(() => {
        return items.filter(i => i.received_back > 0);
    }, [items]);

    const handleSubmit = async () => {
        if (!signatureBlob || !vendorName.trim()) return;
        
        setIsSubmitting(true);
        try {
            // 1. Upload signature
            const formData = new FormData();
            formData.append("file", signatureBlob, "signature.png");
            formData.append("type", "vendor_pickup");
            
            const uploadRes = await fetch(`/api/linen/batches/${batchId}/signature`, {
                method: "POST",
                body: formData,
            });
            
            if (!uploadRes.ok) throw new Error("Failed to upload signature");
            
            // 2. Submit step transition
            const stepPayload = {
                step: "vendor_signed",
                vendor_name: vendorName.trim(),
            };
            
            const stepRes = await fetch(`/api/linen/batches/${batchId}/step`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(stepPayload),
            });
            
            if (!stepRes.ok) throw new Error("Failed to transition step");
            
            onNext();
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
                            <span>🤝 ใบรับ-ส่งผ้าซักรีด</span>
                            <span className="text-[10px] px-2 py-0.5 rounded-full bg-slate-200 dark:bg-slate-700 text-slate-600 dark:text-slate-300 font-bold uppercase transition-colors">Step 3/4</span>
                        </h3>
                    </div>
                </div>

                <div className="p-5 space-y-5 bg-white dark:bg-slate-900">
                    <div className="bg-slate-50 dark:bg-slate-800/50 border border-slate-200 dark:border-slate-800 rounded-xl p-4 space-y-4">
                        <div className="flex items-center justify-between border-b border-slate-200 dark:border-slate-700 pb-3">
                            <h4 className="font-semibold text-slate-700 dark:text-slate-300 flex items-center gap-2 text-sm">
                                <div className="w-2 h-2 bg-blue-500 rounded-full" />
                                ผ้าเปื้อนรับเข้าร้านวันนี้
                            </h4>
                            <span className="font-bold text-lg text-blue-700 dark:text-blue-400">{dirtyTotal} ชิ้น</span>
                        </div>
                        
                        {dayuseTotal > 0 && (
                            <div className="flex items-center justify-between border-b border-slate-200 dark:border-slate-700 pb-3">
                                <h4 className="font-semibold text-slate-700 dark:text-slate-300 flex items-center gap-2 text-sm">
                                    <div className="w-2 h-2 bg-amber-500 rounded-full" />
                                    ผ้าเก่ารับเข้าร้าน (Day Use)
                                </h4>
                                <span className="font-bold text-lg text-amber-700 dark:text-amber-400">{dayuseTotal} ชิ้น</span>
                            </div>
                        )}

                        <div className="flex items-center justify-between pb-1">
                            <h4 className="font-semibold text-slate-700 dark:text-slate-300 flex items-center gap-2 text-sm">
                                <div className="w-2 h-2 bg-emerald-500 rounded-full" />
                                ผ้าที่ส่งคืนโรงแรมวันนี้
                            </h4>
                            <span className="font-bold text-lg text-emerald-700 dark:text-emerald-400">{returnTotal} ชิ้น</span>
                        </div>
                        {returnItemsList.length > 0 && (
                            <div className="pl-4 space-y-1">
                                {returnItemsList.map(i => (
                                    <div key={`ret-${i.id}`} className="flex justify-between text-[11px] text-slate-500 dark:text-slate-400">
                                        <span>• {i.name_th}</span>
                                        <span className="font-medium text-slate-600 dark:text-slate-300">{i.received_back}</span>
                                    </div>
                                ))}
                            </div>
                        )}
                        
                        {pendingItems.length > 0 && (
                            <div className="mt-4 p-3 bg-amber-50 dark:bg-amber-950/20 border border-amber-200 dark:border-amber-900 rounded-lg flex items-start gap-3">
                                <span className="text-xl">⚠️</span>
                                <div>
                                    <h4 className="font-bold text-amber-800 dark:text-amber-400 text-[11px] uppercase tracking-tight">ยังคงมีผ้าค้างส่งคืนรวม {pendingItems.length} รายการ</h4>
                                    <p className="text-[10px] text-amber-700 dark:text-amber-500 mt-0.5">โปรดตรวจสอบรายละเอียดบนเว็บ Vendor อีกครั้ง</p>
                                </div>
                            </div>
                        )}
                    </div>

                    <div className="bg-blue-50/50 dark:bg-slate-800/30 border border-blue-100 dark:border-slate-800 rounded-xl p-4 flex flex-col items-center">
                        <h4 className="font-bold text-slate-800 dark:text-slate-100 mb-4 text-center text-sm">ลายเซ็นผู้รับผ้า (ร้านซักรีด)</h4>
                        
                        <SignatureCanvas onSign={setSignatureBlob} width={300} height={150} />
                        
                        <div className="w-full max-w-[300px] mt-5">
                            <label className="block text-[10px] font-bold text-slate-500 dark:text-slate-400 mb-1 uppercase tracking-widest">
                                ชื่อผู้รับผ้า (ตัวพิมพ์)
                            </label>
                            <input
                                type="text"
                                value={vendorName}
                                onChange={(e) => setVendorName(e.target.value)}
                                className="w-full h-11 bg-white dark:bg-slate-800 border-2 border-slate-200 dark:border-slate-700 rounded-lg px-3 font-bold text-slate-800 dark:text-slate-100 transition-all focus:border-[#1B4038] focus:ring-4 focus:ring-[#1B4038]/10 outline-none"
                                placeholder="พิมพ์ชื่อ-นามสกุล หรือชื่อเล่น..."
                            />
                        </div>
                    </div>
                </div>

                <div className="p-4 bg-slate-50 dark:bg-slate-800/50 border-t border-slate-100 dark:border-slate-800 transition-colors">
                    <button
                        type="button"
                        onClick={handleSubmit}
                        disabled={!signatureBlob || !vendorName.trim() || isSubmitting}
                        className={`w-full py-3.5 rounded-xl font-bold text-white transition-all shadow-sm flex justify-center items-center gap-2
                            ${signatureBlob && vendorName.trim() && !isSubmitting 
                                ? 'bg-blue-600 hover:bg-blue-700' 
                                : 'bg-slate-300 dark:bg-slate-800 text-slate-500 dark:text-slate-600 cursor-not-allowed shadow-none'}`}
                    >
                        {isSubmitting ? (
                           <div className="w-5 h-5 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                        ) : (
                           <>ร้านค้ายืนยันการรับ-ส่ง <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="w-5 h-5"><path d="M5 12h14M12 5l7 7-7 7"/></svg></>
                        )}
                    </button>
                    {(!signatureBlob || !vendorName.trim()) && (
                        <p className="text-center text-[10px] text-rose-500 dark:text-rose-400 font-bold mt-3 uppercase tracking-tighter">
                            * ร้านค้าต้องเซ็นลายเซ็น และพิมพ์ชื่อให้ครบถ้วน
                        </p>
                    )}
                </div>
            </div>
        </div>
    );
}
