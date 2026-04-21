"use client";

import React, { useEffect, useState } from "react";
import Link from "next/link";
import { ArrowLeft, RefreshCw, FileText, CheckCircle, Save } from "lucide-react";
import type { AbbreviatedPreviewResponse } from "@/lib/abbreviated-tax-invoice/types";
import { AbbreviatedInvoicePreviewCard } from "@/components/tax-invoice/AbbreviatedInvoicePreviewCard";

function fmtMoney(num: number) {
  return num.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

export default function DayUseAbbreviatedPreviewPage({ params }: { params: { year: string; month: string } }) {
  const year = parseInt(params.year);
  const month = parseInt(params.month);

  const [loading, setLoading] = useState(true);
  const [data, setData] = useState<AbbreviatedPreviewResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [generating, setGenerating] = useState(false);
  const [successModal, setSuccessModal] = useState<{ count: number } | null>(null);

  const loadData = async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/tax-invoice/abbreviated/preview?year=${year}&month=${month}&source=dayuse`);
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

  const handleGenerate = async () => {
    if (!confirm("ยืนยันสร้างใบกำกับภาษีอย่างย่อสำหรับ Day Use? (ข้อมูลจะไม่สามารถแก้ได้หลังจากนี้)")) return;
    setGenerating(true);
    try {
      const res = await fetch(`/api/tax-invoice/abbreviated/generate`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ year, month, source_type: "dayuse" })
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
      {successModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
          <div className="bg-[var(--bg-surface)] p-6 rounded-xl shadow-2xl w-full max-w-md border border-[var(--border)] overflow-hidden">
             <div className="flex flex-col items-center justify-center space-y-2 mb-6">
               <div className="h-12 w-12 bg-green-100 text-green-600 rounded-full flex items-center justify-center dark:bg-green-900/50 dark:text-green-400">
                 <CheckCircle className="h-6 w-6" />
               </div>
               <h3 className="text-lg font-bold text-[var(--text-primary)]">สร้างใบกำกับภาษีสำเร็จ!</h3>
               <p className="text-sm text-[var(--text-secondary)]">ระบบสร้างใบย่อ Day Use ทั้งหมด {successModal.count} ใบ</p>
             </div>
             
             <div className="flex flex-col gap-3">
               <Link 
                 href={`/pms/tax-invoice/abbreviated/print/period/${year}/${month}?source_type=dayuse`}
                 target="_blank"
                 className="flex items-center justify-center gap-2 bg-emerald-100 text-emerald-700 hover:bg-emerald-200 dark:bg-emerald-900/40 dark:text-emerald-300 px-4 py-3 rounded-lg font-medium transition-colors border border-emerald-200 dark:border-emerald-800"
               >
                 <FileText className="h-4 w-4" /> พิมพ์ใบ Day Use (เดือน {month}/{year})
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

      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-2 mb-1">
            <Link
              href="/pms/preview"
              className="text-sm font-medium text-[var(--text-muted)] hover:text-[var(--text-primary)] transition flex items-center gap-1"
            >
              <ArrowLeft className="h-3 w-3" />
              Back
            </Link>
          </div>
          <h1 className="text-xl font-bold text-[var(--text-primary)]">
            Day Use Preview ({month.toString().padStart(2, "0")}/{year})
          </h1>
        </div>

        <div className="flex items-center gap-2">
          <button
            onClick={loadData}
            disabled={loading}
            className="flex items-center gap-2 rounded-lg border border-[var(--border)] bg-[var(--bg-surface)] px-4 py-2 text-sm font-medium text-[var(--text-primary)] hover:bg-[var(--bg-surface-hover)] disabled:opacity-50 transition"
          >
            <RefreshCw className={`h-4 w-4 ${loading ? "animate-spin text-blue-500" : ""}`} />
            Refresh
          </button>
          <button
            onClick={handleGenerate}
            disabled={loading || generating || !data || data.drafts.length === 0}
            className="flex items-center gap-2 rounded-lg bg-emerald-600 px-4 py-2 text-sm font-medium text-white hover:bg-emerald-700 disabled:opacity-50 transition"
          >
            <Save className="h-4 w-4" />
            {generating ? "Generating..." : "บันทึกข้อมูล (Generate Day Use)"}
          </button>
        </div>
      </div>

      {error ? (
        <div className="rounded-lg bg-rose-50 p-4 text-sm text-rose-700 border border-rose-200">
          {error}
        </div>
      ) : loading ? (
        <div className="py-12 text-center text-sm text-[var(--text-muted)] mt-12 bg-[var(--bg-surface)] rounded-xl border border-[var(--border)]">
          <RefreshCw className="h-6 w-6 animate-spin mx-auto mb-2 text-emerald-500" />
          Loading Day Use data...
        </div>
      ) : data ? (
        <div className="grid gap-4 lg:grid-cols-4">
          <div className="lg:col-span-1 space-y-4">
            <div className="rounded-xl border border-[var(--border)] bg-[var(--bg-surface)] p-4 shadow-sm">
              <h2 className="font-semibold text-[var(--text-primary)] mb-3 text-sm flex items-center gap-2">
                <FileText className="h-4 w-4" /> Day Use Summary
              </h2>
              <div className="space-y-2 text-sm">
                <div className="flex justify-between font-bold text-[var(--text-primary)] mt-1 text-base">
                  <span>รวมทั้งสิ้น (Inc.VAT)</span>
                  <span>{fmtMoney(data.summary.grand_total_inc_vat)}</span>
                </div>
              </div>
            </div>
          </div>
          <div className="lg:col-span-3 space-y-4">
            {data.drafts.length === 0 ? (
               <div className="rounded-xl border border-[var(--border)] bg-[var(--bg-surface)] p-12 text-center shadow-sm">
                 <p className="text-[var(--text-muted)]">ไม่มีรายได้ Day Use ในเดือนนี้</p>
               </div>
            ) : (
               data.drafts.map((draft, idx) => (
                 <AbbreviatedInvoicePreviewCard
                   key={idx}
                   draft={draft}
                   variant="dayuse"
                 />
               ))
            )}
          </div>
        </div>
      ) : null}
    </div>
  );
}
