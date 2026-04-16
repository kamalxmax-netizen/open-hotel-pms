"use client";

import React, { useState, useEffect } from "react";
import Link from "next/link";
import { format } from "date-fns";
import { th } from "date-fns/locale/th";
import { useLinenDashboard } from "@/hooks/use-linen-dashboard";

export default function LinenMobileDashboard() {
    const { dashboard, isLoading, mutate } = useLinenDashboard();
    const [drafts, setDrafts] = useState<any[]>([]);

    useEffect(() => {
        if (!dashboard?.business_date) return;
        
        // Find drafts in localStorage
        const keys = Object.keys(localStorage).filter(k => k.startsWith("linen_draft_"));
        const foundDrafts = keys.map(k => {
            const data = JSON.parse(localStorage.getItem(k) || "{}");
            // key format: linen_draft_YYYY-MM-DD_ROUND
            const parts = k.split("_");
            return {
                key: k,
                business_date: parts[2],
                round: parts[3],
                ...data
            };
        });
        setDrafts(foundDrafts);
    }, [dashboard]);

    const handleDeleteDraft = (e: React.MouseEvent, key: string) => {
        e.preventDefault();
        e.stopPropagation();
        if (confirm("ลบรายการร่างนี้หรือไม่?")) {
            localStorage.removeItem(key);
            setDrafts(prev => prev.filter(d => d.key !== key));
        }
    };

    const todayDisplay = format(new Date(), "EEEE d MMMM", { locale: th });

    if (isLoading) {
        return <div className="p-8 text-center text-slate-400 font-thai animate-pulse">กำลังโหลด...</div>;
    }

    return (
        <div className="p-5 pb-24 max-w-lg mx-auto">
            <header className="mb-8">
                <div className="flex items-center justify-between mb-2">
                    <h1 className="text-2xl font-black text-slate-900 dark:text-slate-100 font-thai tracking-tight uppercase">Linen & Laundry</h1>
                    <div className="w-10 h-10 rounded-full bg-[#1B4038]/10 dark:bg-emerald-500/10 flex items-center justify-center text-[#1B4038] dark:text-emerald-400">
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" className="w-5 h-5"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>
                    </div>
                </div>
                <p className="text-slate-500 dark:text-slate-400 font-thai font-medium">{todayDisplay}</p>
            </header>

            <section className="mb-10">
                <Link 
                    href="/linen-mobile/batch/new"
                    className="w-full py-5 bg-[#1B4038] dark:bg-emerald-600 text-white rounded-[2rem] shadow-[0_12px_30px_rgba(27,64,56,0.3)] dark:shadow-[0_12px_30px_rgba(16,185,129,0.15)] flex flex-col items-center justify-center gap-2 active:scale-95 active:shadow-sm transition-all text-xl font-bold font-thai border-b-4 border-[#122b26] dark:border-emerald-800"
                >
                    <div className="w-14 h-14 bg-white/10 rounded-2xl flex items-center justify-center mb-1">
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" className="w-7 h-7 text-white"><path d="M12 5v14M5 12h14"/></svg>
                    </div>
                    เริ่มนับผ้ารอบใหม่
                </Link>
            </section>

            {drafts.length > 0 && (
                <section className="mb-8">
                    <h2 className="text-xs font-bold text-slate-400 uppercase tracking-widest mb-4 flex items-center gap-2">
                        <div className="w-1.5 h-1.5 rounded-full bg-amber-500" />
                        รายการร่าง (Drafts)
                    </h2>
                    <div className="space-y-3">
                        {drafts.map(draft => (
                            <Link 
                                key={draft.key}
                                href={`/linen-mobile/batch/new?draft=${draft.key}`}
                                className="block bg-white dark:bg-slate-900 p-4 rounded-2xl border border-slate-200 dark:border-slate-800 shadow-sm active:bg-slate-50 dark:active:bg-slate-800 transition-all group"
                            >
                                <div className="flex justify-between items-center">
                                    <div className="flex items-center gap-3">
                                        <div className="w-10 h-10 bg-amber-50 dark:bg-amber-500/10 rounded-xl flex items-center justify-center text-amber-600 dark:text-amber-400">
                                            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" className="w-5 h-5"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
                                        </div>
                                        <div>
                                            <p className="font-bold text-slate-800 dark:text-slate-200 font-thai uppercase">รอบที่ {draft.round}</p>
                                            <p className="text-xs text-slate-400 dark:text-slate-500 font-thai">รอยืนยัน • {new Date(draft.timestamp).toLocaleTimeString('th-TH', { hour: '2-digit', minute: '2-digit' })} น.</p>
                                        </div>
                                    </div>
                                    <button 
                                        onClick={(e) => handleDeleteDraft(e, draft.key)}
                                        className="p-2 text-slate-300 dark:text-slate-700 hover:text-rose-500 transition-colors"
                                    >
                                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="w-5 h-5"><path d="M3 6h18M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2M10 11v6M14 11v6"/></svg>
                                    </button>
                                </div>
                            </Link>
                        ))}
                    </div>
                </section>
            )}

            <section>
                <h2 className="text-xs font-bold text-slate-400 uppercase tracking-widest mb-4 flex items-center gap-2">
                    <div className="w-1.5 h-1.5 rounded-full bg-emerald-500" />
                    รายการวันนี้ ({dashboard?.batches_today?.length || 0})
                </h2>
                <div className="space-y-3">
                    {dashboard?.batches_today?.map(batch => (
                        <Link 
                            key={batch.id}
                            href={`/linen-mobile/batch/${batch.id}`}
                            className="block bg-white dark:bg-slate-900 p-4 rounded-2xl border border-slate-200 dark:border-slate-800 shadow-sm active:bg-slate-50 dark:active:bg-slate-800 transition-all group"
                        >
                            <div className="flex justify-between items-center">
                                <div className="flex items-center gap-3">
                                    <div className="w-10 h-10 bg-[#1B4038]/10 dark:bg-emerald-500/10 rounded-xl flex items-center justify-center text-[#1B4038] dark:text-emerald-400">
                                        <span className="font-black text-xs">R{batch.pickup_round}</span>
                                    </div>
                                    <div>
                                        <p className="font-bold text-slate-800 dark:text-slate-200 font-thai uppercase">รอบที่ {batch.pickup_round}</p>
                                        <p className="text-[10px] text-slate-400 dark:text-slate-500 font-thai font-black uppercase tracking-tighter bg-slate-50 dark:bg-slate-800 px-1.5 py-0.5 rounded ml-[-1px]">{batch.status.replace(/_/g, ' ')}</p>
                                    </div>
                                </div>
                                <div className="w-8 h-8 rounded-full bg-slate-50 dark:bg-slate-800 flex items-center justify-center text-slate-300 dark:text-slate-600 group-active:text-[#1B4038] dark:group-active:text-emerald-400 transition-colors">
                                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" className="w-4 h-4"><path d="M9 18l6-6-6-6"/></svg>
                                </div>
                            </div>
                        </Link>
                    ))}
                    {!dashboard?.batches_today?.length && (
                        <div className="py-10 text-center bg-slate-50/50 dark:bg-slate-900/50 rounded-[2rem] border-2 border-dashed border-slate-200 dark:border-slate-800">
                            <p className="text-sm text-slate-400 dark:text-slate-600 font-thai tracking-tight font-medium">ไม่มีรายการรับ-ส่งย้อนหลังของวันนี้</p>
                        </div>
                    )}
                </div>
            </section>
        </div>
    );
}
