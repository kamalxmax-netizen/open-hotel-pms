"use client";

import React, { useState } from "react";
import Link from "next/link";
import { format } from "date-fns";
import { th } from "date-fns/locale/th";
import { useLinenBatchDetail } from "@/hooks/use-linen-batch";
import { BatchStepReturn } from "@/components/linen/batch-step-return";
import { BatchStepVendorSign } from "@/components/linen/batch-step-vendor-sign";
import { BatchStepFoSign } from "@/components/linen/batch-step-fo-sign";
import { BatchQrShare } from "@/components/linen/batch-qr-share";
import { SignatureDisplay } from "@/components/linen/signature-display";
import { StatusBadge } from "@/components/linen/status-badge";
import {
    formatLinenSummaryLines,
    formatPendingSummaryLines,
    formatReturnSummaryLines,
    formatReturnSummaryRowsForDisplay,
    toAdjustedPendingSummaryRows,
    toResolvedRewashSummaryRows,
    toReturnSummaryRows,
    toRewashSummaryRows,
} from "@/lib/linen/rewash-summary";

export default function BatchDetailPage({ params }: { params: { id: string } }) {
    const { data, isLoading, mutate } = useLinenBatchDetail(params.id);
    const [isReopening, setIsReopening] = useState(false);
    const [token, setToken] = useState<string | null>(null);

    if (isLoading) {
        return <div className="p-8 text-center text-slate-500 animate-pulse">กำลังโหลดข้อมูล...</div>;
    }

    if (!data || !data.batch) {
        return <div className="p-8 text-center text-rose-500">ไม่พบข้อมูล หรือเกิดข้อผิดพลาด</div>;
    }

    const { batch, items, return_sources: returnSources = [] } = data;
    const rewashRows = toRewashSummaryRows(data.rewash_events ?? []);
    const rewashTotal = rewashRows.reduce((sum, item) => sum + item.qty, 0);
    const returnRows = toReturnSummaryRows(data.events ?? [], [...items, ...returnSources]);
    const returnDisplayRows = formatReturnSummaryRowsForDisplay(returnRows);
    const rewashReturnRows = toResolvedRewashSummaryRows(data.resolved_rewash_events ?? []);
    const pendingRows = toAdjustedPendingSummaryRows(data.pending_items ?? [], data.events ?? [], [...items, ...returnSources]);
    const summaryText = (() => {
        const dirty = items.filter(i => !i.is_dayuse && i.sent_by_hotel > 0);
        const dayuse = items.filter(i => i.is_dayuse && i.sent_by_hotel > 0);
        const returns = returnRows.length > 0
            ? returnRows
            : items.filter(i => i.received_back > 0).map(i => ({ name: i.name_th ?? `Item ${i.linen_item_id}`, qty: i.received_back }));

        let text = `สรุปรายการผ้า [รอบ ${batch.pickup_round}]\nวันที่: ${batch.business_date}\n`;
        if (dirty.length > 0) {
            text += `\n--- ผ้าวันนี้ ---\n` + dirty.map(i => `${i.name_th}: ${i.sent_by_hotel} ชิ้น`).join("\n");
        }
        if (dayuse.length > 0) {
            text += `\n\n--- ผ้าเก่า ---\n` + dayuse.map(i => `${i.name_th}: ${i.sent_by_hotel} ชิ้น`).join("\n");
        }
        if (rewashRows.length > 0) {
            text += `\n\n--- ผ้าซักใหม่ ---\n` + formatLinenSummaryLines(rewashRows);
        }
        if (returns.length > 0) {
            text += `\n\n--- รับคืน ---\n` + formatReturnSummaryLines(returns);
        }
        if (rewashReturnRows.length > 0) {
            text += `\n\n--- รับคืนผ้าซักใหม่ ---\n` + formatLinenSummaryLines(rewashReturnRows);
        }
        if (pendingRows.length > 0) {
            text += `\n\n--- ผ้าค้าง ---\n` + formatPendingSummaryLines(pendingRows);
        }
        return text;
    })();
    
    // Admin Reopen
    const handleReopen = async () => {
        if (!confirm("ยืนยันการ Reopen? สถานะจะกลับไปที่ รอร้านซักเซ็นรับ (fo_dirty_counted) และต้องให้ร้านค้าเซ็นรับใหม่ทั้งหมด")) return;
        
        setIsReopening(true);
        try {
            const res = await fetch(`/api/linen/batches/${batch.id}/reopen`, {
                method: "POST"
            });
            if (!res.ok) throw new Error("Failed to reopen");
            
            await mutate(); // Refresh
        } catch (err) {
            console.error(err);
            alert("ไม่สามารถ Reopen ได้");
        } finally {
            setIsReopening(false);
        }
    };

    const handleNext = () => {
        mutate();
    };

    const handleDone = (newToken: string) => {
        setToken(newToken);
        mutate();
    };

    // If step just finished and gave us a token to show
    if (token && batch.status === "fo_return_signed") {
         return (
            <div className="p-4 md:p-8 max-w-lg mx-auto pb-20">
                <BatchQrShare token={token} summaryText={summaryText} />
                <div className="mt-4 text-center">
                    <button onClick={() => setToken(null)} className="text-sm text-slate-500 underline">ไปหน้าสรุปข้อมูล</button>
                </div>
            </div>
         );
    }

    // Active Wizard States
    if (batch.status === "fo_dirty_counted") {
        return (
            <div className="p-4 md:p-8 max-w-lg mx-auto pb-20">
                <div className="mb-6 flex items-center gap-3">
                    <Link href="/pms/linen" className="w-10 h-10 rounded-full bg-slate-100 dark:bg-slate-800 flex items-center justify-center text-slate-500 dark:text-slate-400 hover:bg-slate-200 dark:hover:bg-slate-700 transition-colors border border-slate-200 dark:border-slate-700 shadow-sm">
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="w-5 h-5"><path d="M15 18l-6-6 6-6"/></svg>
                    </Link>
                    <div><h1 className="text-xl font-bold text-slate-900 dark:text-slate-100">รับ-ส่งผ้าต่อ</h1></div>
                </div>
                <BatchStepReturn batchId={batch.id} items={items} returnSources={returnSources} onNext={handleNext} />
            </div>
        );
    }

    if (batch.status === "fo_return_counted") {
        return (
            <div className="p-4 md:p-8 max-w-lg mx-auto pb-20">
                <div className="mb-6 flex items-center gap-3">
                    <Link href="/pms/linen" className="w-10 h-10 rounded-full bg-slate-100 dark:bg-slate-800 flex items-center justify-center text-slate-500 dark:text-slate-400 hover:bg-slate-200 dark:hover:bg-slate-700 transition-colors border border-slate-200 dark:border-slate-700 shadow-sm">
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="w-5 h-5"><path d="M15 18l-6-6 6-6"/></svg>
                    </Link>
                    <div><h1 className="text-xl font-bold text-slate-900 dark:text-slate-100">ร้านซักเซ็นรับ</h1></div>
                </div>
                <BatchStepVendorSign batchId={batch.id} items={items} rewashEvents={data.rewash_events ?? []} returnSummary={returnDisplayRows} rewashReturnSummary={rewashReturnRows} pendingItems={[]} onNext={handleNext} />
            </div>
        );
    }

    if (batch.status === "vendor_signed") {
        return (
            <div className="p-4 md:p-8 max-w-lg mx-auto pb-20">
                <div className="mb-6 flex items-center gap-3">
                    <Link href="/pms/linen" className="w-10 h-10 rounded-full bg-slate-100 dark:bg-slate-800 flex items-center justify-center text-slate-500 dark:text-slate-400 hover:bg-slate-200 dark:hover:bg-slate-700 transition-colors border border-slate-200 dark:border-slate-700 shadow-sm">
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="w-5 h-5"><path d="M15 18l-6-6 6-6"/></svg>
                    </Link>
                    <div><h1 className="text-xl font-bold text-slate-900 dark:text-slate-100">FO เซ็นรับจบ</h1></div>
                </div>
                <BatchStepFoSign batchId={batch.id} items={items} rewashEvents={data.rewash_events ?? []} returnSummary={returnDisplayRows} rewashReturnSummary={rewashReturnRows} onDone={handleDone} />
            </div>
        );
    }

    // Detail View (fo_return_signed, closed, partial, disputed)
    const dirtyTotal = items.filter(i => !i.is_dayuse).reduce((sum, item) => sum + item.sent_by_hotel, 0);
    const dayuseTotal = items.filter(i => i.is_dayuse).reduce((sum, item) => sum + item.sent_by_hotel, 0);
    const detailReturnRows = returnDisplayRows.length > 0
        ? returnDisplayRows
        : items.filter(i => i.received_back > 0).map(i => ({ name: i.name_th ?? `Item ${i.linen_item_id}`, qty: i.received_back }));
    const returnTotal = detailReturnRows.reduce((sum, item) => sum + item.qty, 0);
    const rewashReturnTotal = rewashReturnRows.reduce((sum, item) => sum + item.qty, 0);

    return (
        <div className="p-4 md:p-8 max-w-2xl mx-auto pb-20">
            <div className="flex items-center justify-between mb-6">
                <div className="flex items-center gap-3">
                    <Link href="/pms/linen" className="w-10 h-10 rounded-full bg-white dark:bg-slate-800 flex items-center justify-center text-slate-500 dark:text-slate-400 hover:bg-slate-50 dark:hover:bg-slate-700 border border-slate-200 dark:border-slate-700 transition-colors shadow-sm">
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="w-5 h-5"><path d="M15 18l-6-6 6-6"/></svg>
                    </Link>
                    <div>
                        <h1 className="text-xl font-bold text-slate-900 dark:text-slate-100">รายละเอียด Batch</h1>
                        <p className="text-sm text-slate-500 dark:text-slate-400 mt-0.5">วันที่ {format(new Date(batch.business_date), "dd MMMM yyyy", { locale: th })} • รอบที่ {batch.pickup_round}</p>
                    </div>
                </div>
                <div className="flex flex-col items-end gap-1">
                    <StatusBadge status={batch.status} />
                </div>
            </div>

            {batch.status === "disputed" && (
                <div className="mb-6 p-4 bg-rose-50 dark:bg-rose-950/30 border border-rose-200 dark:border-rose-800 rounded-xl text-rose-800 dark:text-rose-300">
                    <div className="flex items-center gap-2 font-bold mb-1">
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="w-5 h-5"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>
                        ร้านค้าแจ้งว่ายอดไม่ตรง!
                    </div>
                    <p className="text-sm">โปรดตรวจสอบกับร้านซักรีด และทำการแก้ไข (Reopen) หาข้อมูลผิดพลาด</p>
                </div>
            )}

            <div className="bg-white dark:bg-slate-900 rounded-xl border border-slate-200 dark:border-slate-800 shadow-sm overflow-hidden mb-6">
                <div className="p-4 border-b border-slate-100 dark:border-slate-800 flex items-center justify-between">
                    <h3 className="font-semibold text-slate-800 dark:text-slate-200">สรุปจำนวนผ้า</h3>
                </div>
                <div className="p-0 border-b border-slate-100 dark:border-slate-800">
                    <div className={`grid ${rewashTotal > 0 || rewashReturnTotal > 0 ? "grid-cols-2 md:grid-cols-5" : "grid-cols-3"} divide-x divide-slate-100 dark:divide-slate-800`}>
                        <div className="p-4 text-center">
                            <p className="text-xs text-slate-500 dark:text-slate-400 mb-1">ส่งซัก</p>
                            <p className="text-2xl font-bold text-blue-700 dark:text-blue-400">{dirtyTotal}</p>
                        </div>
                        <div className="p-4 text-center bg-amber-50/30 dark:bg-amber-500/5">
                            <p className="text-xs text-amber-600 dark:text-amber-400 mb-1">ผ้าเก่า (Day Use)</p>
                            <p className="text-2xl font-bold text-amber-700 dark:text-amber-500">{dayuseTotal}</p>
                        </div>
                        {rewashTotal > 0 && (
                            <div className="p-4 text-center bg-purple-50/30 dark:bg-purple-500/5">
                                <p className="text-xs text-purple-600 dark:text-purple-400 mb-1">ผ้าซักใหม่</p>
                                <p className="text-2xl font-bold text-purple-700 dark:text-purple-500">{rewashTotal}</p>
                            </div>
                        )}
                        <div className="p-4 text-center bg-emerald-50/30 dark:bg-emerald-500/5">
                            <p className="text-xs text-emerald-600 dark:text-emerald-400 mb-1">รับคืน</p>
                            <p className="text-2xl font-bold text-emerald-700 dark:text-emerald-500">{returnTotal}</p>
                        </div>
                        {rewashReturnTotal > 0 && (
                            <div className="p-4 text-center bg-fuchsia-50/30 dark:bg-fuchsia-500/5">
                                <p className="text-xs text-fuchsia-600 dark:text-fuchsia-400 mb-1">รับคืน Rewash</p>
                                <p className="text-2xl font-bold text-fuchsia-700 dark:text-fuchsia-500">{rewashReturnTotal}</p>
                            </div>
                        )}
                    </div>
                </div>

                <div className="p-4 bg-white dark:bg-slate-900">
                    {items.map(item => (
                        <div key={`${item.linen_item_id}-${item.is_dayuse}`} className="flex justify-between items-center py-2 border-b border-slate-50 dark:border-slate-800 last:border-0">
                            <span className="text-sm font-medium text-slate-700 dark:text-slate-300">
                                {item.name_th} {item.is_dayuse && <span className="text-amber-500 text-xs ml-1">(Day Use)</span>}
                            </span>
                            <div className="text-sm font-semibold flex items-center gap-3">
                                <span className={item.sent_by_hotel > 0 ? "text-blue-600 dark:text-blue-400" : "text-slate-300 dark:text-slate-700"}>{item.sent_by_hotel}</span>
                                <span className="text-slate-200 dark:text-slate-800">|</span>
                                <span className={item.received_back > 0 ? "text-emerald-600 dark:text-emerald-400" : "text-slate-300 dark:text-slate-700"}>{item.received_back}</span>
                            </div>
                        </div>
                    ))}
                    {rewashRows.length > 0 && (
                        <div className="mt-3 rounded-lg border border-purple-100 bg-purple-50/50 p-3 dark:border-purple-900/40 dark:bg-purple-950/20">
                            <div className="mb-2 text-xs font-bold uppercase tracking-widest text-purple-600 dark:text-purple-300">
                                ผ้าซักใหม่
                            </div>
                            {rewashRows.map(item => (
                                <div key={`detail-rewash-${item.id}`} className="flex justify-between items-center py-1 text-sm">
                                    <span className="font-medium text-slate-700 dark:text-slate-300">{item.name}</span>
                                    <span className="font-bold text-purple-700 dark:text-purple-300">{item.qty}</span>
                                </div>
                            ))}
                        </div>
                    )}
                    {detailReturnRows.length > 0 && (
                        <div className="mt-3 rounded-lg border border-emerald-100 bg-emerald-50/50 p-3 dark:border-emerald-900/40 dark:bg-emerald-950/20">
                            <div className="mb-2 text-xs font-bold uppercase tracking-widest text-emerald-600 dark:text-emerald-300">
                                ผ้ารับคืน
                            </div>
                            {detailReturnRows.map((item, index) => (
                                <div key={`detail-return-${index}`} className="flex justify-between items-center py-1 text-sm">
                                    <span className="font-medium text-slate-700 dark:text-slate-300">{item.name}</span>
                                    <span className="font-bold text-emerald-700 dark:text-emerald-300">{item.qty}</span>
                                </div>
                            ))}
                        </div>
                    )}
                    {rewashReturnRows.length > 0 && (
                        <div className="mt-3 rounded-lg border border-fuchsia-100 bg-fuchsia-50/50 p-3 dark:border-fuchsia-900/40 dark:bg-fuchsia-950/20">
                            <div className="mb-2 text-xs font-bold uppercase tracking-widest text-fuchsia-600 dark:text-fuchsia-300">
                                รับคืนผ้าซักใหม่
                            </div>
                            {rewashReturnRows.map((item, index) => (
                                <div key={`detail-rewash-return-${index}`} className="flex justify-between items-center py-1 text-sm">
                                    <span className="font-medium text-slate-700 dark:text-slate-300">{item.name}</span>
                                    <span className="font-bold text-fuchsia-700 dark:text-fuchsia-300">{item.qty}</span>
                                </div>
                            ))}
                        </div>
                    )}
                </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-8">
                <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-4 shadow-sm flex flex-col items-center">
                    <h4 className="font-semibold text-slate-700 dark:text-slate-300 mb-3 text-sm flex items-center gap-2 self-start">
                        <div className="w-2 h-2 bg-blue-500 rounded-full" /> ลายเซ็นร้านซักรีด
                    </h4>
                    {batch.vendor_pickup_signature_url ? (
                        <SignatureDisplay src={batch.vendor_pickup_signature_url} label={`ผู้เซ็น: ${batch.vendor_name || '-'}`} />
                    ) : (
                        <div className="h-[60px] w-full bg-slate-50 dark:bg-slate-800/50 rounded-lg flex items-center justify-center text-slate-400 dark:text-slate-600 text-xs border border-slate-100 dark:border-slate-800">
                            ยังไม่มีลายเซ็น
                        </div>
                    )}
                </div>
                <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-4 shadow-sm flex flex-col items-center">
                    <h4 className="font-semibold text-slate-700 dark:text-slate-300 mb-3 text-sm flex items-center gap-2 self-start">
                        <div className="w-2 h-2 bg-emerald-500 rounded-full" /> ลายเซ็น FO
                    </h4>
                    {batch.fo_return_signature_url ? (
                        <SignatureDisplay src={batch.fo_return_signature_url} label="พนักงาน Front Office" />
                    ) : (
                        <div className="h-[60px] w-full bg-slate-50 dark:bg-slate-800/50 rounded-lg flex items-center justify-center text-slate-400 dark:text-slate-600 text-xs border border-slate-100 dark:border-slate-800">
                            ยังไม่มีลายเซ็น
                        </div>
                    )}
                </div>
            </div>

            {/* Admin Action */}
            <div className="border-t border-slate-200 dark:border-slate-800 pt-6">
                <button
                    onClick={handleReopen}
                    disabled={isReopening}
                    className="flex justify-center items-center gap-2 w-full py-3 bg-white dark:bg-slate-900 text-rose-600 dark:text-rose-400 font-semibold text-sm rounded-xl border border-rose-200 dark:border-rose-900 hover:bg-rose-50 dark:hover:bg-rose-950 transition-colors"
                >
                    {isReopening ? "กำลังดำเนินการ..." : (
                        <>
                            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="w-4 h-4"><path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8"/><path d="M3 3v5h5"/></svg>
                            Admin: เปิดแก้ไขรายการใหม่ (Reopen)
                        </>
                    )}
                </button>
            </div>
        </div>
    );
}
