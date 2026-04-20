"use client";

import React, { useState } from "react";
import Link from "next/link";
import { FileText, ArrowRight, Table } from "lucide-react";

export default function AbbreviatedDashboardPage() {
  const [selectedYear, setSelectedYear] = useState(() => new Date().getFullYear());
  const [selectedMonth, setSelectedMonth] = useState(() => new Date().getMonth() + 1);

  const MONTHS = [
    "มกราคม", "กุมภาพันธ์", "มีนาคม", "เมษายน", "พฤษภาคม", "มิถุนายน",
    "กรกฎาคม", "สิงหาคม", "กันยายน", "ตุลาคม", "พฤศจิกายน", "ธันวาคม",
  ];

  const yearOptions = [];
  for (let y = 2025; y <= new Date().getFullYear() + 1; y++) yearOptions.push(y);

  return (
    <div className="mx-auto max-w-4xl space-y-6 p-6">
      {/* Header */}
      <div>
        <div className="flex items-center gap-2 mb-1">
          <Link
            href="/pms/tax-invoice"
            className="text-sm text-[var(--text-muted)] hover:text-[var(--text-primary)] transition-colors"
          >
            Tax Invoice
          </Link>
          <span className="text-[var(--text-muted)]">/</span>
          <h1 className="text-2xl font-bold text-[var(--text-primary)]">ใบกำกับภาษีอย่างย่อ (รายวัน)</h1>
        </div>
        <p className="text-[var(--text-secondary)]">ออกใบกำกับภาษีอย่างย่อสำหรับการปรับเข้า ภพ.30 ประจำเดือน</p>
      </div>

      <div className="grid gap-6 md:grid-cols-2">
        {/* Selector Card */}
        <div className="rounded-xl border border-[var(--border)] bg-[var(--bg-surface)] p-6 shadow-sm flex flex-col items-start gap-4">
          <div className="flex items-center gap-3 w-full border-b border-[var(--border)] pb-4">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-blue-100 text-blue-600 dark:bg-blue-900/40 dark:text-blue-400">
              <Table className="h-5 w-5" />
            </div>
            <div>
              <h2 className="font-semibold text-[var(--text-primary)]">เลือกเดือนเพื่อตรวจสอบ</h2>
              <p className="text-xs text-[var(--text-muted)]">พิมพ์หรือสรุปยอดรายเดือนที่ Monthly Audit แล้ว</p>
            </div>
          </div>
          
          <div className="flex w-full gap-3 mt-2">
            <div className="flex-1">
              <label className="block text-xs font-medium text-[var(--text-secondary)] mb-1">ปี / Year</label>
              <select
                className="w-full rounded-lg border border-[var(--border)] bg-[var(--bg-primary)] px-3 py-2 text-sm text-[var(--text-primary)]"
                value={selectedYear}
                onChange={(e) => setSelectedYear(Number(e.target.value))}
              >
                {yearOptions.map(y => <option key={y} value={y}>{y}</option>)}
              </select>
            </div>
            <div className="flex-1">
              <label className="block text-xs font-medium text-[var(--text-secondary)] mb-1">เดือน / Month</label>
              <select
                className="w-full rounded-lg border border-[var(--border)] bg-[var(--bg-primary)] px-3 py-2 text-sm text-[var(--text-primary)]"
                value={selectedMonth}
                onChange={(e) => setSelectedMonth(Number(e.target.value))}
              >
                {MONTHS.map((label, i) => (
                  <option key={i} value={i + 1}>{label}</option>
                ))}
              </select>
            </div>
          </div>

          <Link
            href={`/pms/tax-invoice/abbreviated/preview/${selectedYear}/${selectedMonth}`}
            className="mt-4 flex w-full items-center justify-center gap-2 rounded-lg bg-blue-600 px-4 py-2.5 text-sm font-medium text-white shadow-sm hover:bg-blue-700 transition"
          >
            เปิดตาราง Live Preview
            <ArrowRight className="h-4 w-4" />
          </Link>
        </div>

        {/* Info Card */}
        <div className="rounded-xl bg-orange-50/50 dark:bg-orange-950/20 border border-orange-200 dark:border-orange-900/30 p-6 flex flex-col gap-3">
          <h3 className="font-semibold text-orange-900 dark:text-orange-300 flex items-center gap-2">
            <FileText className="h-4 w-4" />
            ข้อมูลการนำส่ง ภพ.30
          </h3>
          <ul className="list-disc pl-4 space-y-1.5 text-xs text-orange-800 dark:text-orange-200/80 leading-relaxed">
            <li>ยอดใบกำกับภาษีอย่างย่อถูกผูกผูกติดมากับ <Link href="/pms/audit/monthly" className="underline font-medium hover:text-orange-600">Monthly Audit</Link> เสมอ</li>
            <li>รายการที่ปรากฎคือรายการที่ Check-out และชำระเงินแล้วเท่านั้น</li>
            <li>Folio ที่มี <b>Full Tax Invoice (ใบกำกับฯ เต็มรูป)</b> หรือ Folio ประเภท <b>POS / Day Use (Phase 71)</b> จะถูกหักออกให้โดยอัตโนมัติ ไม่นับซ้ำ</li>
            <li>ยอดค้างชำระ (Outstanding &gt; 0) ระบบจะ <span className="font-semibold underline">ยกยอด</span> ข้ามไปเดือนหน้าให้เป็น default (สามารถแก้ไข Override manual แบบ per-night ได้ในหน้า Preview)</li>
          </ul>
        </div>
      </div>
    </div>
  );
}
