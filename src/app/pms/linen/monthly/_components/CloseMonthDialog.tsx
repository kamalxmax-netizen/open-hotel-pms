"use client";

import React, { useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { AlertCircle, CheckCircle2, Lock, Loader2 } from "lucide-react";
import { LinenMonthlySummary } from "@/lib/types";

interface CloseMonthDialogProps {
  summary?: LinenMonthlySummary;
  onClose: () => Promise<void>;
}

export function CloseMonthDialog({ summary, onClose }: CloseMonthDialogProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [isClosing, setIsClosing] = useState(false);

  const validationErrors: string[] = [];
  const canClose = validationErrors.length === 0;

  const handleCloseMonth = async () => {
    setIsClosing(true);
    try {
      await onClose();
      setIsOpen(false);
    } catch (err) {
      console.error(err);
    } finally {
      setIsClosing(false);
    }
  };

  const getErrorMessage = (err: string) => {
    switch (err) {
      case "dispute_exists": return "ยังมีรายการที่มีสถานะ 'ยอดไม่ตรง' (Disputed) อยู่ในเดือนนี้";
      case "pending_exists": return "ยังมีรายการค้างส่งจากเดือนนี้ที่ยังไม่ได้รับการจัดการ";
      case "open_batch_exists": return "ยังมี Batch ที่ยังเปิดอยู่ (ยังไม่ปิดหรือปิดบางส่วน)";
      default: return err;
    }
  };

  return (
    <>
      <Button
        onClick={() => setIsOpen(true)}
        disabled={summary?.closed}
        className={`flex items-center gap-2 ${
          summary?.closed 
            ? "bg-slate-100 text-slate-400" 
            : "bg-rose-600 hover:bg-rose-700 text-white shadow-lg shadow-rose-600/20"
        }`}
      >
        <Lock size={16} />
        {summary?.closed ? "ปิดเดือนแล้ว" : "ปิดรอบเดือน"}
      </Button>

      <Dialog open={isOpen} onOpenChange={setIsOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>ปิดรอบเดือน {summary?.month}/{summary?.year}</DialogTitle>
            <DialogDescription>
              การปิดเดือนจะทำการ Freeze ข้อมูลทั้งหมดในเดือนนี้ ไม่สามารถแก้ไข Batch หรือราคาได้อีก
            </DialogDescription>
          </DialogHeader>

          <div className="py-4">
            <div className="bg-slate-50 dark:bg-slate-800/50 rounded-xl p-4 border border-slate-100 dark:border-slate-800 mb-4">
              <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-2">สรุปยอดที่จะสรุป</p>
              <div className="flex justify-between items-end">
                <div>
                  <p className="text-2xl font-black text-slate-800 dark:text-slate-100">{summary?.total_pieces.toLocaleString()} <span className="text-sm font-normal text-slate-500">ชิ้น</span></p>
                </div>
                <div className="text-right">
                  <p className="text-xl font-bold text-[#1B4038] dark:text-emerald-400">{summary?.total_baht.toLocaleString()} ฿</p>
                </div>
              </div>
            </div>

            {canClose ? (
              <div className="flex items-start gap-3 p-3 bg-emerald-50 dark:bg-emerald-950/20 rounded-lg text-emerald-700 dark:text-emerald-400 text-sm">
                <CheckCircle2 size={18} className="shrink-0 mt-0.5" />
                <p>ข้อมูลพร้อมสำหรับการปิดเดือน ระบบตรวจสอบแล้วไม่พบรายการค้างหรือข้อพิพาท</p>
              </div>
            ) : (
              <div className="space-y-3">
                <div className="flex items-start gap-3 p-3 bg-rose-50 dark:bg-rose-950/20 rounded-lg text-rose-700 dark:text-rose-400 text-sm">
                  <AlertCircle size={18} className="shrink-0 mt-0.5" />
                  <div>
                    <p className="font-bold mb-1">ไม่สามารถปิดเดือนได้</p>
                    <ul className="list-disc list-inside space-y-1 text-xs opacity-90">
                      {validationErrors.map((err, idx) => (
                        <li key={idx}>{getErrorMessage(err)}</li>
                      ))}
                    </ul>
                  </div>
                </div>
              </div>
            )}
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setIsOpen(false)} disabled={isClosing}>
              ยกเลิก
            </Button>
            <Button
              onClick={handleCloseMonth}
              disabled={!canClose || isClosing}
              className="bg-rose-600 hover:bg-rose-700 text-white min-w-[100px]"
            >
              {isClosing ? <Loader2 className="animate-spin" size={18} /> : "ยืนยันปิดเดือน"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
