"use client";

import React, { useState, useEffect } from "react";
import { createBrowserSupabaseClient } from "@/lib/supabase/client";
import type { LinenItem } from "@/lib/types";
import { MobileItemRow } from "./mobile-item-row";

interface MobileExtraItemsSheetProps {
    isOpen: boolean;
    onClose: () => void;
    onAdd: (items: { linen_item_id: number; name_th: string; qty: number }[]) => void;
    existingItemIds: number[];
}

export function MobileExtraItemsSheet({ isOpen, onClose, onAdd, existingItemIds }: MobileExtraItemsSheetProps) {
    const [items, setItems] = useState<LinenItem[]>([]);
    const [isLoading, setIsLoading] = useState(false);
    const [selectedQtys, setSelectedQtys] = useState<Record<number, string>>({});

    useEffect(() => {
        if (!isOpen) return;

        async function fetchInactiveItems() {
            setIsLoading(true);
            const supabase = createBrowserSupabaseClient();
            const { data, error } = await supabase
                .from("linen_items")
                .select("*")
                .eq("is_active", false)
                .order("sort_order", { ascending: true });

            if (!error && data) {
                setItems(data);
            }
            setIsLoading(false);
        }

        fetchInactiveItems();
    }, [isOpen]);

    if (!isOpen) return null;

    const selectedCount = Object.values(selectedQtys).filter((qty) => Number(qty) > 0).length;

    const toggleSelection = (item: LinenItem) => {
        setSelectedQtys(prev => {
            const next = { ...prev };
            if (next[item.id] !== undefined) {
                delete next[item.id];
            } else {
                next[item.id] = "1";
            }
            return next;
        });
    };

    const handleQtyChange = (itemId: number, value: string) => {
        setSelectedQtys(prev => ({ ...prev, [itemId]: value }));
    };

    const handleConfirm = () => {
        const toAdd = items
            .filter(item => Number(selectedQtys[item.id] ?? 0) > 0)
            .map(item => ({
                linen_item_id: item.id,
                name_th: item.name_th,
                qty: Number(selectedQtys[item.id] ?? 0)
            }));
        
        if (toAdd.length > 0) {
            onAdd(toAdd);
        }
        setSelectedQtys({});
        onClose();
    };

    return (
        <>
            <div 
                className={`fixed inset-0 z-50 bg-black/60 backdrop-blur-sm transition-opacity duration-300 ${isOpen ? 'opacity-100' : 'opacity-0 pointer-events-none'}`}
                onClick={onClose}
            />
            
            <div className={`fixed inset-x-0 bottom-0 z-50 transform transition-transform duration-500 ease-out ${isOpen ? 'translate-y-0' : 'translate-y-full'}`}>
                <div className="bg-white dark:bg-slate-900 rounded-t-[2.5rem] shadow-2xl max-h-[85vh] flex flex-col border-t border-slate-100 dark:border-slate-800 overflow-hidden">
                    <div className="w-12 h-1.5 bg-slate-200 dark:bg-slate-800 rounded-full mx-auto my-4 shrink-0 shadow-inner" />
                    
                    <div className="px-6 pb-4 border-b border-slate-50 dark:border-slate-800 flex justify-between items-center">
                        <div>
                            <h2 className="text-xl font-bold text-slate-900 dark:text-slate-100 font-thai">เพิ่มรายการพิเศษ</h2>
                            <p className="text-sm text-slate-400 dark:text-slate-500 font-thai">นับผ้าอื่นที่ไม่ได้อยู่ในรายการหลัก</p>
                        </div>
                        <button onClick={onClose} className="w-10 h-10 rounded-full bg-slate-50 dark:bg-slate-800 flex items-center justify-center text-slate-400 active:scale-95 transition-all">
                            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" className="w-5 h-5"><path d="M18 6L6 18M6 6l12 12"/></svg>
                        </button>
                    </div>

                    <div className="flex-1 overflow-y-auto p-6 pt-2">
                        {isLoading ? (
                            <div className="py-20 text-center text-slate-400 animate-pulse font-thai">กำลังโหลด...</div>
                        ) : (
                            <div className="space-y-1">
                                {items.filter(item => !existingItemIds.includes(item.id)).map((item) => (
                                    <div 
                                        key={item.id} 
                                        onClick={() => toggleSelection(item)}
                                        className={`rounded-2xl transition-all active:scale-95 mb-2 border overflow-hidden ${
                                            selectedQtys[item.id] !== undefined
                                            ? 'bg-emerald-50 dark:bg-emerald-500/10 border-emerald-200 dark:border-emerald-500/30 ring-1 ring-emerald-200 dark:ring-emerald-500/30' 
                                            : 'bg-slate-50 dark:bg-slate-800/30 border-slate-100 dark:border-slate-800'
                                        }`}
                                    >
                                        {selectedQtys[item.id] !== undefined ? (
                                            <div onClick={(event) => event.stopPropagation()}>
                                                <MobileItemRow
                                                    label={item.name_th}
                                                    value={selectedQtys[item.id] ?? ""}
                                                    onChange={(value) => handleQtyChange(item.id, value)}
                                                />
                                            </div>
                                        ) : (
                                            <div className="flex items-center justify-between p-4">
                                                <p className="font-bold font-thai text-slate-700 dark:text-slate-300">
                                                    {item.name_th}
                                                </p>
                                                <div className="w-7 h-7 bg-white dark:bg-slate-800 text-slate-300 rounded-full flex items-center justify-center shadow-sm border border-slate-100 dark:border-slate-700">
                                                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" className="w-4 h-4"><path d="M12 5v14M5 12h14"/></svg>
                                                </div>
                                            </div>
                                        )}
                                    </div>
                                ))}
                            </div>
                        )}
                    </div>

                    <div className="p-6 pt-2 pb-10 bg-white dark:bg-slate-900 border-t border-slate-50 dark:border-slate-800">
                        <button
                            onClick={handleConfirm}
                            disabled={selectedCount === 0}
                            className={`w-full py-4 rounded-2xl font-bold transition-all shadow-lg text-lg flex justify-center items-center gap-2 ${
                                selectedCount > 0 
                                ? 'bg-[#1B4038] text-white active:scale-95' 
                                : 'bg-slate-100 dark:bg-slate-800 text-slate-400 cursor-not-allowed shadow-none'
                            }`}
                        >
                            ยืนยัน {selectedCount > 0 && `(${selectedCount} รายการ)`}
                        </button>
                    </div>
                </div>
            </div>
        </>
    );
}
