"use client";

import React, { useEffect, useState } from "react";
import Link from "next/link";
import { ArrowLeft, RefreshCw, FileText, AlertTriangle, CheckCircle, Save, X } from "lucide-react";
import type { AbbreviatedPreviewResponse, ChannelGroup } from "@/lib/abbreviated-tax-invoice/types";

function fmtMoney(num: number) {
  return num.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function fmtDate(isoStr: string) {
  if (!isoStr) return "-";
  return new Date(isoStr).toLocaleDateString("th-TH", { day: "2-digit", month: "2-digit", year: "2-digit" });
}

const CHANNEL_GROUP_LABEL: Record<ChannelGroup, string> = {
  ota: "OTA / Agent",
  walkin_direct: "Walk-in / Direct",
};

export default function AbbreviatedPreviewPage({ params }: { params: { year: string; month: string } }) {
  const year = parseInt(params.year);
  const month = parseInt(params.month);

  const [loading, setLoading] = useState(true);
  const [data, setData] = useState<AbbreviatedPreviewResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [generating, setGenerating] = useState(false);
  const [recalculating, setRecalculating] = useState(false);

  // Modals state
  const [successModal, setSuccessModal] = useState<{ count: number } | null>(null);
  
  const [nightOverrideModal, setNightOverrideModal] = useState<{ 
    entryId: string, 
    guestName: string, 
    dates: string[] 
  } | null>(null);
  
  const [rowShiftModal, setRowShiftModal] = useState<{ 
    taxGroup: string, 
    entries: any[], 
    origDate: string 
  } | null>(null);

  const loadData = async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/tax-invoice/abbreviated/preview?year=${year}&month=${month}`);
      const json = await res.json();
      if (!json.success) throw new Error(json.error ?? "Failed to load preview");
      setData(json.data);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unknown error");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadData();
  }, [year, month]);

  const handleRecalculate = async () => {
    if (!data?.period.audit_period_id) return;
    setRecalculating(true);
    try {
      const res = await fetch(`/api/tax-invoice/abbreviated/recalculate`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ audit_period_id: data.period.audit_period_id })
      });
      const json = await res.json();
      if (!json.success) throw new Error(json.error);
      await loadData();
    } catch (err) {
      alert(err instanceof Error ? err.message : "Failed to recalculate");
    } finally {
      setRecalculating(false);
    }
  };

  const submitNightOverrideBatch = async (selectedDates: string[]) => {
    if (!nightOverrideModal) return;
    try {
      const nights = selectedDates.map(date => ({ date, decision: "include_this_month" }));
      const res = await fetch(`/api/tax-invoice/abbreviated/night-override/batch`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ entry_id: nightOverrideModal.entryId, nights })
      });
      if (!(await res.json()).success) throw new Error("Failed to batch override");
      setNightOverrideModal(null);
      handleRecalculate();
    } catch (err) {
      alert(err instanceof Error ? err.message : "Error applying night override");
    }
  };

  const submitRowShift = async (shifts: any[]) => {
    try {
      const res = await fetch(`/api/tax-invoice/abbreviated/row-shift`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ mode: "pre_generate", shifts })
      });
      if (!(await res.json()).success) throw new Error("Failed to shift row");
      setRowShiftModal(null);
      handleRecalculate();
    } catch (err) {
      alert(err instanceof Error ? err.message : "Error shifting rows");
    }
  };

  const handleGenerate = async () => {
    if (!confirm("ยืนยันสร้างใบกำกับภาษีอย่างย่อ? จะไม่สามารถแก้ไขยอดเงินได้อีกหลังจากอัพเดตเข้าฐานข้อมูล")) return;
    setGenerating(true);
    try {
      const res = await fetch(`/api/tax-invoice/abbreviated/generate`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ year, month })
      });
      const json = await res.json();
      if (!json.success) throw new Error(json.error);
      setSuccessModal({ count: json.data?.invoices_created || 0 });
    } catch (err) {
      alert(err instanceof Error ? err.message : "Failed to generate");
    } finally {
      setGenerating(false);
    }
  };

  return (
    <div className="mx-auto max-w-7xl space-y-4 p-4 relative">
      
      {/* 8. Success Modal */}
      {successModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
          <div className="bg-[var(--bg-surface)] p-6 rounded-xl shadow-2xl w-full max-w-md border border-[var(--border)] overflow-hidden">
             <div className="flex flex-col items-center justify-center space-y-2 mb-6">
               <div className="h-12 w-12 bg-green-100 text-green-600 rounded-full flex items-center justify-center dark:bg-green-900/50 dark:text-green-400">
                 <CheckCircle className="h-6 w-6" />
               </div>
               <h3 className="text-lg font-bold text-[var(--text-primary)]">สร้างใบกำกับภาษีสำเร็จ!</h3>
               <p className="text-sm text-[var(--text-secondary)]">ระบบสร้างใบย่อทั้งหมด {successModal.count} ใบ</p>
             </div>
             
             <div className="flex flex-col gap-3">
               <Link 
                 href={`/pms/tax-invoice/abbreviated/print/period/${year}/${month}?channel_group=ota`}
                 target="_blank"
                 className="flex items-center justify-center gap-2 bg-blue-100 text-blue-700 hover:bg-blue-200 dark:bg-blue-900/40 dark:text-blue-300 px-4 py-3 rounded-lg font-medium transition-colors border border-blue-200 dark:border-blue-800"
               >
                 <FileText className="h-4 w-4" /> พิมพ์ทั้งเดือน (OTA)
               </Link>
               <Link 
                 href={`/pms/tax-invoice/abbreviated/print/period/${year}/${month}?channel_group=walkin_direct`}
                 target="_blank"
                 className="flex items-center justify-center gap-2 bg-green-100 text-green-700 hover:bg-green-200 dark:bg-green-900/40 dark:text-green-300 px-4 py-3 rounded-lg font-medium transition-colors border border-green-200 dark:border-green-800"
               >
                 <FileText className="h-4 w-4" /> พิมพ์ทั้งเดือน (Walk-in/Direct)
               </Link>
             </div>

             <div className="mt-6 pt-4 border-t border-[var(--border)] flex justify-end">
               <button onClick={() => setSuccessModal(null)} className="px-4 py-2 text-sm text-[var(--text-secondary)] hover:bg-[var(--bg-muted)] rounded-lg transition-colors">
                 ปิดหน้าต่าง
               </button>
             </div>
          </div>
        </div>
      )}

      {/* 9. Night Override Modal */}
      {nightOverrideModal && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/60 backdrop-blur-sm">
          <div className="bg-[var(--bg-surface)] p-5 rounded-xl shadow-2xl w-full max-w-sm border border-[var(--border)]">
             <div className="flex justify-between items-start mb-4">
               <div>
                 <h3 className="font-bold text-[var(--text-primary)]">เลือกคืนที่ต้องการนำรวบ</h3>
                 <p className="text-xs text-[var(--text-secondary)] truncate w-[250px]">{nightOverrideModal.guestName}</p>
               </div>
               <button onClick={() => setNightOverrideModal(null)} className="p-1 hover:bg-[var(--bg-muted)] rounded"><X className="h-4 w-4"/></button>
             </div>

             <form onSubmit={(e) => {
               e.preventDefault();
               const fd = new FormData(e.currentTarget);
               const selected = nightOverrideModal.dates.filter(d => fd.get(`night_${d}`) === "on");
               submitNightOverrideBatch(selected);
             }}>
               <div className="space-y-2 mb-6 max-h-[300px] overflow-y-auto pr-2">
                 {nightOverrideModal.dates.map((date) => (
                   <label key={date} className="flex items-center gap-3 p-2 border border-[var(--border)] rounded-lg hover:bg-[var(--bg-muted)] cursor-pointer">
                     <input type="checkbox" name={`night_${date}`} className="h-4 w-4 rounded border-gray-300" />
                     <span className="text-sm font-medium text-[var(--text-primary)]">{fmtDate(date)}</span>
                   </label>
                 ))}
                 {nightOverrideModal.dates.length === 0 && <p className="text-sm text-amber-600">ไม่มีข้อมูลวันที่พักแยกคืน หรือไม่รองรับ Partial</p>}
               </div>

               <div className="flex justify-end gap-2">
                 <button type="button" onClick={() => setNightOverrideModal(null)} className="px-4 py-2 text-sm rounded bg-gray-100 dark:bg-gray-800 text-[var(--text-secondary)]">ยกเลิก</button>
                 <button type="submit" disabled={nightOverrideModal.dates.length === 0} className="px-4 py-2 text-sm rounded bg-amber-600 text-white hover:bg-amber-700 disabled:opacity-50">Force Include Nights</button>
               </div>
             </form>
          </div>
        </div>
      )}

      {/* 10. Row Shift Modal */}
      {rowShiftModal && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/60 backdrop-blur-sm">
          <div className="bg-[var(--bg-surface)] p-5 rounded-xl shadow-2xl w-full max-w-lg border border-[var(--border)]">
             <div className="flex justify-between items-start mb-4">
               <div>
                 <h3 className="font-bold text-[var(--text-primary)]">ย้ายรายการข้ามวัน (Row Shift)</h3>
                 <p className="text-xs text-[var(--text-secondary)] flex items-center gap-2">
                   <span>กลุ่มราคา: {rowShiftModal.taxGroup}</span>
                   <span>|</span>
                   <span>จากวันที่: {fmtDate(rowShiftModal.origDate)}</span>
                 </p>
               </div>
               <button onClick={() => setRowShiftModal(null)} className="p-1 hover:bg-[var(--bg-muted)] rounded"><X className="h-4 w-4"/></button>
             </div>

             <form onSubmit={(e) => {
               e.preventDefault();
               const fd = new FormData(e.currentTarget);
               const shifts: any[] = [];
               
               let targetDate = fd.get("target_date") as string;
               if (!targetDate) return alert("กรุณาเลือกวันที่ปลายทาง");

               rowShiftModal.entries.forEach((ent, idx) => {
                 const qtyToShift = parseInt(fd.get(`qty_${idx}`) as string || "0");
                 if (qtyToShift > 0 && qtyToShift <= ent.quantity) {
                   shifts.push({
                     entry_id: ent.entry_id,
                     tax_group: rowShiftModal.taxGroup,
                     unit_price: ent.unit_price || 0, // Fallback if missing at entry level
                     qty: qtyToShift,
                     original_date: rowShiftModal.origDate,
                     target_date: targetDate
                   });
                 }
               });

               if (shifts.length === 0) return alert("กรุณาระบุจำนวนที่จะย้ายอย่างน้อย 1 รายการ");
               submitRowShift(shifts);
             }}>
               <div className="flex flex-col gap-1 mb-4 pb-4 border-b border-[var(--border)]">
                 <label className="text-sm font-semibold">วันที่ปลายทาง (Target Date):</label>
                 <input type="date" name="target_date" required className="border border-[var(--border)] bg-[var(--bg-primary)] px-3 py-2 rounded text-sm w-full max-w-[200px]" />
               </div>

               <div className="space-y-3 mb-6 max-h-[300px] overflow-y-auto pr-2">
                 {rowShiftModal.entries.map((ent, idx) => (
                   <div key={idx} className="flex items-center gap-4 p-3 border border-[var(--border)] rounded-lg bg-[var(--bg-muted)]/30">
                     <div className="flex-1 min-w-0">
                       <p className="font-medium text-sm text-[var(--text-primary)] truncate">{ent.guest_name}</p>
                       <p className="text-xs text-[var(--text-muted)]">{fmtDate(ent.checkin_date)} &gt; {fmtDate(ent.checkout_date)}</p>
                     </div>
                     <div className="text-right">
                       <p className="text-xs text-[var(--text-muted)] mb-1">จำนวนที่ย้ายได้ (สุด {ent.quantity})</p>
                       <input 
                         type="number" 
                         name={`qty_${idx}`} 
                         min="0" 
                         max={ent.quantity} 
                         defaultValue="0"
                         className="w-20 text-center border border-[var(--border)] rounded bg-[var(--bg-primary)] text-sm px-2 py-1"
                       />
                     </div>
                   </div>
                 ))}
                 {(!rowShiftModal.entries || rowShiftModal.entries.length === 0) && (
                   <p className="text-sm text-red-500">ไม่มีข้อมูล Source Entries ไม่สามารถ Shift แบบกระจายได้</p>
                 )}
               </div>

               <div className="flex justify-end gap-2">
                 <button type="button" onClick={() => setRowShiftModal(null)} className="px-4 py-2 text-sm rounded bg-gray-100 dark:bg-gray-800 text-[var(--text-secondary)] hover:bg-gray-200 dark:hover:bg-gray-700">ยกเลิก</button>
                 <button type="submit" disabled={!rowShiftModal.entries || rowShiftModal.entries.length === 0} className="px-4 py-2 text-sm rounded bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-50">ยืนยันการย้าย</button>
               </div>
             </form>
          </div>
        </div>
      )}


      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-2 mb-1">
            <Link
              href="/pms/tax-invoice/abbreviated"
              className="text-sm font-medium text-[var(--text-muted)] hover:text-[var(--text-primary)] transition flex items-center gap-1"
            >
              <ArrowLeft className="h-3 w-3" />
              Back
            </Link>
          </div>
          <h1 className="text-xl font-bold text-[var(--text-primary)]">
            Preview Invoice ({month.toString().padStart(2, "0")}/{year})
          </h1>
        </div>

        <div className="flex items-center gap-2">
          <button
            onClick={handleRecalculate}
            disabled={loading || recalculating}
            className="flex items-center gap-2 rounded-lg border border-[var(--border)] bg-[var(--bg-surface)] px-4 py-2 text-sm font-medium text-[var(--text-primary)] hover:bg-[var(--bg-surface-hover)] disabled:opacity-50 transition"
          >
            <RefreshCw className={`h-4 w-4 ${recalculating ? "animate-spin text-blue-500" : ""}`} />
            Recalculate
          </button>
          <button
            onClick={handleGenerate}
            disabled={loading || generating || !data || data.drafts.length === 0}
            className="flex items-center gap-2 rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50 transition"
          >
            <Save className="h-4 w-4" />
            {generating ? "Generating..." : "บันทึกและสร้างรันเลขอินวอยซ์ (Generate)"}
          </button>
        </div>
      </div>

      {error ? (
        <div className="rounded-lg bg-rose-50 p-4 text-sm text-rose-700 dark:bg-rose-900/40 dark:text-rose-300 border border-rose-200 dark:border-rose-800">
          {error}
        </div>
      ) : loading ? (
        <div className="py-12 text-center text-sm text-[var(--text-muted)] mt-12 bg-[var(--bg-surface)] rounded-xl border border-[var(--border)]">
          <RefreshCw className="h-6 w-6 animate-spin mx-auto mb-2 text-blue-500" />
          Loading preview data matching with Audit Period... 
        </div>
      ) : data ? (
        <div className="grid gap-4 lg:grid-cols-4">
          
          {/* Summary Panel */}
          <div className="lg:col-span-1 space-y-4">
            <div className="rounded-xl border border-[var(--border)] bg-[var(--bg-surface)] p-4 shadow-sm">
              <h2 className="font-semibold text-[var(--text-primary)] mb-3 text-sm flex items-center gap-2">
                <FileText className="h-4 w-4" /> Summary (ภพ.30)
              </h2>
              <div className="space-y-2 text-sm">
                <div className="flex justify-between">
                  <span className="text-[var(--text-muted)]">จำนวนใบกำกับฯ</span>
                  <span className="font-medium text-[var(--text-primary)]">{data.summary.total_invoices} ใบ</span>
                </div>
                <div className="flex justify-between text-xs pl-2">
                  <span className="text-[var(--text-muted)]">- OTA &amp; Agent</span>
                  <span className="font-medium text-[var(--text-primary)]">{data.summary.ota_count} ใบ</span>
                </div>
                <div className="flex justify-between text-xs pl-2">
                  <span className="text-[var(--text-muted)]">- Walk-in &amp; Direct</span>
                  <span className="font-medium text-[var(--text-primary)]">{data.summary.walkin_direct_count} ใบ</span>
                </div>
                <hr className="border-[var(--border)] my-2" />
                <div className="flex justify-between text-rose-600">
                  <span>ยอดก่อน VAT</span>
                  <span>{fmtMoney(data.summary.grand_total_ex_vat)}</span>
                </div>
                <div className="flex justify-between text-blue-600">
                  <span>VAT (7%)</span>
                  <span>{fmtMoney(data.summary.vat_total)}</span>
                </div>
                <div className="flex justify-between font-bold text-[var(--text-primary)] mt-1 text-base">
                  <span>จำนวนเงินรวม</span>
                  <span>{fmtMoney(data.summary.grand_total_inc_vat)}</span>
                </div>
              </div>
            </div>

            {data.carried.length > 0 && (
              <div className="rounded-xl border border-amber-200 bg-amber-50 p-4 shadow-sm dark:bg-amber-900/10 dark:border-amber-800/50">
                <h3 className="font-semibold text-amber-900 text-xs mb-2 flex items-center gap-1 dark:text-amber-400">
                  <AlertTriangle className="h-3 w-3" /> ยกยอดไปเดือนถัดไป ({data.carried.length})
                </h3>
                <div className="space-y-1 max-h-48 overflow-y-auto">
                  {data.carried.map((c, idx) => (
                    <div key={idx} className="text-[10px] flex justify-between items-start mb-2 pt-2 border-t border-amber-200/50 dark:border-amber-800/40 first:border-0 first:pt-0">
                      <div className="pr-1 flex-1 min-w-0">
                        <p className="font-medium text-amber-900 dark:text-amber-200 truncate w-full" title={c.guest_name}>{c.guest_name}</p>
                        <p className="text-amber-700/80 dark:text-amber-500 mt-0.5">{fmtDate(c.checkin_date)} &gt; {fmtDate(c.checkout_date)}</p>
                      </div>
                      <div className="text-right flex flex-col gap-1.5 items-end ml-1 shrink-0">
                        <span className="inline-block bg-amber-200 text-amber-800 dark:bg-amber-800 dark:text-amber-200 px-1 py-0.5 rounded text-[8px] font-bold">
                          {c.reason === "cross_month" ? `${c.nights_carried} nights` : "Outstanding"}
                        </span>
                        <button 
                          onClick={() => {
                            setNightOverrideModal({ entryId: c.entry_id, guestName: c.guest_name, dates: c.night_dates || [] })
                          }}
                          className="px-1.5 py-0.5 border border-amber-300 rounded text-[9px] font-medium text-amber-700 bg-amber-50 hover:bg-amber-100 transition whitespace-nowrap dark:bg-amber-900/50 dark:text-amber-300 dark:border-amber-700 dark:hover:bg-amber-900"
                        >
                          + Pick Nights...
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}
            
            {data.excluded.length > 0 && (
              <div className="rounded-xl border border-[var(--border)] bg-[var(--bg-muted)] p-4 shadow-sm">
                <h3 className="font-semibold text-[var(--text-primary)] text-xs mb-2 flex items-center gap-1">
                  <CheckCircle className="h-3 w-3 text-emerald-500" /> ลบออกจากอย่างย่ออัตโนมัติ ({data.excluded.length})
                </h3>
                <p className="text-[10px] text-[var(--text-muted)] mb-2">ออกบิลเต็มรูป / DayUse ไปแล้ว</p>
              </div>
            )}
          </div>

          {/* Grid Panel */}
          <div className="lg:col-span-3 space-y-4">
            {data.drafts.length === 0 ? (
               <div className="rounded-xl border border-[var(--border)] bg-[var(--bg-surface)] p-12 text-center shadow-sm">
                 <p className="text-[var(--text-muted)]">No draft invoices generated for this period.</p>
               </div>
            ) : (
              data.drafts.map((draft, idx) => (
                <div key={idx} className="rounded-xl border border-[var(--border)] bg-[var(--bg-surface)] overflow-hidden shadow-sm">
                  <div className="flex items-center justify-between bg-[var(--bg-muted)]/50 p-3 border-b border-[var(--border)]">
                    <div className="flex items-center gap-3">
                      <span className={`text-xs font-bold px-2 py-1 rounded ${draft.channel_group === "ota" ? "bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300" : "bg-green-100 text-green-700 dark:bg-green-900/40 dark:text-green-300"}`}>
                        {CHANNEL_GROUP_LABEL[draft.channel_group]}
                      </span>
                      <span className="text-sm font-semibold text-[var(--text-primary)] text-mono tracking-wide">
                        {draft.predicted_invoice_no}
                      </span>
                    </div>
                    <div className="text-sm font-medium text-[var(--text-secondary)] flex items-center gap-2">
                       {fmtDate(draft.issue_date)}
                    </div>
                  </div>
                  
                  {draft.warning && (
                    <div className="bg-amber-50 text-amber-700 text-xs px-3 py-2 border-b border-amber-200 dark:bg-amber-900/20 dark:text-amber-300 dark:border-amber-800">
                      {draft.warning}
                    </div>
                  )}

                  <table className="w-full text-xs">
                    <thead>
                      <tr className="border-b border-[var(--border)] text-[var(--text-muted)] text-left bg-[var(--bg-surface)]">
                        <th className="p-2 font-medium w-[40px] text-center">Group</th>
                        <th className="p-2 font-medium">รายการ</th>
                        <th className="p-2 font-medium text-right">จำนวน</th>
                        <th className="p-2 font-medium text-right">ราคา/หน่วย</th>
                        <th className="p-2 font-medium text-right">ยอดรวม (Inc.VAT)</th>
                        <th className="p-2 font-medium w-[40px]"></th>
                      </tr>
                    </thead>
                    <tbody>
                      {draft.lines.map((line, lIdx) => (
                        <tr key={lIdx} className="border-b border-[var(--border)] last:border-0 hover:bg-[var(--bg-muted)]/30 group">
                          <td className="p-2 text-center font-bold text-[var(--text-secondary)]">{line.tax_group}</td>
                          <td className="p-2 font-medium text-[var(--text-primary)]">
                            {line.label_th}
                            {line.shifted_from_date && (
                              <span className="ml-2 inline-block px-1.5 py-0.5 rounded-sm bg-purple-100 text-purple-700 text-[9px] dark:bg-purple-900/40 dark:text-purple-300">
                                Shifted
                              </span>
                            )}
                          </td>
                          <td className="p-2 text-right font-mono text-[var(--text-secondary)]">{line.quantity}</td>
                          <td className="p-2 text-right font-mono text-[var(--text-secondary)]">{fmtMoney(line.unit_price)}</td>
                          <td className="p-2 text-right font-mono font-medium text-[var(--text-primary)]">{fmtMoney(line.amount)}</td>
                          <td className="p-2 text-center">
                            <button
                              title="Shift to another day"
                              onClick={() => {
                                const entriesToShift = line.source_entries?.map(e => ({...e, unit_price: line.unit_price})) || [];
                                setRowShiftModal({ taxGroup: line.tax_group, entries: entriesToShift, origDate: draft.issue_date });
                              }}
                              className="opacity-0 group-hover:opacity-100 p-1 text-[10px] rounded border border-[var(--border)] bg-[var(--bg-primary)] hover:bg-[var(--bg-surface-hover)] transition text-[var(--text-secondary)] font-medium"
                            >
                              Shift
                            </button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                    <tfoot className="bg-[var(--bg-muted)]/30 border-t border-[var(--border)]">
                      <tr>
                        <td colSpan={4} className="p-2 text-right font-bold text-[var(--text-primary)]">Total</td>
                        <td className="p-2 text-right font-bold text-blue-600 font-mono text-sm">{fmtMoney(draft.subtotal_inc_vat)}</td>
                        <td></td>
                      </tr>
                    </tfoot>
                  </table>
                </div>
              ))
            )}
          </div>
        </div>
      ) : null}
    </div>
  );
}
