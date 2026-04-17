"use client";

import React, { useState } from "react";
import { format } from "date-fns";
import { th } from "date-fns/locale/th";
import { History, Edit3, RefreshCw, ChevronRight } from "lucide-react";

interface LinenRecentActivityProps {
    batches: any[];
    edits: any[];
    rewash: any[];
    isLoading: boolean;
}

export function LinenRecentActivity({ batches, edits, rewash, isLoading }: LinenRecentActivityProps) {
    const [activeTab, setActiveTab] = useState<'batches' | 'edits' | 'rewash'>('batches');

    const tabs = [
        { id: 'batches', label: '10 Batch ล่าสุด', icon: History },
        { id: 'edits', label: 'การแก้ไขล่าสุด', icon: Edit3 },
        { id: 'rewash', label: 'Rewash ล่าสุด', icon: RefreshCw },
    ] as const;

    const renderContent = () => {
        if (isLoading) {
            return (
                <div className="py-20 text-center text-slate-400 animate-pulse font-thai">
                    กำลังโหลดข้อมูลกิจกรรม...
                </div>
            );
        }

        switch (activeTab) {
            case 'batches':
                return (
                    <div className="divide-y divide-slate-100 dark:divide-slate-800">
                        {batches.length > 0 ? (
                            batches.map((batch) => (
                                <div key={batch.id} className="p-4 flex items-center justify-between hover:bg-slate-50 dark:hover:bg-slate-800/50 transition-colors cursor-pointer group">
                                    <div className="flex items-center gap-4">
                                        <div className="w-10 h-10 rounded-full bg-[#1B4038]/10 text-[#1B4038] dark:bg-emerald-500/20 dark:text-emerald-400 flex items-center justify-center font-bold text-sm">
                                            R{batch.pickup_round}
                                        </div>
                                        <div>
                                            <p className="text-sm font-bold text-slate-800 dark:text-slate-200 font-thai">
                                                วันที่ {format(new Date(batch.business_date), 'dd/MM/yyyy')} รอบที่ {batch.pickup_round}
                                            </p>
                                            <div className="flex items-center gap-2 mt-1">
                                                <StatusBadge status={batch.status} />
                                                <span className="text-[10px] text-slate-400 uppercase font-bold tracking-wider">
                                                    {batch.id.substring(0, 8)}
                                                </span>
                                            </div>
                                        </div>
                                    </div>
                                    <ChevronRight className="w-5 h-5 text-slate-300 group-hover:text-slate-500 transition-colors" />
                                </div>
                            ))
                        ) : (
                            <div className="py-12 text-center text-slate-400 font-thai">ไม่มีรายการ Batch</div>
                        )}
                    </div>
                );
            case 'edits':
                return (
                    <div className="divide-y divide-slate-100 dark:divide-slate-800">
                        {edits.length > 0 ? (
                            edits.map((edit) => (
                                <div key={edit.id} className="p-4 hover:bg-slate-50 dark:hover:bg-slate-800/50 transition-colors cursor-pointer group">
                                    <div className="flex items-start gap-4">
                                        <div className="w-8 h-8 rounded-lg bg-blue-50 dark:bg-blue-500/10 text-blue-600 dark:text-blue-400 flex items-center justify-center shrink-0">
                                            <Edit3 className="w-4 h-4" />
                                        </div>
                                        <div className="flex-1">
                                            <div className="flex items-center justify-between mb-1">
                                                <p className="text-xs font-bold text-slate-800 dark:text-slate-200 font-thai">
                                                    แก้ไข Batch #{edit.batch_id.substring(0, 8)}
                                                </p>
                                                <span className="text-[10px] text-slate-400 font-medium">
                                                    {format(new Date(edit.edited_at), 'HH:mm • d MMM', { locale: th })}
                                                </span>
                                            </div>
                                            <p className="text-sm text-slate-600 dark:text-slate-400 font-thai leading-relaxed">
                                                <span className="font-bold text-slate-800 dark:text-slate-200">{edit.entity_label}</span>: {edit.field_label}
                                                <span className="mx-1 text-slate-400">→</span>
                                                <span className="text-emerald-600 dark:text-emerald-400 font-bold">{edit.new_value}</span>
                                            </p>
                                            <div className="mt-2 flex items-center justify-between">
                                                <p className="text-[11px] text-slate-400 font-thai">
                                                    โดย {edit.editor_name} • <span className="italic">{edit.reason || 'ไม่ระบุเหตุผล'}</span>
                                                </p>
                                                <ChevronRight className="w-4 h-4 text-slate-300 group-hover:text-slate-500" />
                                            </div>
                                        </div>
                                    </div>
                                </div>
                            ))
                        ) : (
                            <div className="py-12 text-center text-slate-400 font-thai">ไม่มีประวัติการแก้ไข</div>
                        )}
                    </div>
                );
            case 'rewash':
                return (
                    <div className="divide-y divide-slate-100 dark:divide-slate-800">
                        {rewash.length > 0 ? (
                            rewash.map((rw) => (
                                <div key={rw.id} className="p-4 hover:bg-slate-50 dark:hover:bg-slate-800/50 transition-colors cursor-pointer group">
                                    <div className="flex items-start gap-4">
                                        <div className="w-8 h-8 rounded-lg bg-purple-50 dark:bg-purple-500/10 text-purple-600 dark:text-purple-400 flex items-center justify-center shrink-0">
                                            <RefreshCw className="w-4 h-4" />
                                        </div>
                                        <div className="flex-1">
                                            <div className="flex items-center justify-between mb-1">
                                                <p className="text-sm font-bold text-slate-800 dark:text-slate-200 font-thai">
                                                    {rw.item_name_th} × {rw.qty}
                                                </p>
                                                <span className="text-[10px] text-slate-400 font-medium">
                                                    {format(new Date(rw.created_at), 'd MMM', { locale: th })}
                                                </span>
                                            </div>
                                            <div className="flex items-center gap-2 mt-1">
                                                <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded uppercase ${
                                                    rw.status === 'pending' ? 'bg-amber-100 text-amber-700' : 'bg-emerald-100 text-emerald-700'
                                                }`}>
                                                    {rw.status}
                                                </span>
                                                <p className="text-[11px] text-slate-500 font-thai">
                                                    ส่งจากรอบ {format(new Date(rw.sent_batch_business_date), 'dd/MM')} R{rw.sent_batch_pickup_round}
                                                </p>
                                            </div>
                                        </div>
                                        <ChevronRight className="w-5 h-5 text-slate-300 group-hover:text-slate-500" />
                                    </div>
                                </div>
                            ))
                        ) : (
                            <div className="py-12 text-center text-slate-400 font-thai">ไม่มีรายการ Rewash</div>
                        )}
                    </div>
                );
        }
    };

    return (
        <div className="card bg-white dark:bg-slate-900 border-slate-200 dark:border-slate-800 overflow-hidden shadow-sm">
            <div className="flex border-b border-slate-100 dark:border-slate-800 scrollbar-hide overflow-x-auto">
                {tabs.map((tab) => (
                    <button
                        key={tab.id}
                        onClick={() => setActiveTab(tab.id)}
                        className={`flex-1 min-w-[140px] px-6 py-4 text-sm font-bold font-thai flex items-center justify-center gap-2 border-b-2 transition-all ${
                            activeTab === tab.id
                            ? 'border-[#1B4038] text-[#1B4038] bg-[#1B4038]/5 dark:border-emerald-500 dark:text-emerald-400 dark:bg-emerald-500/5'
                            : 'border-transparent text-slate-400 hover:text-slate-600 hover:bg-slate-50 dark:hover:bg-slate-800/50'
                        }`}
                    >
                        <tab.icon className="w-4 h-4" />
                        {tab.label}
                    </button>
                ))}
            </div>
            <div>{renderContent()}</div>
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
        'disputed': { label: 'ยอดไม่ตรง', color: 'bg-rose-100 dark:bg-rose-950/30 text-rose-700 dark:text-rose-400' },
    };
    
    const s = map[status] || { label: status, color: 'bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300' };
    
    return (
        <span className={`inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-black leading-none uppercase tracking-tight ${s.color}`}>
            {s.label}
        </span>
    );
}
