"use client";

import React, { useMemo, useState } from "react";
import Link from "next/link";
import { BatchStepDirty } from "@/components/linen/batch-step-dirty";
import { BatchStepReturn } from "@/components/linen/batch-step-return";
import { BatchStepVendorSign } from "@/components/linen/batch-step-vendor-sign";
import { BatchStepFoSign } from "@/components/linen/batch-step-fo-sign";
import { BatchQrShare } from "@/components/linen/batch-qr-share";
import { useLinenBatchDetail } from "@/hooks/use-linen-batch";
import { formatLinenSummaryLines, toResolvedRewashSummaryRows, toRewashSummaryRows } from "@/lib/linen/rewash-summary";

export default function NewBatchWizardPage() {
    const [step, setStep] = useState<1 | 2 | 3 | 4 | 5>(1);
    const [batchId, setBatchId] = useState<string | null>(null);
    const [vendorToken, setVendorToken] = useState<string | null>(null);
    const [returnSummary, setReturnSummary] = useState<{ name: string; qty: number }[]>([]);

    // Fetch batch detail from Step 2 onwards
    const { data, isLoading, mutate } = useLinenBatchDetail(batchId);

    const summaryText = useMemo(() => {
        if (!data?.batch || !data.items) return "";
        const dirty = data.items.filter(i => !i.is_dayuse && i.sent_by_hotel > 0);
        const dayuse = data.items.filter(i => i.is_dayuse && i.sent_by_hotel > 0);
        const rewash = toRewashSummaryRows(data.rewash_events ?? []);
        const rewashReturns = toResolvedRewashSummaryRows(data.resolved_rewash_events ?? []);
        const returns = returnSummary.length > 0
            ? returnSummary
            : data.items.filter(i => i.received_back > 0).map(i => ({ name: i.name_th ?? `Item ${i.linen_item_id}`, qty: i.received_back }));

        let text = `สรุปรายการผ้า [รอบ ${data.batch.pickup_round}]\nวันที่: ${data.batch.business_date}\n`;
        if (dirty.length > 0) {
            text += `\n--- ผ้าวันนี้ ---\n` + dirty.map(i => `${i.name_th}: ${i.sent_by_hotel} ชิ้น`).join("\n");
        }
        if (dayuse.length > 0) {
            text += `\n\n--- ผ้าเก่า ---\n` + dayuse.map(i => `${i.name_th}: ${i.sent_by_hotel} ชิ้น`).join("\n");
        }
        if (rewash.length > 0) {
            text += `\n\n--- ผ้าซักใหม่ ---\n` + formatLinenSummaryLines(rewash);
        }
        if (returns.length > 0) {
            text += `\n\n--- รับคืน ---\n` + returns.map(i => `${i.name}: ${i.qty} ชิ้น`).join("\n");
        }
        if (rewashReturns.length > 0) {
            text += `\n\n--- รับคืนผ้าซักใหม่ ---\n` + formatLinenSummaryLines(rewashReturns);
        }
        return text;
    }, [data, returnSummary]);

    const handleStep1Done = (newBatchId: string) => {
        setBatchId(newBatchId);
        setStep(2);
    };

    const handleStep2Done = async (summary: { name: string; qty: number }[] = []) => {
        setReturnSummary(summary);
        await mutate();
        setStep(3);
    };

    const handleStep3Done = () => {
        setStep(4);
    };

    const handleStep4Done = (token: string) => {
        setVendorToken(token);
        setStep(5);
    };

    return (
        <div className="p-4 md:p-8 max-w-lg mx-auto pb-20">
            <div className="mb-6 flex items-center gap-3">
                <Link 
                    href="/pms/linen"
                    className="w-10 h-10 rounded-full bg-slate-100 dark:bg-slate-800 flex items-center justify-center text-slate-500 dark:text-slate-400 hover:bg-slate-200 dark:hover:bg-slate-700 transition-colors"
                >
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="w-5 h-5"><path d="M15 18l-6-6 6-6"/></svg>
                </Link>
                <div>
                    <h1 className="text-xl font-bold text-slate-900 dark:text-slate-100">บันทึกรับ-ส่งผ้า</h1>
                    <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">รอบใหม่ประจำวัน</p>
                </div>
            </div>

            {/* Stepper Indicator */}
            {step < 5 && (
                <div className="flex items-center justify-between mb-8 px-2 max-w-sm mx-auto">
                    {[1, 2, 3, 4].map(s => (
                        <React.Fragment key={s}>
                            <div className={`w-8 h-8 rounded-full flex items-center justify-center text-sm font-bold z-10 transition-colors
                                ${step === s ? 'bg-[#1B4038] text-white ring-4 ring-[#1B4038]/20 dark:ring-[#1B4038]/40' : 
                                  step > s ? 'bg-emerald-500 text-white' : 'bg-slate-200 dark:bg-slate-800 text-slate-400 dark:text-slate-600'}`}>
                                {step > s ? <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" className="w-4 h-4"><polyline points="20 6 9 17 4 12"/></svg> : s}
                            </div>
                            {s < 4 && (
                                <div className={`flex-1 h-1 mx-2 rounded-full transition-colors ${step > s ? 'bg-emerald-500' : 'bg-slate-200 dark:bg-slate-800'}`} />
                            )}
                        </React.Fragment>
                    ))}
                </div>
            )}

            <div className="w-full relative min-h-[400px]">
                {step === 1 && (
                    <BatchStepDirty onNext={handleStep1Done} />
                )}

                {step === 2 && batchId && data && !isLoading && (
                    <BatchStepReturn batchId={batchId} items={data.items} returnSources={data.return_sources ?? []} onNext={handleStep2Done} />
                )}

                {step === 3 && batchId && data && !isLoading && (
                    <BatchStepVendorSign 
                        batchId={batchId} 
                        items={data.items} 
                        rewashEvents={data.rewash_events ?? []}
                        rewashReturnSummary={toResolvedRewashSummaryRows(data.resolved_rewash_events ?? [])}
                        pendingItems={[]} 
                        onNext={handleStep3Done} 
                    />
                )}

                {step === 4 && batchId && data && !isLoading && (
                    <BatchStepFoSign
                        batchId={batchId}
                        items={data.items}
                        rewashEvents={data.rewash_events ?? []}
                        returnSummary={returnSummary}
                        rewashReturnSummary={toResolvedRewashSummaryRows(data.resolved_rewash_events ?? [])}
                        onDone={handleStep4Done}
                    />
                )}

                {step === 5 && vendorToken && (
                    <BatchQrShare token={vendorToken} summaryText={summaryText} />
                )}

                {step > 1 && step < 5 && isLoading && (
                    <div className="absolute inset-0 bg-white/80 dark:bg-slate-900/80 backdrop-blur-sm flex items-center justify-center z-10 rounded-xl">
                        <div className="w-8 h-8 rounded-full border-4 border-slate-200 dark:border-slate-800 border-t-[#1B4038] animate-spin" />
                    </div>
                )}
            </div>
        </div>
    );
}
