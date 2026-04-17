"use client";

import React, { useState, useEffect } from "react";
import { Search, Filter, Calendar, X } from "lucide-react";
import { createBrowserSupabaseClient } from "@/lib/supabase/client";
import type { LinenItem, LinenHistoryFilter } from "@/lib/types";

interface LinenHistoryFilterBarProps {
    filters: LinenHistoryFilter;
    onFilterChange: (filters: LinenHistoryFilter) => void;
}

export function LinenHistoryFilterBar({ filters, onFilterChange }: LinenHistoryFilterBarProps) {
    const [items, setItems] = useState<LinenItem[]>([]);
    const [isExpanded, setIsExpanded] = useState(false);

    useEffect(() => {
        async function fetchItems() {
            const supabase = createBrowserSupabaseClient();
            const { data } = await supabase
                .from("linen_items")
                .select("*")
                .order("sort_order", { ascending: true });
            if (data) setItems(data);
        }
        fetchItems();
    }, []);

    const handleChange = (field: keyof LinenHistoryFilter, value: any) => {
        onFilterChange({ ...filters, [field]: value });
    };

    const clearFilters = () => {
        onFilterChange({
            date_from: "",
            date_to: "",
            status: [],
            linen_item_id: undefined,
            has_extras: false,
            has_rewash: false,
            has_edits: false,
            search: ""
        });
    };

    const hasActiveFilters = Object.entries(filters).some(([key, val]) => {
        if (key === 'page' || key === 'page_size') return false;
        if (Array.isArray(val)) return val.length > 0;
        return !!val;
    });

    return (
        <div className="space-y-4">
            <div className="flex flex-col md:flex-row gap-3">
                {/* Search Input */}
                <div className="relative flex-1">
                    <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
                    <input
                        type="text"
                        value={filters.search || ""}
                        onChange={(e) => handleChange("search", e.target.value)}
                        placeholder="ค้นหา Batch ID หรือหมายเหตุ..."
                        className="w-full pl-10 pr-4 py-2 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-[#1B4038]/10 focus:border-[#1B4038] dark:focus:border-emerald-500 transition-all font-thai"
                    />
                </div>

                <div className="flex items-center gap-2">
                    <button
                        onClick={() => setIsExpanded(!isExpanded)}
                        className={`flex items-center gap-2 px-4 py-2 rounded-xl border text-sm font-bold transition-all font-thai ${
                            isExpanded || hasActiveFilters
                            ? 'bg-[#1B4038] border-[#1B4038] text-white'
                            : 'bg-white dark:bg-slate-900 border-slate-200 dark:border-slate-800 text-slate-600 dark:text-slate-400 hover:bg-slate-50'
                        }`}
                    >
                        <Filter className="w-4 h-4" />
                        ตัวกรอง {hasActiveFilters && "(มีตัวเลือก)"}
                    </button>

                    {hasActiveFilters && (
                        <button
                            onClick={clearFilters}
                            className="p-2 text-slate-400 hover:text-rose-500 transition-colors"
                            title="ล้างตัวกรอง"
                        >
                            <X className="w-5 h-5" />
                        </button>
                    )}
                </div>
            </div>

            {isExpanded && (
                <div className="card p-6 grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6 bg-slate-50/50 dark:bg-slate-900/50 border-slate-200 dark:border-slate-800 animate-in fade-in slide-in-from-top-2 duration-200">
                    {/* Date Range */}
                    <div className="space-y-2">
                        <label className="text-[10px] font-bold text-slate-400 uppercase tracking-widest font-thai">ช่วงวันที่</label>
                        <div className="flex items-center gap-2">
                            <input
                                type="date"
                                value={filters.date_from || ""}
                                onChange={(e) => handleChange("date_from", e.target.value)}
                                className="flex-1 p-2 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-lg text-xs font-thai focus:outline-none focus:ring-1 focus:ring-[#1B4038]"
                            />
                            <span className="text-slate-300">-</span>
                            <input
                                type="date"
                                value={filters.date_to || ""}
                                onChange={(e) => handleChange("date_to", e.target.value)}
                                className="flex-1 p-2 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-lg text-xs font-thai focus:outline-none focus:ring-1 focus:ring-[#1B4038]"
                            />
                        </div>
                    </div>

                    {/* Linen Item */}
                    <div className="space-y-2">
                        <label className="text-[10px] font-bold text-slate-400 uppercase tracking-widest font-thai">รายการผ้า</label>
                        <select
                            value={filters.linen_item_id || ""}
                            onChange={(e) => handleChange("linen_item_id", e.target.value ? parseInt(e.target.value) : undefined)}
                            className="w-full p-2 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-lg text-xs font-thai focus:outline-none focus:ring-1 focus:ring-[#1B4038]"
                        >
                            <option value="">ทั้งหมด</option>
                            {items.map(item => (
                                <option key={item.id} value={item.id}>{item.name_th}</option>
                            ))}
                        </select>
                    </div>

                    {/* Boolean Toggles */}
                    <div className="space-y-3 lg:pt-6">
                        <label className="flex items-center gap-2 cursor-pointer group">
                            <input
                                type="checkbox"
                                checked={filters.has_rewash || false}
                                onChange={(e) => handleChange("has_rewash", e.target.checked)}
                                className="w-4 h-4 rounded border-slate-300 text-purple-600 focus:ring-purple-500"
                            />
                            <span className="text-sm text-slate-600 dark:text-slate-400 group-hover:text-slate-900 dark:group-hover:text-slate-200 transition-colors font-thai">มีรายการ Rewash</span>
                        </label>
                        <label className="flex items-center gap-2 cursor-pointer group">
                            <input
                                type="checkbox"
                                checked={filters.has_extras || false}
                                onChange={(e) => handleChange("has_extras", e.target.checked)}
                                className="w-4 h-4 rounded border-slate-300 text-amber-600 focus:ring-amber-500"
                            />
                            <span className="text-sm text-slate-600 dark:text-slate-400 group-hover:text-slate-900 dark:group-hover:text-slate-200 transition-colors font-thai">มีรายการพิเศษ</span>
                        </label>
                    </div>

                    <div className="space-y-3 lg:pt-6">
                        <label className="flex items-center gap-2 cursor-pointer group">
                            <input
                                type="checkbox"
                                checked={filters.has_edits || false}
                                onChange={(e) => handleChange("has_edits", e.target.checked)}
                                className="w-4 h-4 rounded border-slate-300 text-blue-600 focus:ring-blue-500"
                            />
                            <span className="text-sm text-slate-600 dark:text-slate-400 group-hover:text-slate-900 dark:group-hover:text-slate-200 transition-colors font-thai">มีการแก้ไข (Audit)</span>
                        </label>
                    </div>
                </div>
            )}
        </div>
    );
}
