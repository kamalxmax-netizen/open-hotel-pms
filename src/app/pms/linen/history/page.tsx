"use client";

import React, { Suspense, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useLinenBatches, useLinenAuditLogs } from "@/hooks/use-linen-batch";
import { LinenHistoryFilterBar } from "./_components/LinenHistoryFilterBar";
import { LinenHistoryTable } from "./_components/LinenHistoryTable";
import { LinenHistoryEditModal } from "./_components/LinenHistoryEditModal";
import { ArrowLeft, History, Edit2, Clock, User } from "lucide-react";
import { format } from "date-fns";
import { th } from "date-fns/locale/th";
import type { LaundryBatch } from "@/lib/types";

function LinenHistoryPageInner() {
    const searchParams = useSearchParams();
    const [filters, setFilters] = useState<any>(() => ({
        date_from: "",
        date_to: "",
        status: "",
        has_rewash: false,
        has_extras: false,
        has_edits: searchParams.get("has_edits") === "1" || searchParams.get("has_edits") === "true",
        search: ""
    }));

    const { batches, isLoading, mutate } = useLinenBatches(filters);
    const [selectedBatch, setSelectedBatch] = useState<LaundryBatch | null>(null);
    const [isEditModalOpen, setIsEditModalOpen] = useState(false);

    // Fetch audit logs for the selected batch
    const { logs: auditLogs, mutate: mutateLogs } = useLinenAuditLogs(selectedBatch?.id);

    return (
        <div className="p-4 md:p-8 max-w-7xl mx-auto pb-20">
            {/* Header ... */}
            <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 mb-8">
                <div className="flex items-center gap-4">
                    <Link 
                        href="/pms/linen"
                        className="w-12 h-12 rounded-2xl bg-white dark:bg-slate-900 flex items-center justify-center text-slate-500 dark:text-slate-400 hover:bg-slate-50 dark:hover:bg-slate-800 border border-slate-200 dark:border-slate-800 transition-all shadow-sm hover:scale-110 active:scale-95"
                    >
                        <ArrowLeft className="w-6 h-6" />
                    </Link>
                    <div>
                        <div className="flex items-center gap-2 mb-1">
                            <History className="w-5 h-5 text-emerald-500" />
                            <h1 className="text-2xl font-black text-slate-900 dark:text-slate-100 font-thai tracking-tight uppercase">History & Audit</h1>
                        </div>
                        <p className="text-sm text-slate-500 dark:text-slate-400 font-thai">ประวัติการรับ-ส่งผ้าและบันทึกการแก้ไขย้อนหลัง</p>
                    </div>
                </div>

                <div className="flex items-center gap-2 px-4 py-2 bg-emerald-50 dark:bg-emerald-900/10 rounded-xl border border-emerald-100 dark:border-emerald-800/50">
                    <div className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
                    <span className="text-xs font-bold text-emerald-700 dark:text-emerald-400 font-thai uppercase tracking-wider">
                        {batches.length} Records Found
                    </span>
                </div>
            </div>

            <LinenHistoryFilterBar filters={filters} setFilters={setFilters} />

            <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
                <div className={`${selectedBatch ? 'lg:col-span-8' : 'lg:col-span-12'} transition-all duration-300`}>
                    <LinenHistoryTable 
                        batches={batches} 
                        isLoading={isLoading} 
                        onViewDetail={setSelectedBatch} 
                    />
                </div>

                {selectedBatch && (
                    <div className="lg:col-span-4 sticky top-24 animate-in slide-in-from-right duration-300">
                        <div className="bg-white dark:bg-slate-900 rounded-3xl border-2 border-emerald-100 dark:border-emerald-900/30 shadow-2xl overflow-hidden flex flex-col h-[75vh]">
                            <div className="p-6 border-b border-slate-50 dark:border-slate-800 flex justify-between items-center bg-slate-50/50 dark:bg-slate-800/20">
                                <h3 className="font-black text-slate-900 dark:text-slate-100 font-thai uppercase italic underline decoration-emerald-500 decoration-2 underline-offset-4">Batch Details</h3>
                                <button 
                                    onClick={() => setSelectedBatch(null)}
                                    className="w-8 h-8 rounded-full bg-white dark:bg-slate-800 flex items-center justify-center text-slate-400 hover:text-slate-600 transition-colors shadow-sm"
                                >
                                    <X size={16} />
                                </button>
                            </div>
                            
                            <div className="flex-1 overflow-y-auto p-6 space-y-6 scrollbar-thin">
                                <section>
                                    <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-2">Summary</p>
                                    <div className="bg-slate-50 dark:bg-slate-800/50 rounded-2xl p-4 space-y-3">
                                        <div className="flex justify-between text-sm">
                                            <span className="text-slate-500 font-thai">Batch ID</span>
                                            <span className="font-mono font-bold text-slate-900 dark:text-slate-100">#{selectedBatch.id.substring(0, 8)}</span>
                                        </div>
                                        <div className="flex justify-between text-sm">
                                            <span className="text-slate-500 font-thai">วันที่</span>
                                            <span className="font-bold text-slate-900 dark:text-slate-100 font-thai">{selectedBatch.business_date}</span>
                                        </div>
                                        <div className="flex justify-between text-sm">
                                            <span className="text-slate-500 font-thai">รอบ</span>
                                            <span className="font-bold text-slate-900 dark:text-slate-100 font-thai">{selectedBatch.pickup_round}</span>
                                        </div>
                                    </div>
                                </section>

                                <div className="grid grid-cols-2 gap-3">
                                    <div className="p-4 bg-emerald-600 rounded-2xl text-white shadow-lg shadow-emerald-500/20 text-center">
                                        <p className="text-[10px] font-bold opacity-70 uppercase tracking-widest mb-1">Items Sent</p>
                                        <p className="text-3xl font-black">{selectedBatch.total_sent || 0}</p>
                                    </div>
                                    <button 
                                        onClick={() => setIsEditModalOpen(true)}
                                        className="p-4 bg-amber-50 dark:bg-amber-900/20 rounded-2xl text-amber-600 border border-amber-100 dark:border-amber-800 flex flex-col items-center justify-center gap-1 hover:bg-amber-100 transition-all active:scale-95"
                                    >
                                        <Edit2 size={20} />
                                        <span className="text-[10px] font-black uppercase tracking-widest">Audit Edit</span>
                                    </button>
                                </div>

                                <section>
                                    <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-2 flex items-center gap-2">
                                        <Clock size={12} /> Audit Log (History)
                                    </p>
                                    <div className="space-y-3">
                                        {auditLogs.length === 0 ? (
                                            <div className="p-4 border border-dashed border-slate-200 dark:border-slate-800 rounded-2xl text-center text-slate-400 font-thai text-xs">
                                                No audit records yet
                                            </div>
                                        ) : (
                                            auditLogs.map((log) => (
                                                <div key={log.id} className="bg-slate-50 dark:bg-slate-800/30 rounded-2xl p-4 border border-slate-100 dark:border-slate-800">
                                                    <div className="flex justify-between items-start mb-2">
                                                        <div className="flex items-center gap-2">
                                                            <div className="w-6 h-6 rounded-full bg-slate-200 dark:bg-slate-700 flex items-center justify-center">
                                                                <User size={12} className="text-slate-500" />
                                                            </div>
                                                            <span className="text-[10px] font-bold text-slate-600 dark:text-slate-300">ADMIN</span>
                                                        </div>
                                                        <span className="text-[10px] text-slate-400 font-mono">
                                                            {format(new Date(log.edited_at), "HH:mm", { locale: th })}
                                                        </span>
                                                    </div>
                                                    <p className="text-[11px] font-bold text-slate-900 dark:text-slate-100 font-thai leading-tight mb-1">
                                                        {log.field_name}: <span className="text-slate-400 line-through">{log.old_value}</span> → <span className="text-emerald-500">{log.new_value}</span>
                                                    </p>
                                                    <p className="text-[10px] text-slate-500 italic font-thai bg-white dark:bg-slate-800 px-2 py-1 rounded-lg border border-slate-100 dark:border-slate-700 mt-2">
                                                        "{log.reason}"
                                                    </p>
                                                </div>
                                            ))
                                        )}
                                    </div>
                                </section>

                                <Link 
                                    href={`/pms/linen/batch/${selectedBatch.id}`}
                                    className="block w-full py-4 bg-slate-900 dark:bg-white text-white dark:text-slate-900 rounded-2xl font-black text-center text-[11px] uppercase tracking-widest shadow-xl active:scale-95 transition-all"
                                >
                                    View Full Report
                                </Link>
                            </div>
                        </div>
                    </div>
                )}
            </div>

            {isEditModalOpen && selectedBatch && (
                <LinenHistoryEditModal 
                    batchId={selectedBatch.id} 
                    onClose={() => setIsEditModalOpen(false)}
                    onSuccess={() => {
                        setIsEditModalOpen(false);
                        mutate();
                        mutateLogs();
                    }}
                />
            )}
        </div>
    );
}

export default function LinenHistoryPage() {
    return (
        <Suspense fallback={<div className="p-4 md:p-8 max-w-7xl mx-auto pb-20" />}>
            <LinenHistoryPageInner />
        </Suspense>
    );
}

function X({ size }: { size: number }) {
    return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" className="w-4 h-4" style={{ width: size, height: size }}><path d="M18 6L6 18M6 6l12 12"/></svg>;
}
