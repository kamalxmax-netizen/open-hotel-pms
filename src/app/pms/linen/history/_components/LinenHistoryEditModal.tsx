"use client";

import React, { useState, useEffect } from "react";
import { useLinenBatchDetail } from "@/hooks/use-linen-batch";
import type { LinenBatchEditChange } from "@/lib/types";
import { Loader2, Save, X, AlertTriangle, Edit3 } from "lucide-react";

interface LinenHistoryEditModalProps {
    batchId: string;
    onClose: () => void;
    onSuccess: () => void;
}

export function LinenHistoryEditModal({ batchId, onClose, onSuccess }: LinenHistoryEditModalProps) {
    const { data, isLoading } = useLinenBatchDetail(batchId);
    const [reason, setReason] = useState("");
    const [edits, setEdits] = useState<Record<string, { sent: number; received: number }>>({});
    const [rewashEdits, setRewashEdits] = useState<Record<string, { qty: number; note: string }>>({});
    const [isSaving, setIsSaving] = useState(false);

    useEffect(() => {
        if (data?.items) {
            const initialEdits: Record<string, { sent: number; received: number }> = {};
            data.items.forEach(item => {
                initialEdits[item.id] = {
                    sent: item.sent_by_hotel,
                    received: item.received_back
                };
            });
            setEdits(initialEdits);
        }

        if (data?.rewash_events) {
            const initialRewashEdits: Record<string, { qty: number; note: string }> = {};
            data.rewash_events.forEach(item => {
                initialRewashEdits[String(item.id)] = {
                    qty: Number(item.qty ?? 0),
                    note: item.note ?? "",
                };
            });
            setRewashEdits(initialRewashEdits);
        } else {
            setRewashEdits({});
        }
    }, [data]);

    const handleQtyChange = (itemId: string, field: 'sent' | 'received', val: string) => {
        const num = parseInt(val, 10) || 0;
        setEdits(prev => ({
            ...prev,
            [itemId]: { ...prev[itemId], [field]: num }
        }));
    };

    const handleRewashChange = (itemId: string, field: 'qty' | 'note', val: string) => {
        const qty = Math.max(1, parseInt(val, 10) || 1);
        setRewashEdits(prev => ({
            ...prev,
            [itemId]: {
                ...prev[itemId],
                [field]: field === "qty" ? qty : val,
            }
        }));
    };

    const handleSubmit = async () => {
        if (!reason.trim()) {
            alert("โปรดระบุเหตุผลในการแก้ไข (Mandatory Reason)");
            return;
        }

        const changes: LinenBatchEditChange[] = [];
        data?.items.forEach(item => {
            const edit = edits[item.id];
            if (edit.sent !== item.sent_by_hotel) {
                changes.push({
                    entity_type: "batch_item",
                    entity_id: item.id,
                    field_name: "sent_by_hotel",
                    old_value: String(item.sent_by_hotel),
                    new_value: String(edit.sent)
                });
            }
            if (edit.received !== item.received_back) {
                changes.push({
                    entity_type: "batch_item", // Assuming same table for now or "return_item" if Agent B prefers
                    entity_id: item.id,
                    field_name: "received_back",
                    old_value: String(item.received_back),
                    new_value: String(edit.received)
                });
            }
        });

        data?.rewash_events?.forEach(item => {
            const itemId = String(item.id);
            const edit = rewashEdits[itemId];
            if (!edit) return;
            if (edit.qty !== Number(item.qty ?? 0)) {
                changes.push({
                    entity_type: "rewash_event",
                    entity_id: itemId,
                    field_name: "qty",
                    old_value: String(item.qty ?? 0),
                    new_value: String(edit.qty)
                });
            }
            if (edit.note !== (item.note ?? "")) {
                changes.push({
                    entity_type: "rewash_event",
                    entity_id: itemId,
                    field_name: "note",
                    old_value: item.note ?? "",
                    new_value: edit.note
                });
            }
        });

        if (changes.length === 0) {
            onClose();
            return;
        }

        setIsSaving(true);
        try {
            const res = await fetch(`/api/linen/batches/${batchId}/edit`, {
                method: "PATCH",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ changes, reason })
            });

            if (!res.ok) {
                const err = await res.json();
                throw new Error(err.error || "Failed to save changes");
            }

            onSuccess();
        } catch (err: any) {
            console.error(err);
            alert(`เกิดข้อผิดพลาด: ${err.message}`);
        } finally {
            setIsSaving(false);
        }
    };

    if (isLoading) {
        return (
            <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 backdrop-blur-sm p-4">
                <div className="bg-white dark:bg-slate-900 rounded-3xl p-12 flex flex-col items-center gap-4">
                    <Loader2 className="animate-spin text-emerald-500" size={40} />
                    <p className="font-bold text-slate-500 font-thai">กำลังดึงข้อมูลรายการ...</p>
                </div>
            </div>
        );
    }

    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 backdrop-blur-sm p-4 animate-in fade-in duration-200">
            <div className="bg-white dark:bg-slate-900 w-full max-w-3xl rounded-[2.5rem] shadow-2xl overflow-hidden flex flex-col max-h-[90vh] border border-white/10">
                {/* Header */}
                <div className="p-8 bg-slate-50 dark:bg-slate-800/50 border-b border-slate-100 dark:border-slate-800 flex justify-between items-center">
                    <div className="flex items-center gap-4">
                        <div className="w-12 h-12 rounded-2xl bg-amber-100 dark:bg-amber-900/30 flex items-center justify-center text-amber-600">
                            <Edit3 size={24} />
                        </div>
                        <div>
                            <h2 className="text-2xl font-black text-slate-900 dark:text-slate-100 font-thai uppercase tracking-tight">Audit & Edit Batch</h2>
                            <p className="text-sm text-slate-500 font-thai italic">Batch: #{batchId.substring(0, 8)} • แก้ไขจำนวนที่ได้รับ-ส่งจริง</p>
                        </div>
                    </div>
                    <button onClick={onClose} className="p-2 hover:bg-white dark:hover:bg-slate-700 rounded-full transition-colors text-slate-400">
                        <X size={24} />
                    </button>
                </div>

                {/* Body */}
                <div className="flex-1 overflow-y-auto p-8 space-y-8">
                    <div className="bg-rose-50 dark:bg-rose-950/20 border border-rose-100 dark:border-rose-900/50 rounded-2xl p-4 flex gap-4 items-start">
                        <AlertTriangle className="text-rose-500 shrink-0 mt-1" size={20} />
                        <p className="text-xs text-rose-700 dark:text-rose-300 font-thai leading-relaxed">
                            <span className="font-bold">CAUTION:</span> การแก้ไขข้อมูลในขั้นตอนนี้จะถูกบันทึกใน <strong>Linen Audit Log</strong> ทั้งหมด 
                            รวมถึงยอดเงินใน Monthly Report จะถูกคำนวณใหม่ตามยอดที่ท่านแก้ไข โปรดระบุเหตุผลที่ชัดเจน
                        </p>
                    </div>

                    <table className="w-full text-sm font-thai border-separate border-spacing-y-2">
                        <thead>
                            <tr className="text-[10px] font-bold text-slate-400 uppercase tracking-widest text-left">
                                <th className="px-4">Items</th>
                                <th className="px-4 text-center w-32 font-black text-blue-600">Dirty (ส่ง)</th>
                                <th className="px-4 text-center w-32 font-black text-emerald-600">Return (คืน)</th>
                            </tr>
                        </thead>
                        <tbody>
                            {data?.items.map((item) => (
                                <tr key={item.id} className="group hover:bg-slate-50 dark:hover:bg-slate-800/30 transition-colors">
                                    <td className="px-4 py-3 font-bold text-slate-700 dark:text-slate-200 bg-slate-50/50 dark:bg-slate-800/30 rounded-l-2xl">
                                        {item.name_th} {item.is_dayuse && <span className="text-[10px] text-amber-500">(Day Use)</span>}
                                    </td>
                                    <td className="px-4 py-3 bg-slate-50/50 dark:bg-slate-800/30">
                                        <input
                                            type="number"
                                            value={edits[item.id]?.sent ?? 0}
                                            onChange={(e) => handleQtyChange(item.id, 'sent', e.target.value)}
                                            className="w-full bg-white dark:bg-slate-700 border-none rounded-xl px-4 py-2 text-center font-black text-blue-600 shadow-sm focus:ring-2 focus:ring-blue-500/20 transition-all"
                                        />
                                    </td>
                                    <td className="px-4 py-3 bg-slate-50/50 dark:bg-slate-800/30 rounded-r-2xl">
                                        <input
                                            type="number"
                                            value={edits[item.id]?.received ?? 0}
                                            onChange={(e) => handleQtyChange(item.id, 'received', e.target.value)}
                                            className="w-full bg-white dark:bg-slate-700 border-none rounded-xl px-4 py-2 text-center font-black text-emerald-600 shadow-sm focus:ring-2 focus:ring-emerald-500/20 transition-all"
                                        />
                                    </td>
                                </tr>
                            ))}
                        </tbody>
                    </table>

                    {(data?.rewash_events?.length ?? 0) > 0 && (
                        <div className="space-y-3">
                            <div className="flex items-center gap-2">
                                <div className="h-px flex-1 bg-purple-100 dark:bg-purple-900/40" />
                                <h3 className="text-[10px] font-black uppercase tracking-[0.22em] text-purple-500">
                                    Rewash / ผ้าซักใหม่
                                </h3>
                                <div className="h-px flex-1 bg-purple-100 dark:bg-purple-900/40" />
                            </div>

                            <table className="w-full text-sm font-thai border-separate border-spacing-y-2">
                                <thead>
                                    <tr className="text-[10px] font-bold text-slate-400 uppercase tracking-widest text-left">
                                        <th className="px-4">Items</th>
                                        <th className="px-4 text-center w-32 font-black text-purple-600">Rewash Qty</th>
                                        <th className="px-4 text-center w-56 font-black text-slate-500">Note</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {data?.rewash_events?.map((item) => {
                                        const itemId = String(item.id);
                                        return (
                                            <tr key={itemId} className="group hover:bg-purple-50/40 dark:hover:bg-purple-950/20 transition-colors">
                                                <td className="px-4 py-3 font-bold text-slate-700 dark:text-slate-200 bg-purple-50/50 dark:bg-purple-950/20 rounded-l-2xl">
                                                    {item.name_th ?? `Item ${item.linen_item_id}`}
                                                    <span className="ml-2 text-[10px] font-black uppercase text-purple-500">{item.status}</span>
                                                </td>
                                                <td className="px-4 py-3 bg-purple-50/50 dark:bg-purple-950/20">
                                                    <input
                                                        type="number"
                                                        min="1"
                                                        value={rewashEdits[itemId]?.qty ?? 0}
                                                        onChange={(e) => handleRewashChange(itemId, 'qty', e.target.value)}
                                                        className="w-full bg-white dark:bg-slate-700 border-none rounded-xl px-4 py-2 text-center font-black text-purple-600 shadow-sm focus:ring-2 focus:ring-purple-500/20 transition-all"
                                                    />
                                                </td>
                                                <td className="px-4 py-3 bg-purple-50/50 dark:bg-purple-950/20 rounded-r-2xl">
                                                    <input
                                                        type="text"
                                                        value={rewashEdits[itemId]?.note ?? ""}
                                                        onChange={(e) => handleRewashChange(itemId, 'note', e.target.value)}
                                                        className="w-full bg-white dark:bg-slate-700 border-none rounded-xl px-4 py-2 text-sm text-slate-700 dark:text-slate-200 shadow-sm focus:ring-2 focus:ring-purple-500/20 transition-all"
                                                        placeholder="หมายเหตุ..."
                                                    />
                                                </td>
                                            </tr>
                                        );
                                    })}
                                </tbody>
                            </table>
                        </div>
                    )}

                    {/* Reason */}
                    <div className="space-y-3 pt-4">
                        <label className="text-[10px] font-bold text-slate-400 uppercase tracking-widest pl-1">Reason for Adjustment (Mandatory)</label>
                        <textarea
                            value={reason}
                            onChange={(e) => setReason(e.target.value)}
                            placeholder="ระบุเหตุผลในการแก้ไข เช่น 'นับข้ามจำนวนผ้าห่ม' หรือ 'ร้านค้าแจ้งยอดตกหล่นคืนมาภายหลัง'..."
                            className="w-full h-24 bg-slate-50 dark:bg-slate-800 border-none rounded-3xl p-6 text-sm font-thai focus:ring-2 focus:ring-emerald-500/20 transition-all resize-none shadow-inner"
                        />
                    </div>
                </div>

                {/* Footer */}
                <div className="p-8 bg-slate-50 dark:bg-slate-800/50 border-t border-slate-100 dark:border-slate-800 flex justify-end gap-3">
                    <button
                        onClick={onClose}
                        className="px-8 py-3 bg-white dark:bg-slate-700 text-slate-500 font-bold rounded-2xl hover:bg-slate-100 transition-all font-thai border border-slate-200 dark:border-slate-600"
                    >
                        ยกเลิก
                    </button>
                    <button
                        onClick={handleSubmit}
                        disabled={isSaving}
                        className="px-10 py-3 bg-[#1B4038] text-white font-black rounded-2xl shadow-xl shadow-emerald-500/20 active:scale-95 transition-all flex items-center gap-2 font-thai uppercase tracking-widest text-sm"
                    >
                        {isSaving ? <Loader2 className="animate-spin" size={18} /> : <Save size={18} />}
                        Confirm & Save Audit
                    </button>
                </div>
            </div>
        </div>
    );
}
