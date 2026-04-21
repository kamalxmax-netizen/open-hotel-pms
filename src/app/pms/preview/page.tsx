"use client";

import React, { useState } from "react";
import Link from "next/link";
import { Bed, Sun, ShoppingCart, ArrowRight } from "lucide-react";

export default function PreviewIndexPage() {
  const [selectedYear, setSelectedYear] = useState(() => new Date().getFullYear());
  const [selectedMonth, setSelectedMonth] = useState(() => new Date().getMonth() + 1);
  const [selectedDate, setSelectedDate] = useState(() => new Date().toISOString().split("T")[0]);

  const yearOptions = [];
  for (let y = 2025; y <= new Date().getFullYear() + 1; y++) yearOptions.push(y);

  const MONTHS = [
    "มกราคม", "กุมภาพันธ์", "มีนาคม", "เมษายน", "พฤษภาคม", "มิถุนายน",
    "กรกฎาคม", "สิงหาคม", "กันยายน", "ตุลาคม", "พฤศจิกายน", "ธันวาคม",
  ];

  return (
    <div className="mx-auto max-w-5xl space-y-8 p-6">
      <div className="text-center space-y-2">
        <h1 className="text-3xl font-bold text-[var(--text-primary)]">ใบกำกับภาษีอย่างย่อ (Abbreviated Tax Invoices)</h1>
        <p className="text-[var(--text-secondary)]">เลือกหมวดหมู่ที่ต้องการดูรายการก่อนการเจเนอเรตและพิมพ์</p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mt-8">
        {/* Room Card */}
        <div className="rounded-xl border border-[var(--border)] bg-[var(--bg-surface)] p-6 shadow-sm hover:shadow-md transition-shadow flex flex-col gap-4 dark:border-white/10">
          <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-lg bg-blue-100 text-blue-600 dark:bg-blue-900/40 dark:text-blue-400">
            <Bed className="h-6 w-6" />
          </div>
          <div>
            <h2 className="text-lg font-bold text-[var(--text-primary)]">ห้องพัก (Room)</h2>
            <p className="text-xs text-[var(--text-secondary)] mt-1">ออกใบกำกับภาษีอย่างย่อรายวัน ผูกตาม Monthly Audit หักใบเต็มรูป</p>
          </div>
          
          <div className="flex w-full gap-2 mt-auto pt-4 border-t border-[var(--border)] dark:border-white/10">
            <select
              className="w-1/2 rounded-md border border-[var(--border-input)] bg-[var(--bg-primary)] px-2 py-1.5 text-sm dark:border-white/10"
              value={selectedYear}
              onChange={(e) => setSelectedYear(Number(e.target.value))}
            >
              {yearOptions.map(y => <option key={y} value={y}>{y}</option>)}
            </select>
            <select
              className="w-1/2 rounded-md border border-[var(--border-input)] bg-[var(--bg-primary)] px-2 py-1.5 text-sm dark:border-white/10"
              value={selectedMonth}
              onChange={(e) => setSelectedMonth(Number(e.target.value))}
            >
              {MONTHS.map((label, i) => <option key={i} value={i + 1}>{label}</option>)}
            </select>
          </div>
          <Link
            href={`/pms/tax-invoice/abbreviated/preview/${selectedYear}/${selectedMonth}`}
            className="flex w-full items-center justify-center gap-2 rounded-lg bg-[var(--bg-muted)] hover:bg-[var(--bg-surface-hover)] border border-[var(--border)] px-4 py-2 font-medium text-[var(--text-primary)] transition dark:border-white/10"
          >
            เปิดตาราง Preview <ArrowRight className="h-4 w-4" />
          </Link>
        </div>

        {/* Day Use Card */}
        <div className="rounded-xl border border-[var(--border)] bg-[var(--bg-surface)] p-6 shadow-sm hover:shadow-md transition-shadow flex flex-col gap-4 dark:border-white/10">
          <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-lg bg-emerald-100 text-emerald-600 dark:bg-emerald-900/40 dark:text-emerald-400">
            <Sun className="h-6 w-6" />
          </div>
          <div>
            <h2 className="text-lg font-bold text-[var(--text-primary)]">Day Use</h2>
            <p className="text-xs text-[var(--text-secondary)] mt-1">ใบกำกับภาษีรวม 1 ใบต่อเดือน สำหรับลูกค้า Walk-in เท่านั้น</p>
          </div>
          
          <div className="flex w-full gap-2 mt-auto pt-4 border-t border-[var(--border)] dark:border-white/10">
            <select
              className="w-1/2 rounded-md border border-[var(--border-input)] bg-[var(--bg-primary)] px-2 py-1.5 text-sm dark:border-white/10"
              value={selectedYear}
              onChange={(e) => setSelectedYear(Number(e.target.value))}
            >
              {yearOptions.map(y => <option key={y} value={y}>{y}</option>)}
            </select>
            <select
              className="w-1/2 rounded-md border border-[var(--border-input)] bg-[var(--bg-primary)] px-2 py-1.5 text-sm dark:border-white/10"
              value={selectedMonth}
              onChange={(e) => setSelectedMonth(Number(e.target.value))}
            >
              {MONTHS.map((label, i) => <option key={i} value={i + 1}>{label}</option>)}
            </select>
          </div>
          <Link
            href={`/pms/preview/dayuse/${selectedYear}/${selectedMonth}`}
            className="flex w-full items-center justify-center gap-2 rounded-lg bg-[var(--bg-muted)] hover:bg-[var(--bg-surface-hover)] border border-[var(--border)] px-4 py-2 font-medium text-[var(--text-primary)] transition dark:border-white/10"
          >
            เปิดตาราง Preview <ArrowRight className="h-4 w-4" />
          </Link>
        </div>

        {/* POS Card */}
        <div className="rounded-xl border border-[var(--border)] bg-[var(--bg-surface)] p-6 shadow-sm hover:shadow-md transition-shadow flex flex-col gap-4 dark:border-white/10">
          <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-lg bg-orange-100 text-orange-600 dark:bg-orange-900/40 dark:text-orange-400">
            <ShoppingCart className="h-6 w-6" />
          </div>
          <div>
            <h2 className="text-lg font-bold text-[var(--text-primary)]">POS</h2>
            <p className="text-xs text-[var(--text-secondary)] mt-1">ใบกำกับภาษีแยกรายวัน สำหรับรายการขายแบบ POS (Walk-in)</p>
          </div>
          
          <div className="flex w-full mt-auto pt-4 border-t border-[var(--border)] dark:border-white/10">
            <input 
              type="date"
              className="w-full rounded-md border border-[var(--border-input)] bg-[var(--bg-primary)] px-3 py-1.5 text-sm dark:border-white/10"
              value={selectedDate}
              onChange={(e) => setSelectedDate(e.target.value)}
            />
          </div>
          <Link
            href={`/pms/preview/pos/${selectedDate}`}
            className="flex w-full items-center justify-center gap-2 rounded-lg bg-[var(--bg-muted)] hover:bg-[var(--bg-surface-hover)] border border-[var(--border)] px-4 py-2 font-medium text-[var(--text-primary)] transition dark:border-white/10"
          >
            เปิดตาราง Preview <ArrowRight className="h-4 w-4" />
          </Link>
        </div>
      </div>
    </div>
  );
}
