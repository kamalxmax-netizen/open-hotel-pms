"use client";

import React, { useState } from "react";
import { MobileBatchStepSummary } from "./mobile-batch-step-summary";
import { SignatureCanvas } from "./signature-canvas";
import {
    splitReturnSummaryRowsForDisplay,
    toRewashSummaryRows,
    type ReturnSummaryDisplayRow,
} from "@/lib/linen/rewash-summary";

interface MobileBatchStepVendorSignProps {
    batchId: string;
    items: any[];
    rewashEvents?: any[];
    returnSummary?: ReturnSummaryDisplayRow[];
    rewashReturnSummary?: { name: string; qty: number }[];
    onNext: () => void;
    onBack: () => void;
}

export function MobileBatchStepVendorSign({ batchId, items, rewashEvents = [], returnSummary, rewashReturnSummary = [], onNext, onBack }: MobileBatchStepVendorSignProps) {
    const [vendorName, setVendorName] = useState("");
    const [signatureBlob, setSignatureBlob] = useState<Blob | null>(null);
    const [isSubmitting, setIsSubmitting] = useState(false);

    const dirtyItems = items.filter(i => !i.is_dayuse && i.sent_by_hotel > 0).map(i => ({ name: i.name_th ?? `Item ${i.linen_item_id}`, qty: i.sent_by_hotel }));
    const dayuseItems = items.filter(i => i.is_dayuse && i.sent_by_hotel > 0).map(i => ({ name: i.name_th ?? `Item ${i.linen_item_id}`, qty: i.sent_by_hotel }));
    const rewashItems = toRewashSummaryRows(rewashEvents).map(i => ({ name: i.name, qty: i.qty }));
    const splitReturns = splitReturnSummaryRowsForDisplay(returnSummary);
    const returnItems = splitReturns.normal.length
        ? splitReturns.normal
        : items.filter(i => i.received_back > 0).map(i => ({ name: i.name_th ?? `Item ${i.linen_item_id}`, qty: i.received_back }));

    const handleBack = () => {
        if (window.confirm("กดย้อนกลับจะทำให้ลายเซ็นที่ลงไว้หายไป ต้องการย้อนกลับหรือไม่?")) {
            onBack();
        }
    };

    const handleConfirm = async () => {
        if (!vendorName) {
            alert("กรุณาระบุชื่อผู้รับผ้า");
            return;
        }
        if (!signatureBlob) {
            alert("กรุณาลงลายเซ็น");
            return;
        }

        setIsSubmitting(true);
        try {
            // Upload signature
            const formData = new FormData();
            formData.append("file", signatureBlob, "signature.png");
            formData.append("type", "vendor_pickup");

            const signRes = await fetch(`/api/linen/batches/${batchId}/signature`, {
                method: "POST",
                body: formData
            });

            if (!signRes.ok) throw new Error("Failed to upload signature");

            // Advance step
            const res = await fetch(`/api/linen/batches/${batchId}/step`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    step: "vendor_signed",
                    vendor_name: vendorName
                })
            });

            if (!res.ok) throw new Error("Failed to advance step");
            onNext();
        } catch (error) {
            console.error(error);
            alert("เกิดข้อผิดพลาดในการบันทึก");
        } finally {
            setIsSubmitting(false);
        }
    };

    return (
        <div className="flex flex-col h-full bg-white rounded-3xl shadow-lg border border-slate-100 overflow-hidden mb-24">
            <div className="p-5 border-b border-slate-100 bg-slate-50">
                <h2 className="text-2xl font-bold text-slate-900 font-thai">3. ร้านซักเซ็นรับผ้า</h2>
                <p className="text-sm text-slate-500 font-thai">ตรวจสอบยอดและลงชื่อ</p>
            </div>

            <div className="flex-1 overflow-y-auto p-5 space-y-6">
                <MobileBatchStepSummary title="ผ้าวันนี้" items={dirtyItems} />
                <MobileBatchStepSummary title="ผ้าเก่า" items={dayuseItems} />
                <MobileBatchStepSummary title="ผ้าซักใหม่" items={rewashItems} />
                <MobileBatchStepSummary title="รับคืนผ้าซักปกติ" items={returnItems} />
                <MobileBatchStepSummary title="รับคืนผ้าค้างเก่า" items={splitReturns.pending} />
                <MobileBatchStepSummary title="รับคืนผ้าซักใหม่" items={rewashReturnSummary} />

                <div className="pt-6 border-t border-slate-100">
                    <h3 className="text-xs font-bold text-slate-400 uppercase tracking-widest mb-4">✍️ ลงชื่อร้านซักรีด</h3>
                    <div className="bg-slate-50 rounded-2xl p-4 border border-slate-100">
                        <SignatureCanvas onSign={setSignatureBlob} />
                        <div className="mt-4">
                            <label className="text-xs font-bold text-slate-400 uppercase mb-2 block">ชื่อพนักงานร้านซัก</label>
                            <input
                                type="text"
                                value={vendorName}
                                onChange={(e) => setVendorName(e.target.value)}
                                className="w-full h-12 bg-white border border-slate-200 rounded-xl px-4 text-slate-900 font-thai focus:border-[#1B4038] outline-none"
                                placeholder="พิมพ์ชื่อ..."
                            />
                        </div>
                    </div>
                </div>
            </div>

            <div className="p-5 bg-white border-t border-slate-100 fixed bottom-0 left-0 right-0 max-w-lg mx-auto z-40 flex gap-3 shadow-[0_-5px_20px_rgba(0,0,0,0.03)]">
                <button
                    onClick={handleBack}
                    className="flex-1 py-4 bg-slate-100 text-slate-700 font-bold rounded-2xl active:scale-95 transition-all text-base border border-slate-200 font-thai"
                >
                    ย้อนกลับ
                </button>
                <button
                    onClick={handleConfirm}
                    disabled={isSubmitting}
                    className="flex-[1.5] py-4 bg-[#1B4038] text-white font-bold rounded-2xl shadow-lg active:scale-95 transition-all text-base flex justify-center items-center gap-2"
                >
                    {isSubmitting ? <div className="w-5 h-5 border-2 border-white/30 border-t-white rounded-full animate-spin" /> : "ยืนยันการส่ง-รับผ้า"}
                </button>
            </div>
        </div>
    );
}
