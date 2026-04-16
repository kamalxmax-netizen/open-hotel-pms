"use client";

import React, { useState } from "react";
import useSWR from "@/hooks/use-simple-swr";
import { format } from "date-fns";
import { th } from "date-fns/locale/th";
import type { LinenVendorView } from "@/lib/types";
import { apiDataFetcher } from "@/lib/client/api-fetcher";

export default function VendorDetailViewPage({ params }: { params: { token: string } }) {
    const { data, isLoading, mutate } = useSWR<LinenVendorView>(`/api/linen/vendor/${params.token}`, apiDataFetcher);
    const [isSubmitting, setIsSubmitting] = useState(false);

    if (isLoading) {
        return (
            <div className="min-h-screen bg-slate-50 flex items-center justify-center p-4">
                <div className="w-8 h-8 rounded-full border-4 border-slate-200 border-t-emerald-600 animate-spin" />
            </div>
        );
    }

    if (!data) {
        return (
            <div className="min-h-screen bg-slate-50 flex items-center justify-center p-4">
                <div className="bg-white p-8 rounded-2xl shadow-xl border border-slate-200 text-center max-w-sm w-full">
                    <div className="w-16 h-16 bg-rose-100 text-rose-500 rounded-full flex items-center justify-center mx-auto mb-4">
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="w-8 h-8"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>
                    </div>
                    <h2 className="text-xl font-bold text-slate-800 mb-2">เข้าถึงไม่ได้</h2>
                    <p className="text-slate-500">ลิงก์นี้ไม่ถูกต้อง หรือหมดอายุไปแล้ว</p>
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

    const dirtyTotal = data.items.filter(i => !i.is_dayuse).reduce((sum, item) => sum + item.sent_by_hotel, 0);
    const dayuseTotal = data.items.filter(i => i.is_dayuse).reduce((sum, item) => sum + item.sent_by_hotel, 0);
    const returnTotal = data.return_items.reduce((sum, item) => sum + item.received_back, 0);

    return (
        <div className="min-h-screen bg-slate-50 dark:bg-slate-950 text-slate-900 dark:text-slate-100 pb-20 font-sans transition-colors">
            <div className="bg-[#1B4038] px-6 py-8 text-white rounded-b-[2rem] shadow-md">
                <h1 className="text-2xl font-bold">สรุปรายการรับ-ส่งผ้า</h1>
                <p className="text-[#1B4038] bg-emerald-100/20 inline-block px-3 py-1 rounded-full text-sm mt-3 border border-emerald-100/30">
                    โรงแรม {data.hotel_name}
                </p>
                <p className="text-emerald-100 mt-2 flex items-center gap-2 text-sm">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="w-4 h-4"><rect x="3" y="4" width="18" height="18" rx="2" ry="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg>
                    วันที่ {format(new Date(data.batch.business_date), "dd MMMM yyyy", { locale: th })} (รอบ {data.batch.pickup_round})
                </p>
            </div>

            <div className="max-w-md mx-auto -mt-6 px-4">
                {data.status === "disputed" && (
                    <div className="bg-rose-100 dark:bg-rose-950/30 border-2 border-rose-200 dark:border-rose-900 text-rose-800 dark:text-rose-300 p-4 rounded-2xl shadow-lg mb-6 flex gap-3">
                        <div className="text-2xl">⚠️</div>
                        <div>
                            <h3 className="font-bold">แจ้งยอดไม่ตรงแล้ว</h3>
                            <p className="text-sm mt-0.5 text-rose-700 dark:text-rose-400">ระบบได้แจ้งให้โรงแรมทราบแล้ว โปรดรอการติดต่อกลับเพื่อแก้ไขยอด</p>
                        </div>
                    </div>
                )}
                
                {(data.status === "closed" || data.status === "partial") && (
                    <div className="bg-emerald-100 dark:bg-emerald-950/30 border-2 border-emerald-200 dark:border-emerald-900 text-emerald-800 dark:text-emerald-300 p-4 rounded-2xl shadow-lg mb-6 flex gap-3">
                        <div className="text-2xl">✅</div>
                        <div>
                            <h3 className="font-bold">ยืนยันรายการสำเร็จ</h3>
                            <p className="text-sm mt-0.5 text-emerald-700 dark:text-emerald-400">ขอบคุณค่ะ ระบบได้บันทึกการยืนยันของคุณเรียบร้อยแล้ว</p>
                        </div>
                    </div>
                )}

                <div className="bg-white dark:bg-slate-900 rounded-3xl p-6 shadow-[0_8px_30px_rgb(0,0,0,0.04)] dark:shadow-none border border-slate-100 dark:border-slate-800 mb-6">
                    <div className="space-y-6">
                        
                        {/* ผ้าเปื้อน Section */}
                        <div className="mb-2">
                           <div className="flex justify-between items-end border-b border-slate-100 dark:border-slate-800 pb-2 mb-3">
                               <h3 className="font-bold text-slate-800 dark:text-slate-200 flex items-center gap-2">
                                   <div className="w-2 h-2 bg-blue-500 rounded-full"/>
                                   ผ้าเปื้อนที่รับเข้าร้าน
                               </h3>
                               <span className="font-bold text-blue-600 dark:text-blue-400 text-lg">{dirtyTotal} ชิ้น</span>
                           </div>
                           <div className="space-y-2">
                               {data.items.filter(i => !i.is_dayuse && i.sent_by_hotel > 0).map(i => (
                                   <div key={i.linen_item_id} className="flex justify-between text-sm text-slate-600 dark:text-slate-400 pl-4">
                                       <span>{i.name_th}</span>
                                       <span className="font-bold text-slate-700 dark:text-slate-300">{i.sent_by_hotel}</span>
                                   </div>
                               ))}
                           </div>
                        </div>

                        {/* ผ้าเก่า (Dayuse) Section */}
                        {dayuseTotal > 0 && (
                            <div className="mb-2">
                               <div className="flex justify-between items-end border-b border-slate-100 dark:border-slate-800 pb-2 mb-3">
                                   <h3 className="font-bold text-slate-800 dark:text-slate-200 flex items-center gap-2">
                                       <div className="w-2 h-2 bg-amber-500 rounded-full"/>
                                       ผ้าเก่าที่รับเข้าร้าน
                                   </h3>
                                   <span className="font-bold text-amber-600 dark:text-amber-400 text-lg">{dayuseTotal} ชิ้น</span>
                               </div>
                               <div className="space-y-2">
                                   {data.items.filter(i => i.is_dayuse && i.sent_by_hotel > 0).map(i => (
                                       <div key={`du-${i.linen_item_id}`} className="flex justify-between text-sm text-slate-600 dark:text-slate-400 pl-4">
                                           <span>{i.name_th}</span>
                                           <span className="font-bold text-slate-700 dark:text-slate-300">{i.sent_by_hotel}</span>
                                       </div>
                                   ))}
                               </div>
                            </div>
                        )}

                        {/* คืนผ้า Section */}
                        <div className="mb-2">
                           <div className="flex justify-between items-end border-b border-slate-100 dark:border-slate-800 pb-2 mb-3">
                               <h3 className="font-bold text-slate-800 dark:text-slate-200 flex items-center gap-2">
                                   <div className="w-2 h-2 bg-emerald-500 rounded-full"/>
                                   ผ้ารับคืน (สะอาด)
                               </h3>
                               <span className="font-bold text-emerald-600 dark:text-emerald-400 text-lg">{returnTotal} ชิ้น</span>
                           </div>
                           {data.return_items.length === 0 ? (
                               <p className="text-sm text-slate-400 dark:text-slate-600 pl-4 italic">ไม่มียอดส่งคืนในรอบนี้</p>
                           ) : (
                               <div className="space-y-2">
                                   {data.return_items.filter(i => i.received_back > 0).map(i => (
                                       <div key={`ret-${i.linen_item_id}`} className="flex justify-between text-sm text-slate-600 dark:text-slate-400 pl-4">
                                           <span>{i.name_th}</span>
                                           <span className="font-bold text-slate-700 dark:text-slate-300">{i.received_back}</span>
                                       </div>
                                   ))}
                               </div>
                           )}
                        </div>

                        {/* ยอดค้าง */}
                        {data.pending_items.length > 0 && (
                            <div className="bg-slate-50 dark:bg-slate-800/50 p-4 rounded-xl border border-slate-200 dark:border-slate-800 mt-4">
                                <h3 className="font-bold text-slate-800 dark:text-slate-200 flex items-center gap-2 mb-2 text-sm">
                                    <span className="text-base">⚠️</span> ยอดค้างส่งคืนโรงแรม
                                </h3>
                                <div className="space-y-1 pl-6">
                                    {data.pending_items.map(p => (
                                        <div key={p.id} className="flex justify-between text-xs text-slate-600 dark:text-slate-400">
                                            <span>{p.name_th}</span>
                                            <span className="font-bold text-rose-600 dark:text-rose-400">{p.pending_qty} ชิ้น</span>
                                        </div>
                                    ))}
                                </div>
                            </div>
                        )}

                    </div>
                </div>

                {!isResolved && (
                    <div className="flex flex-col gap-3">
                       <button
                           onClick={handleConfirm}
                           disabled={isSubmitting}
                           className="w-full bg-[#1B4038] text-white py-4 rounded-2xl font-bold text-lg shadow-[0_8px_20px_rgba(27,64,56,0.3)] hover:bg-[#122b26] transition-all flex items-center justify-center gap-2 focus:outline-none focus:ring-4 focus:ring-[#1B4038]/30"
                       >
                           {isSubmitting ? "กำลังบันทึก..." : (
                               <>
                                   <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" className="w-6 h-6"><polyline points="20 6 9 17 4 12"/></svg>
                                   ยอดทั้งหมดถูกต้อง ยืนยันรับผ้า
                               </>
                           )}
                       </button>

                       <button
                           onClick={handleDispute}
                           disabled={isSubmitting}
                           className="w-full bg-white dark:bg-slate-900 text-slate-500 dark:text-slate-400 hover:bg-slate-50 dark:hover:bg-slate-800 border border-slate-200 dark:border-slate-800 py-4 rounded-2xl font-bold transition-all disabled:opacity-50"
                       >
                           หากยอดไม่ตรง กดที่นี่เพื่อแจ้งโรงแรม
                       </button>
                    </div>
                )}
            </div>
        </div>
    );
}
