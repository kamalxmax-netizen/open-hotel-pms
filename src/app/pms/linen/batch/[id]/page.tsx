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
                <BatchQrShare token={token} />
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
                <BatchStepVendorSign batchId={batch.id} items={items} pendingItems={[]} onNext={handleNext} />
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
                <BatchStepFoSign batchId={batch.id} items={items} onDone={handleDone} />
            </div>
        );
    }

    // Detail View (fo_return_signed, closed, partial, disputed)
    const dirtyTotal = items.filter(i => !i.is_dayuse).reduce((sum, item) => sum + item.sent_by_hotel, 0);
    const dayuseTotal = items.filter(i => i.is_dayuse).reduce((sum, item) => sum + item.sent_by_hotel, 0);
    const returnTotal = items.reduce((sum, item) => sum + item.received_back, 0);

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
                    <div className="grid grid-cols-3 divide-x divide-slate-100 dark:divide-slate-800">
                        <div className="p-4 text-center">
                            <p className="text-xs text-slate-500 dark:text-slate-400 mb-1">ส่งซัก</p>
                            <p className="text-2xl font-bold text-blue-700 dark:text-blue-400">{dirtyTotal}</p>
                        </div>
                        <div className="p-4 text-center bg-amber-50/30 dark:bg-amber-500/5">
                            <p className="text-xs text-amber-600 dark:text-amber-400 mb-1">ผ้าเก่า (Day Use)</p>
                            <p className="text-2xl font-bold text-amber-700 dark:text-amber-500">{dayuseTotal}</p>
                        </div>
                        <div className="p-4 text-center bg-emerald-50/30 dark:bg-emerald-500/5">
                            <p className="text-xs text-emerald-600 dark:text-emerald-400 mb-1">รับคืน</p>
                            <p className="text-2xl font-bold text-emerald-700 dark:text-emerald-500">{returnTotal}</p>
                        </div>
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
                </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-8">
                <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-4 shadow-sm">
                    <h4 className="font-semibold text-slate-700 dark:text-slate-300 mb-3 text-sm flex items-center gap-2">
                        <div className="w-2 h-2 bg-blue-500 rounded-full" /> ลายเซ็นร้านซักรีด
                    </h4>
                    {batch.vendor_pickup_signature_url ? (
                        <div className="h-[120px] bg-white rounded-lg flex items-center justify-center border border-slate-100 dark:border-slate-800 p-2">
                            {/* eslint-disable-next-line @next/next/no-img-element */}
                            <img src={batch.vendor_pickup_signature_url} alt="Vendor Signature" className="max-h-full max-w-full object-contain mix-blend-multiply dark:invert" />
                        </div>
                    ) : (
                        <div className="h-[120px] bg-slate-50 dark:bg-slate-800/50 rounded-lg flex items-center justify-center text-slate-400 dark:text-slate-600 text-sm border border-slate-100 dark:border-slate-800">
                            ยังไม่มีลายเซ็น
                        </div>
                    )}
                    <p className="text-xs text-slate-500 dark:text-slate-400 mt-2 text-center">ชื่อผู้เซ็น: <span className="font-semibold text-slate-700 dark:text-slate-200">{batch.vendor_name || '-'}</span></p>
                </div>
                <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-4 shadow-sm">
                    <h4 className="font-semibold text-slate-700 dark:text-slate-300 mb-3 text-sm flex items-center gap-2">
                        <div className="w-2 h-2 bg-emerald-500 rounded-full" /> ลายเซ็น FO
                    </h4>
                    {batch.fo_return_signature_url ? (
                        <div className="h-[120px] bg-white rounded-lg flex items-center justify-center border border-slate-100 dark:border-slate-800 p-2">
                            {/* eslint-disable-next-line @next/next/no-img-element */}
                            <img src={batch.fo_return_signature_url} alt="FO Signature" className="max-h-full max-w-full object-contain mix-blend-multiply dark:invert" />
                        </div>
                    ) : (
                        <div className="h-[120px] bg-slate-50 dark:bg-slate-800/50 rounded-lg flex items-center justify-center text-slate-400 dark:text-slate-600 text-sm border border-slate-100 dark:border-slate-800">
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

function StatusBadge({ status }: { status: string }) {
    const map: Record<string, {label: string, color: string}> = {
        'draft': { label: 'ร่าง', color: 'bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-400' },
        'fo_dirty_counted': { label: 'รอนับคืน', color: 'bg-amber-100 dark:bg-amber-900/30 text-amber-700 dark:text-amber-400' },
        'fo_return_counted': { label: 'รอร้านเซ็น', color: 'bg-amber-100 dark:bg-amber-900/30 text-amber-700 dark:text-amber-400' },
        'vendor_signed': { label: 'ร้านเซ็นแล้ว', color: 'bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-400' },
        'fo_return_signed': { label: 'ส่งงานให้ร้าน', color: 'bg-emerald-100 dark:bg-emerald-950/20 text-emerald-700 dark:text-emerald-400' },
        'closed': { label: 'เสร็จสมบูรณ์', color: 'bg-emerald-100 dark:bg-emerald-950/20 text-emerald-700 dark:text-emerald-400' },
        'partial': { label: 'เสร็จ (มีค้าง)', color: 'bg-emerald-50 dark:bg-emerald-950/10 text-emerald-600 dark:text-emerald-300 border border-emerald-100 dark:border-emerald-900/50' },
        'disputed': { label: 'ยอดไม่ตรง', color: 'bg-rose-100 dark:bg-rose-950/30 text-rose-700 dark:text-rose-400' },
    };
    
    const s = map[status] || { label: status, color: 'bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300' };
    
    return (
        <span className={`inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-bold leading-none uppercase tracking-tight ${s.color}`}>
            {s.label}
        </span>
    );
}
