"use client";

import React, { useState, useEffect, useMemo } from "react";
import { useParams, useSearchParams, useRouter } from "next/navigation";
import { useLinenBatchDetail } from "@/hooks/use-linen-batch";
import { MobileBatchStepDirty } from "@/components/linen/mobile-batch-step-dirty";
import { MobileBatchStepReturn } from "@/components/linen/mobile-batch-step-return";
import { MobileBatchStepVendorSign } from "@/components/linen/mobile-batch-step-vendor-sign";
import { MobileBatchStepFoSign } from "@/components/linen/mobile-batch-step-fo-sign";
import { BatchQrShare } from "@/components/linen/batch-qr-share";

export default function MobileBatchWizardPage() {
    const params = useParams();
    const searchParams = useSearchParams();
    const router = useRouter();
    const batchId = params.id === "new" ? null : (params.id as string);
    const draftKey = searchParams.get("draft");

    const { data: batchDetail, isLoading, mutate } = useLinenBatchDetail(batchId);
    const [currentStep, setCurrentStep] = useState<number | null>(null);
    const [draftData, setDraftData] = useState<any>(null);
    const [finalToken, setFinalToken] = useState<string | null>(null);

    useEffect(() => {
        if (params.id === "new") {
            setCurrentStep(1);
            if (draftKey) {
                const saved = localStorage.getItem(draftKey);
                if (saved) setDraftData(JSON.parse(saved));
            }
        } else if (batchDetail?.batch) {
            const status = batchDetail.batch.status;
            if (status === "fo_dirty_counted") setCurrentStep(2);
            else if (status === "fo_return_counted") setCurrentStep(3);
            else if (status === "vendor_signed") setCurrentStep(4);
            else if (["fo_return_signed", "closed", "partial", "disputed"].includes(status)) {
                setCurrentStep(5);
                // If it's already done, try to find a token if available
                if (batchDetail.tokens && batchDetail.tokens.length > 0) {
                    setFinalToken(batchDetail.tokens[0].token);
                }
            }
        }
    }, [params.id, batchDetail, draftKey]);

    const handleNext = (newBatchId?: string) => {
        if (newBatchId) {
            router.replace(`/linen-mobile/batch/${newBatchId}`);
        } else {
            mutate();
        }
    };

    const handleBack = () => {
        // Logic to move back a step if possible
        if (currentStep === 3) {
            // Need an API to rollback or just set state if we want to support editing
            // Brief says: Step 3/4 signature cleared when back.
            // For simplicity in Step 3/4, we just let them go back to previous logical states.
            // But since statuses are DB-driven, we might need a "Reopen" or similar.
            // Actually, for Step 3/4, FO often wants to fix a number in Step 2.
            alert("ต้องการแก้ไขข้อมูลย้อนหลัง? กรุณาแจ้ง Admin เพื่อ Reopen Batch หรือเริ่มนับใหม่ (ใน v1)");
        }
    };

    const summaryText = useMemo(() => {
        if (!batchDetail?.items) return "";
        const items = batchDetail.items;
        const dirty = items.filter(i => !i.is_dayuse && i.sent_by_hotel > 0);
        const dayuse = items.filter(i => i.is_dayuse && i.sent_by_hotel > 0);
        const returns = items.filter(i => i.received_back > 0);

        let text = `สรุปรายการผ้า [รอบ ${batchDetail.batch.pickup_round}]\nวันที่: ${batchDetail.batch.business_date}\n`;
        
        if (dirty.length > 0) {
            text += `\n--- ผ้าวันนี้ ---\n` + dirty.map(i => `${i.name_th}: ${i.sent_by_hotel} ชิ้น`).join("\n");
        }
        if (dayuse.length > 0) {
            text += `\n\n--- ผ้าเก่า ---\n` + dayuse.map(i => `${i.name_th}: ${i.sent_by_hotel} ชิ้น`).join("\n");
        }
        if (returns.length > 0) {
            text += `\n\n--- รับคืน ---\n` + returns.map(i => `${i.name_th}: ${i.received_back} ชิ้น`).join("\n");
        }
        
        return text;
    }, [batchDetail]);

    if (isLoading && params.id !== "new") {
        return <div className="p-10 text-center text-slate-400 font-thai">กำลังโหลดข้อมูลรอบ...</div>;
    }

    return (
        <div className="min-h-screen bg-slate-50 flex flex-col p-4">
            <header className="flex items-center justify-between mb-4">
                <button 
                    onClick={() => router.push("/linen-mobile")}
                    className="w-10 h-10 rounded-full bg-white flex items-center justify-center text-slate-400 shadow-sm border border-slate-100 active:scale-90 transition-all"
                >
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" className="w-5 h-5"><path d="M15 18l-6-6 6-6"/></svg>
                </button>
                <div className="flex-1 text-center">
                    <span className="text-sm font-bold text-slate-300 uppercase tracking-widest">
                        {currentStep && currentStep < 5 ? `Step ${currentStep} / 4` : "Completed"}
                    </span>
                </div>
                <div className="w-10" />
            </header>

            <div className="flex-1">
                {currentStep === 1 && (
                    <MobileBatchStepDirty initialData={draftData} onNext={handleNext} />
                )}
                {currentStep === 2 && batchDetail && (
                    <MobileBatchStepReturn 
                        batchId={batchId!} 
                        items={batchDetail.items} 
                        returnSources={batchDetail.return_sources || []} 
                        onNext={() => handleNext()} 
                    />
                )}
                {currentStep === 3 && batchDetail && (
                    <MobileBatchStepVendorSign 
                        batchId={batchId!} 
                        items={batchDetail.items} 
                        onNext={() => handleNext()}
                        onBack={() => setCurrentStep(2)} // Allow going back to Step 2 locally if no DB change yet
                    />
                )}
                {currentStep === 4 && batchDetail && (
                    <MobileBatchStepFoSign 
                        batchId={batchId!} 
                        items={batchDetail.items} 
                        onDone={(token) => {
                            setFinalToken(token);
                            setCurrentStep(5);
                        }}
                        onBack={() => setCurrentStep(3)}
                    />
                )}
                {currentStep === 5 && (
                    <div className="animate-in fade-in duration-500">
                        <BatchQrShare token={finalToken || ""} summaryText={summaryText} />
                        <div className="mt-8">
                             <button
                                onClick={() => router.push("/linen-mobile")}
                                className="w-full py-4 bg-slate-100 text-slate-500 font-bold rounded-2xl border border-slate-200 active:bg-slate-200 transition-colors"
                             >
                                กลับหน้าหลัก
                             </button>
                        </div>
                    </div>
                )}
            </div>
        </div>
    );
}
