"use client";

import React, { useState } from "react";
import { MonthPicker } from "../../monthly/_components/MonthPicker";
import { useLinenRates, useLinenRateHistory } from "@/hooks/use-linen-rates";
import { startOfMonth, format, addMonths } from "date-fns";
import { Loader2, History, Copy, Save, CheckCircle2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";

export function LinenRatesSettings() {
  const [selectedDate, setSelectedDate] = useState(startOfMonth(new Date()));
  const [isSaving, setIsSaving] = useState(false);
  const [showSuccess, setShowSuccess] = useState(false);

  const formattedMonth = format(selectedDate, "yyyy-MM-01");
  const { data: rates, isLoading, mutate } = useLinenRates(formattedMonth);

  const [localRates, setLocalRates] = useState<Record<number, number>>({});
  const [historyItemId, setHistoryItemId] = useState<number | null>(null);

  React.useEffect(() => {
    if (rates) {
      const initial: Record<number, number> = {};
      rates.forEach((rate) => {
        initial[rate.linen_item_id] = rate.rate_per_piece;
      });
      setLocalRates(initial);
    }
  }, [rates]);

  const handleRateChange = (itemId: number, value: string) => {
    const num = parseFloat(value) || 0;
    setLocalRates((prev) => ({ ...prev, [itemId]: num }));
  };

  const handleSaveAll = async () => {
    if (!rates) return;
    setIsSaving(true);
    try {
      const res = await fetch("/api/linen/rates", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          rates: rates.map((rate) => ({
            linen_item_id: rate.linen_item_id,
            effective_month: formattedMonth,
            rate_per_piece: localRates[rate.linen_item_id] ?? rate.rate_per_piece,
            note: "Updated from linen rate settings",
          })),
        }),
      });
      const payload = await res.json().catch(() => null);
      if (!res.ok || payload?.success === false) {
        throw new Error(payload?.error ?? "Failed to save linen rates");
      }
      await mutate();
      setShowSuccess(true);
      setTimeout(() => setShowSuccess(false), 3000);
    } finally {
      setIsSaving(false);
    }
  };

  const handleCopyFromPrevious = async () => {
    const previousMonth = format(addMonths(selectedDate, -1), "yyyy-MM-01");
    const res = await fetch(`/api/linen/rates?month=${previousMonth}`);
    const payload = await res.json();
    if (!res.ok) throw new Error(payload?.error ?? "Failed to copy previous rates");
    const copied: Record<number, number> = {};
    (payload as Array<{ linen_item_id: number; rate_per_piece: number }>).forEach((rate) => {
      copied[rate.linen_item_id] = rate.rate_per_piece;
    });
    setLocalRates(copied);
  };

  return (
    <section id="vendor-rates" className="scroll-mt-8 space-y-6">
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h2 className="text-xl font-black text-slate-900 dark:text-slate-100 uppercase tracking-tight">ราคา Vendor</h2>
          <p className="text-sm text-slate-500 dark:text-slate-400 mt-1">กำหนดราคาซักต่อชิ้นแยกตามรายเดือน (มีผลกับการคำนวณต้นทุน)</p>
        </div>

        <div className="flex items-center gap-3">
          <MonthPicker currentDate={selectedDate} onChange={setSelectedDate} />
          <Button
            variant="outline"
            size="sm"
            onClick={handleCopyFromPrevious}
            className="flex items-center gap-2 font-bold text-slate-600 border-slate-200"
          >
            <Copy size={16} />
            คัดลอกจากเดือนก่อน
          </Button>
        </div>
      </div>

      <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl overflow-hidden shadow-sm">
        {isLoading ? (
          <div className="p-20 flex flex-col items-center justify-center text-slate-400 gap-3">
            <Loader2 className="animate-spin" size={32} />
            <p className="font-bold text-xs uppercase tracking-widest">กำลังโหลดราคา...</p>
          </div>
        ) : (
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="bg-slate-50 dark:bg-slate-800/50 border-b border-slate-100 dark:border-slate-800">
                <th className="p-4 text-[10px] font-bold text-slate-400 dark:text-slate-500 uppercase tracking-widest text-center w-12">#</th>
                <th className="p-4 text-[10px] font-bold text-slate-400 dark:text-slate-500 uppercase tracking-widest">รายการ</th>
                <th className="p-4 text-[10px] font-bold text-slate-400 dark:text-slate-500 uppercase tracking-widest text-center w-32">ราคา (฿/ชิ้น)</th>
                <th className="p-4 text-[10px] font-bold text-slate-400 dark:text-slate-500 uppercase tracking-widest text-center w-24">ประวัติ</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-50 dark:divide-slate-800/50">
              {rates?.map((rate) => (
                <tr key={rate.linen_item_id} className="hover:bg-slate-50 dark:hover:bg-slate-800/40 transition-colors">
                  <td className="p-4 text-xs font-bold text-slate-400 text-center">{rate.item_number}</td>
                  <td className="p-4">
                    <p className="font-bold text-slate-700 dark:text-slate-200 text-sm">{rate.name_th}</p>
                  </td>
                  <td className="p-4">
                    <input
                      type="number"
                      step="0.01"
                      value={localRates[rate.linen_item_id] ?? ""}
                      onChange={(e) => handleRateChange(rate.linen_item_id, e.target.value)}
                      className="w-full bg-slate-50 dark:bg-slate-800 border-0 rounded-lg p-2 text-center font-black text-slate-900 dark:text-slate-100 focus:ring-2 focus:ring-[#1B4038] transition-all"
                    />
                  </td>
                  <td className="p-4 text-center">
                    <button
                      onClick={() => setHistoryItemId(rate.linen_item_id)}
                      className="p-2 text-slate-400 hover:text-[#1B4038] dark:hover:text-emerald-500 transition-colors"
                    >
                      <History size={18} />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}

        <div className="p-6 bg-slate-50/50 dark:bg-slate-800/30 border-t border-slate-100 dark:border-slate-800 flex justify-end items-center gap-4">
          {showSuccess && (
            <span className="flex items-center gap-2 text-emerald-600 font-bold text-sm animate-in fade-in slide-in-from-right-4 transition-all">
              <CheckCircle2 size={16} />
              บันทึกเรียบร้อย
            </span>
          )}
          <Button
            onClick={handleSaveAll}
            disabled={isSaving || isLoading}
            className="min-w-[140px] bg-[#1B4038] hover:bg-[#122b26] text-white flex items-center gap-2 font-bold shadow-lg shadow-[#1B4038]/20"
          >
            {isSaving ? <Loader2 size={18} className="animate-spin" /> : <Save size={18} />}
            บันทึกทั้งหมด
          </Button>
        </div>
      </div>

      <RateHistoryModal itemId={historyItemId} onClose={() => setHistoryItemId(null)} />
    </section>
  );
}

function RateHistoryModal({ itemId, onClose }: { itemId: number | null; onClose: () => void }) {
  const { data: history, isLoading } = useLinenRateHistory(itemId || 0);

  return (
    <Dialog open={!!itemId} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>ประวัติราคา</DialogTitle>
        </DialogHeader>

        <div className="py-4">
          {isLoading ? (
            <div className="flex justify-center p-10">
              <Loader2 className="animate-spin text-slate-300" />
            </div>
          ) : history && history.length > 0 ? (
            <div className="space-y-3">
              {history.map((item) => (
                <div key={item.id} className="flex items-center justify-between p-3 bg-slate-50 dark:bg-slate-800 rounded-xl border border-slate-100 dark:border-slate-800">
                  <div>
                    <p className="text-xs font-bold text-slate-400 uppercase tracking-widest">เริ่มใช้เมื่อ</p>
                    <p className="text-sm font-black text-slate-800 dark:text-slate-100 uppercase">{item.effective_month}</p>
                  </div>
                  <div className="text-right">
                    <p className="text-lg font-black text-[#1B4038] dark:text-emerald-400">{item.rate_per_piece.toFixed(2)} ฿</p>
                    <p className="text-[10px] text-slate-400">{item.note || "ไม่มีบันทึก"}</p>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <p className="text-center text-slate-400 text-sm italic">ยังไม่มีประวัติการปรับราคา</p>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
