"use client";

import React, { useState } from "react";
import useSWR from "@/hooks/use-simple-swr";
import { format } from "date-fns";
import { th } from "date-fns/locale/th";
import type { LinenVendorView } from "@/lib/types";
import { apiDataFetcher } from "@/lib/client/api-fetcher";

import { MobileBatchStepSummary } from "@/components/linen/mobile-batch-step-summary";

export default function VendorDetailViewPage({ params }: { params: { token: string } }) {
    const { data, isLoading, mutate } = useSWR<LinenVendorView>(`/api/linen/vendor/${params.token}`, apiDataFetcher);
    const [isSubmitting, setIsSubmitting] = useState(false);

    if (isLoading) {
        return (
            <div className="min-h-screen bg-slate-50 dark:bg-slate-950 flex items-center justify-center p-4">
                <div className="w-10 h-10 rounded-full border-4 border-slate-200 dark:border-slate-800 border-t-[#1B4038] dark:border-t-emerald-500 animate-spin" />
            </div>
        );
    }

    if (!data) {
        return (
            <div className="min-h-screen bg-slate-50 dark:bg-slate-950 flex items-center justify-center p-4">
                <div className="bg-white dark:bg-slate-900 p-8 rounded-3xl shadow-xl border border-slate-200 dark:border-slate-800 text-center max-w-sm w-full animate-in zoom-in-95 duration-300">
                    <div className="w-16 h-16 bg-rose-50 dark:bg-rose-500/10 text-rose-500 rounded-full flex items-center justify-center mx-auto mb-4 border border-rose-100 dark:border-rose-500/20 shadow-sm">
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" className="w-8 h-8"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>
                    </div>
                    <h2 className="text-xl font-bold text-slate-800 dark:text-slate-100 mb-2 font-thai">เข้าถึงไม่สำเร็จ</h2>
                    <p className="text-slate-400 dark:text-slate-500 font-thai">ลิงก์นี้ไม่ถูกต้อง หรือหมดอายุไปแล้ว</p>
                </div>
            </div>
        );
    }

    const handleConfirm = async () => {
        if (!confirm("คุณยืนยันว่าได้รับผ้า และยอดทั้งหมดถูกต้องตรงกันใช่หรือไม่?")) return;
        setIsSubmitting(true);
        try {
            const res = await fetch(`/api/linen/vendor/${params.token}/confirm`, { method: "POST" });
            if (!res.ok) throw new Error("Failed to confirm");
            mutate();
        } catch (err) {
            console.error(err);
            alert("เกิดข้อผิดพลาด กรุณาลองใหม่");
        } finally {
            setIsSubmitting(false);
        }
    };

    const handleDispute = async () => {
        if (!confirm("คุณแน่ใจว่ายอดไม่ตรงกัน? ระบบจะแจ้งเตือนให้ทางโรงแรมตรวจสอบใหม่")) return;
        setIsSubmitting(true);
        try {
            const res = await fetch(`/api/linen/vendor/${params.token}/dispute`, { method: "POST" });
            if (!res.ok) throw new Error("Failed to dispute");
            mutate();
        } catch (err) {
            console.error(err);
            alert("เกิดข้อผิดพลาด กรุณาลองใหม่");
        } finally {
            setIsSubmitting(false);
        }
    };

    const isResolved = data.status === "closed" || data.status === "partial" || data.status === "disputed";

    const dirtyItems = data.items.filter(i => !i.is_dayuse && i.sent_by_hotel > 0).map(i => ({ name: i.name_th ?? `Item ${i.linen_item_id}`, qty: i.sent_by_hotel }));
    const dayuseItems = data.items.filter(i => i.is_dayuse && i.sent_by_hotel > 0).map(i => ({ name: i.name_th ?? `Item ${i.linen_item_id}`, qty: i.sent_by_hotel }));
    const returnItems = data.return_items.filter(i => i.received_back > 0).map(i => ({ name: i.name_th ?? `Item ${i.linen_item_id}`, qty: i.received_back }));

    return (
        <div className="min-h-screen bg-slate-50 dark:bg-slate-950 text-slate-900 dark:text-slate-100 pb-20 font-sans transition-colors">
            <div className="bg-[#1B4038] px-6 pt-10 pb-12 text-white rounded-b-[3rem] shadow-lg relative overflow-hidden">
                <div className="absolute top-0 right-0 p-8 opacity-10">
                    <svg viewBox="0 0 24 24" fill="currentColor" className="w-48 h-48"><path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z"/></svg>
                </div>
                <div className="relative z-10">
                    <h1 className="text-2xl font-black font-thai">สรุปรายการรับ-ส่งผ้า</h1>
                    <div className="flex items-center gap-2 mt-3">
                         <div className="px-3 py-1 bg-white/10 rounded-full border border-white/20 text-sm font-bold font-thai">
                            โรงแรม {data.hotel_name}
                         </div>
                    </div>
                    <p className="text-emerald-100/70 mt-4 flex items-center gap-2 text-sm font-medium">
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" className="w-4 h-4"><rect x="3" y="4" width="18" height="18" rx="2" ry="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg>
                        วันที่ {format(new Date(data.batch.business_date), "dd MMM yyyy", { locale: th })} (รอบ {data.batch.pickup_round})
                    </p>
                </div>
            </div>

            <div className="max-w-lg mx-auto -mt-8 px-5">
                {data.status === "disputed" && (
                    <div className="bg-rose-50 dark:bg-rose-500/10 border-2 border-rose-100 dark:border-rose-500/20 text-rose-800 dark:text-rose-300 p-5 rounded-3xl shadow-sm mb-6 flex gap-4 animate-in slide-in-from-top-4">
                        <div className="w-12 h-12 bg-white dark:bg-slate-800 rounded-2xl flex items-center justify-center text-rose-500 shrink-0 shadow-sm">⚠️</div>
                        <div>
                            <h3 className="font-bold font-thai uppercase">แจ้งยอดไม่ตรงแล้ว</h3>
                            <p className="text-xs mt-1 text-rose-600 dark:text-rose-400 font-thai leading-relaxed">ระบบแจ้งทางโรงแรมแล้ว โปรดรอการติดต่อกลับเพื่อแก้ไขยอดส่งซัก</p>
                        </div>
                    </div>
                )}
                
                {(data.status === "closed" || data.status === "partial") && (
                    <div className="bg-emerald-50 dark:bg-emerald-500/10 border-2 border-emerald-100 dark:border-emerald-500/20 text-emerald-800 dark:text-emerald-300 p-5 rounded-3xl shadow-sm mb-6 flex gap-4 animate-in slide-in-from-top-4">
                        <div className="w-12 h-12 bg-white dark:bg-slate-800 rounded-2xl flex items-center justify-center text-emerald-500 shrink-0 shadow-sm">✅</div>
                        <div>
                            <h3 className="font-bold font-thai uppercase">ยืนยันรายการสำเร็จ</h3>
                            <p className="text-xs mt-1 text-emerald-600 dark:text-emerald-400 font-thai leading-relaxed">ขอบคุณค่ะ ระบบได้บันทึกการยืนยันของคุณเรียบร้อยแล้ว</p>
                        </div>
                    </div>
                )}

                <div className="space-y-4">
                    <MobileBatchStepSummary title="ผ้าวันนี้" items={dirtyItems} />
                    <MobileBatchStepSummary title="ผ้าเก่า" items={dayuseItems} />
                    <MobileBatchStepSummary title="ผ้ารับคืน" items={returnItems} totalLabel="รวมรับคืน" />

                    {data.pending_items.length > 0 && (
                        <div className="bg-slate-900 dark:bg-slate-900 text-white p-6 rounded-[2rem] shadow-xl border border-slate-800 dark:border-slate-800 mt-6 relative overflow-hidden">
                             <div className="absolute top-0 right-0 p-4 opacity-20 rotate-12">
                                <svg viewBox="0 0 24 24" fill="currentColor" className="w-20 h-20"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>
                             </div>
                             <div className="relative z-10">
                                <h3 className="font-bold flex items-center gap-2 mb-4 text-sm uppercase tracking-widest text-amber-400">
                                    ยอดค้างส่งคืนโรงแรม
                                </h3>
                                <div className="space-y-3">
                                    {data.pending_items.map(p => (
                                        <div key={p.id} className="flex justify-between items-end border-b border-white/10 pb-2">
                                            <span className="text-sm font-thai text-slate-300">{p.name_th}</span>
                                            <span className="font-bold text-amber-500 text-lg">{p.pending_qty} <span className="text-xs font-medium text-slate-500">ชิ้น</span></span>
                                        </div>
                                    ))}
                                </div>
                             </div>
                        </div>
                    )}
                </div>

                {!isResolved && (
                    <div className="flex flex-col gap-3 mt-10">
                       <button
                           onClick={handleConfirm}
                           disabled={isSubmitting}
                           className="w-full bg-[#1B4038] dark:bg-emerald-600 text-white py-5 rounded-3xl font-bold text-xl shadow-[0_12px_30px_rgba(27,64,56,0.3)] active:scale-95 active:shadow-sm transition-all flex items-center justify-center gap-3 border-b-4 border-[#122b26] dark:border-emerald-800"
                       >
                           {isSubmitting ? (
                               <div className="w-6 h-6 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                           ) : (
                               <>
                                   ยอดถูกต้อง ยืนยันรับผ้า
                                   <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" className="w-6 h-6"><polyline points="20 6 9 17 4 12"/></svg>
                               </>
                           )}
                       </button>
 
                       <button
                           onClick={handleDispute}
                           disabled={isSubmitting}
                           className="w-full bg-white dark:bg-slate-900 text-slate-400 dark:text-slate-500 py-4 rounded-3xl font-bold text-sm border border-slate-200 dark:border-slate-800 active:bg-slate-50 dark:active:bg-slate-800 transition-all font-thai"
                       >
                           หากยอดไม่ตรง กรุณากดที่นี่เพื่อแจ้งโรงแรม
                       </button>
                    </div>
                )}
            </div>

            <footer className="mt-12 text-center text-[10px] text-slate-300 font-thai uppercase tracking-tighter">
                Hotel Laundry System • Vendor Portal
            </footer>
        </div>
    );
}
