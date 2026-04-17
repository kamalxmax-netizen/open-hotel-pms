"use client";

import React from "react";
import { Search, Calendar, Tag, AlertCircle, Image as ImageIcon, ClipboardList } from "lucide-react";

interface LinenHistoryFilterBarProps {
    filters: any;
    setFilters: (filters: any) => void;
}

export function LinenHistoryFilterBar({ filters, setFilters }: LinenHistoryFilterBarProps) {
    const handleChange = (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => {
        const { name, value, type } = e.target;
        const val = type === 'checkbox' ? (e.target as HTMLInputElement).checked : value;
        setFilters((prev: any) => ({ ...prev, [name]: val }));
    };

    return (
        <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl p-4 mb-6 shadow-sm">
            <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
                {/* Search */}
                <div className="relative">
                    <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
                    <input
                        type="search"
                        name="search"
                        value={filters.search || ""}
                        onChange={handleChange}
                        placeholder="ค้นหา Batch ID หรือหมายเหตุ..."
                        className="w-full pl-10 pr-4 py-2 bg-slate-50 dark:bg-slate-800 border-none rounded-xl text-sm focus:ring-2 focus:ring-emerald-500/20 transition-all font-thai"
                    />
                </div>

                {/* Date range (Day 2 simplifed as single month or range) */}
                <div className="relative">
                    <Calendar className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
                    <input
                        type="date"
                        name="date_from"
                        value={filters.date_from || ""}
                        onChange={handleChange}
                        className="w-full pl-10 pr-4 py-2 bg-slate-50 dark:bg-slate-800 border-none rounded-xl text-sm focus:ring-2 focus:ring-emerald-500/20 transition-all"
                    />
                </div>

                <div className="relative">
                    <Calendar className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
                    <input
                        type="date"
                        name="date_to"
                        value={filters.date_to || ""}
                        onChange={handleChange}
                        className="w-full pl-10 pr-4 py-2 bg-slate-50 dark:bg-slate-800 border-none rounded-xl text-sm focus:ring-2 focus:ring-emerald-500/20 transition-all"
                    />
                </div>

                {/* Status */}
                <div className="relative">
                    <Tag className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
                    <select
                        name="status"
                        value={filters.status || ""}
                        onChange={handleChange}
                        className="w-full pl-10 pr-4 py-2 bg-slate-50 dark:bg-slate-800 border-none rounded-xl text-sm focus:ring-2 focus:ring-emerald-500/20 transition-all font-thai appearance-none"
                    >
                        <option value="">สถานะทั้งหมด</option>
                        <option value="draft">ร่าง (Draft)</option>
                        <option value="pending">รอร้านรับ/คืน (Pending)</option>
                        <option value="closed">เสร็จสมบูรณ์ (Closed)</option>
                        <option value="disputed">ยอดไม่ตรง (Disputed)</option>
                    </select>
                </div>
            </div>

            <div className="mt-4 pt-4 border-t border-slate-50 dark:border-slate-800 flex flex-wrap gap-4">
                <label className="flex items-center gap-2 cursor-pointer group">
                    <input
                        type="checkbox"
                        name="has_rewash"
                        checked={filters.has_rewash || false}
                        onChange={handleChange}
                        className="w-4 h-4 rounded border-slate-300 text-purple-600 focus:ring-purple-500 transition-all"
                    />
                    <span className="text-xs font-bold text-slate-500 group-hover:text-purple-600 transition-colors flex items-center gap-1 font-thai">
                        <AlertCircle className="w-3 h-3" /> มีรายการ Rewash
                    </span>
                </label>

                <label className="flex items-center gap-2 cursor-pointer group">
                    <input
                        type="checkbox"
                        name="has_extras"
                        checked={filters.has_extras || false}
                        onChange={handleChange}
                        className="w-4 h-4 rounded border-slate-300 text-emerald-600 focus:ring-emerald-500 transition-all"
                    />
                    <span className="text-xs font-bold text-slate-500 group-hover:text-emerald-600 transition-colors flex items-center gap-1 font-thai">
                        <ImageIcon className="w-3 h-3" /> มีรูปภาพ/รายการพิเศษ
                    </span>
                </label>

                <label className="flex items-center gap-2 cursor-pointer group">
                    <input
                        type="checkbox"
                        name="has_edits"
                        checked={filters.has_edits || false}
                        onChange={handleChange}
                        className="w-4 h-4 rounded border-slate-300 text-purple-600 focus:ring-purple-500 transition-all"
                    />
                    <span className="text-xs font-bold text-slate-500 group-hover:text-purple-600 transition-colors flex items-center gap-1 font-thai">
                        <ClipboardList className="w-3 h-3" /> มีรายการแก้ไข
                    </span>
                </label>
            </div>
        </div>
    );
}
