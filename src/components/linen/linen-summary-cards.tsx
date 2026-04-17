"use client";

import React from "react";
import { Send, Clock, RefreshCw, Wallet } from "lucide-react";

interface LinenSummaryCardsProps {
    data?: {
        today_sent_count: number;
        today_sent_qty: number;
        pending_return_count: number;
        open_rewash_count: number;
        mtd_baht: number;
    };
    isLoading: boolean;
}

export function LinenSummaryCards({ data, isLoading }: LinenSummaryCardsProps) {
    return (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
            <div className="card p-5 bg-gradient-to-br from-emerald-50 to-teal-50 dark:from-emerald-950/20 dark:to-teal-900/10 border-emerald-200 dark:border-emerald-900/30">
                <div className="flex items-center gap-4">
                    <div className="w-12 h-12 rounded-full bg-emerald-100 dark:bg-emerald-900/50 flex items-center justify-center text-emerald-600 dark:text-emerald-400">
                        <Send className="w-6 h-6" />
                    </div>
                    <div>
                        <p className="text-sm font-semibold text-emerald-800/70 dark:text-emerald-500/70">วันนี้ส่งออก</p>
                        {isLoading ? (
                            <div className="h-8 w-24 bg-emerald-200/50 animate-pulse rounded mt-1" />
                        ) : (
                            <div>
                                <p className="text-2xl font-bold text-emerald-700 dark:text-emerald-500">
                                    {data?.today_sent_count || 0} <span className="text-sm font-medium">รอบ</span>
                                </p>
                                <p className="text-xs text-emerald-600/60 dark:text-emerald-400/60">รวม {data?.today_sent_qty || 0} ชิ้น</p>
                            </div>
                        )}
                    </div>
                </div>
            </div>

            <div className="card p-5 bg-gradient-to-br from-amber-50 to-orange-50 dark:from-amber-950/20 dark:to-orange-900/10 border-amber-200 dark:border-amber-900/30">
                <div className="flex items-center gap-4">
                    <div className="w-12 h-12 rounded-full bg-amber-100 dark:bg-amber-900/50 flex items-center justify-center text-amber-600 dark:text-amber-400">
                        <Clock className="w-6 h-6" />
                    </div>
                    <div>
                        <p className="text-sm font-semibold text-amber-800/70 dark:text-amber-500/70">ค้างรับคืน</p>
                        {isLoading ? (
                            <div className="h-8 w-20 bg-amber-200/50 animate-pulse rounded mt-1" />
                        ) : (
                            <p className="text-2xl font-bold text-amber-700 dark:text-amber-500">
                                {data?.pending_return_count || 0} <span className="text-sm font-medium">ชุด</span>
                            </p>
                        )}
                    </div>
                </div>
            </div>

            <div className="card p-5 bg-gradient-to-br from-purple-50 to-indigo-50 dark:from-purple-950/20 dark:to-indigo-900/10 border-purple-200 dark:border-purple-900/30">
                <div className="flex items-center gap-4">
                    <div className="w-12 h-12 rounded-full bg-purple-100 dark:bg-purple-900/50 flex items-center justify-center text-purple-600 dark:text-purple-400">
                        <RefreshCw className="w-6 h-6" />
                    </div>
                    <div>
                        <p className="text-sm font-semibold text-purple-800/70 dark:text-purple-500/70">Rewash ค้าง</p>
                        {isLoading ? (
                            <div className="h-8 w-16 bg-purple-200/50 animate-pulse rounded mt-1" />
                        ) : (
                            <p className="text-2xl font-bold text-purple-700 dark:text-purple-500">
                                {data?.open_rewash_count || 0} <span className="text-sm font-medium">รายการ</span>
                            </p>
                        )}
                    </div>
                </div>
            </div>

            <div className="card p-5 bg-gradient-to-br from-slate-50 to-gray-50 dark:from-slate-900/40 dark:to-slate-800/20 border-slate-200 dark:border-slate-800">
                <div className="flex items-center gap-4">
                    <div className="w-12 h-12 rounded-full bg-slate-100 dark:bg-slate-800 flex items-center justify-center text-slate-600 dark:text-slate-400">
                        <Wallet className="w-6 h-6" />
                    </div>
                    <div>
                        <p className="text-sm font-semibold text-slate-600/70 dark:text-slate-400/70">ค่าซักรีด (MTD)</p>
                        {isLoading ? (
                            <div className="h-8 w-24 bg-slate-200/50 animate-pulse rounded mt-1" />
                        ) : (
                            <p className="text-2xl font-bold text-slate-700 dark:text-slate-200 font-thai">
                                {new Intl.NumberFormat('th-TH').format(data?.mtd_baht || 0)} <span className="text-sm font-medium font-sans">฿</span>
                            </p>
                        )}
                    </div>
                </div>
            </div>
        </div>
    );
}
