"use client";

import React, { useMemo, useState } from "react";
import { CalendarDays, ChevronDown, Loader2, RefreshCw, RotateCcw } from "lucide-react";
import useSWR from "@/hooks/use-simple-swr";
import { apiDataFetcher } from "@/lib/client/api-fetcher";
import type { LinenDailySnapshotItem, LinenDailySnapshotResponse } from "@/lib/types";

type SectionKey = "sent" | "received" | "balance";

type Column = {
  key: keyof LinenDailySnapshotItem;
  label: string;
};

type SnapshotSection = {
  key: SectionKey;
  title: string;
  subtitle: string;
  emptyText: string;
  columns: Column[];
};

const SECTIONS: SnapshotSection[] = [
  {
    key: "sent",
    title: "Section 1 · ผ้าส่งวันนี้",
    subtitle: "แยกผ้าปกติ, Rewash, และผ้าเก่า Day use",
    emptyText: "วันนี้ไม่มีรายการส่งผ้า",
    columns: [
      { key: "sent_normal", label: "ส่งปกติ" },
      { key: "sent_rewash", label: "ส่ง Rewash" },
      { key: "sent_old_dayuse", label: "ส่งผ้าเก่า" },
    ],
  },
  {
    key: "received",
    title: "Section 2 · ผ้ารับวันนี้",
    subtitle: "รับปกติ, รับ Rewash, รับผ้าค้าง และรับผ้าเก่า",
    emptyText: "วันนี้ไม่มีรายการรับคืน",
    columns: [
      { key: "received_normal", label: "รับปกติ" },
      { key: "received_rewash", label: "รับ Rewash" },
      { key: "received_pending", label: "รับผ้าค้าง" },
      { key: "received_old_dayuse", label: "รับผ้าเก่า" },
    ],
  },
  {
    key: "balance",
    title: "Section 3 · ผ้าคงเหลือที่ Vendor",
    subtitle: "ยอดหลังหักรับคืนวันนี้แล้ว แยกที่มาให้ตรวจยอดต่อได้",
    emptyText: "ไม่มีผ้าคงเหลือที่ Vendor",
    columns: [
      { key: "balance_normal_today", label: "ปกติวันนี้" },
      { key: "balance_old_dayuse", label: "ผ้าเก่า" },
      { key: "balance_pending_old", label: "ค้างเดิม" },
      { key: "balance_rewash", label: "Rewash" },
    ],
  },
];

function bangkokDate() {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Bangkok" }).format(new Date());
}

function formatNumber(value: unknown) {
  return new Intl.NumberFormat("th-TH").format(Number(value ?? 0));
}

function sectionTotal(item: LinenDailySnapshotItem, columns: Column[]) {
  return columns.reduce((sum, column) => sum + Number(item[column.key] ?? 0), 0);
}

function SectionTable({ section, items }: { section: SnapshotSection; items: LinenDailySnapshotItem[] }) {
  const visibleRows = items.filter((item) => sectionTotal(item, section.columns) > 0);
  const total = visibleRows.reduce((sum, item) => sum + sectionTotal(item, section.columns), 0);

  return (
    <details className="group border-t border-[var(--border-default)] first:border-t-0" open>
      <summary className="flex cursor-pointer list-none items-center justify-between gap-4 px-4 py-4 hover:bg-[var(--bg-surface-hover)]">
        <div>
          <h3 className="font-thai text-base font-black text-[var(--text-primary)]">{section.title}</h3>
          <p className="mt-0.5 text-xs text-[var(--text-secondary)]">{section.subtitle}</p>
        </div>
        <div className="flex items-center gap-3">
          <div className="text-right">
            <p className="text-xl font-black tabular-nums text-[var(--text-primary)]">{formatNumber(total)}</p>
            <p className="text-[10px] font-bold uppercase tracking-wider text-[var(--text-muted)]">pieces</p>
          </div>
          <ChevronDown className="h-4 w-4 text-[var(--text-muted)] transition-transform group-open:rotate-180" />
        </div>
      </summary>

      {visibleRows.length === 0 ? (
        <div className="border-t border-[var(--border-subtle)] px-4 py-8 text-center font-thai text-sm text-[var(--text-muted)]">
          {section.emptyText}
        </div>
      ) : (
        <div className="overflow-x-auto border-t border-[var(--border-subtle)]">
          <table className="min-w-[760px] w-full border-collapse text-sm">
            <thead>
              <tr className="bg-[var(--bg-muted)] text-[10px] uppercase tracking-[0.16em] text-[var(--text-secondary)]">
                <th className="sticky left-0 z-10 bg-[var(--bg-muted)] px-4 py-3 text-left font-black">Item</th>
                {section.columns.map((column) => (
                  <th key={String(column.key)} className="px-3 py-3 text-right font-black">{column.label}</th>
                ))}
                <th className="px-4 py-3 text-right font-black">รวม</th>
              </tr>
            </thead>
            <tbody>
              {visibleRows.map((item) => (
                <tr key={`${section.key}-${item.linen_item_id}`} className="border-t border-[var(--border-subtle)] hover:bg-[var(--bg-surface-hover)]">
                  <td className="sticky left-0 z-10 bg-[var(--bg-surface)] px-4 py-3 font-thai font-bold text-[var(--text-primary)]">
                    <span className="mr-2 text-xs font-black text-[var(--text-muted)]">{item.item_number ?? "-"}</span>
                    {item.name_th}
                  </td>
                  {section.columns.map((column) => {
                    const value = Number(item[column.key] ?? 0);
                    return (
                      <td key={String(column.key)} className="px-3 py-3 text-right font-semibold tabular-nums text-[var(--text-table-cell)]">
                        {value > 0 ? formatNumber(value) : <span className="text-[var(--text-muted)]">-</span>}
                      </td>
                    );
                  })}
                  <td className="px-4 py-3 text-right text-base font-black tabular-nums text-[var(--text-primary)]">
                    {formatNumber(sectionTotal(item, section.columns))}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </details>
  );
}

export function LinenDailySnapshotSection() {
  const [selectedDate, setSelectedDate] = useState(bangkokDate);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const url = `/api/linen/snapshots?business_date=${selectedDate}`;
  const { data, error, isLoading, isValidating, mutate } = useSWR<LinenDailySnapshotResponse>(url, apiDataFetcher);
  const snapshot = data?.snapshot ?? null;

  const totals = useMemo(() => {
    const t = snapshot?.totals;
    return {
      sent: Number(t?.sent_normal ?? 0) + Number(t?.sent_rewash ?? 0) + Number(t?.sent_old_dayuse ?? 0),
      received: Number(t?.received_normal ?? 0) + Number(t?.received_rewash ?? 0) + Number(t?.received_pending ?? 0) + Number(t?.received_old_dayuse ?? 0),
      balance: Number(t?.balance_vendor ?? 0),
    };
  }, [snapshot]);

  const handleRecompute = async () => {
    const reason = snapshot
      ? window.prompt("เหตุผลในการ recompute snapshot วันนี้", "แก้ไขย้อนหลัง / ตรวจยอดใหม่")
      : "Create first snapshot";
    if (reason === null) return;
    setBusy(true);
    setMessage(null);
    try {
      const response = await fetch("/api/linen/snapshots/recompute", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ business_date: selectedDate, reason }),
      });
      const payload = await response.json().catch(() => null);
      if (!response.ok || payload?.success === false) {
        throw new Error(payload?.error ?? "Failed to recompute snapshot");
      }
      setMessage("Snapshot updated");
      await mutate();
    } catch (err) {
      setMessage(err instanceof Error ? err.message : "Failed to recompute snapshot");
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="overflow-hidden rounded-2xl border border-[var(--border-default)] bg-[var(--bg-surface)] shadow-sm animate-in fade-in slide-in-from-bottom-2 duration-200">
      <div className="flex flex-col gap-4 border-b border-[var(--border-default)] px-5 py-5 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <p className="text-[10px] font-black uppercase tracking-[0.24em] text-[var(--text-muted)]">Frozen Daily Ledger</p>
          <h2 className="mt-1 font-thai text-xl font-black text-[var(--text-primary)]">Daily Linen Snapshot</h2>
          <p className="mt-1 max-w-2xl font-thai text-sm text-[var(--text-secondary)]">
            ยอดรายวันแบบ Freeze แยกผ้าส่ง, ผ้ารับ และยอดคงเหลือที่ Vendor
          </p>
        </div>

        <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
          <label className="flex items-center gap-2 rounded-xl border border-[var(--border-input)] bg-[var(--bg-body)] px-3 py-2">
            <CalendarDays className="h-4 w-4 text-[var(--text-muted)]" />
            <input
              type="date"
              value={selectedDate}
              onChange={(event) => {
                setSelectedDate(event.target.value);
                setMessage(null);
              }}
              className="bg-transparent text-sm font-bold text-[var(--text-primary)] outline-none"
            />
          </label>

          {data?.can_recompute && (
            <button
              type="button"
              onClick={handleRecompute}
              disabled={busy}
              className="inline-flex items-center justify-center gap-2 rounded-xl bg-[#1B4038] px-4 py-2 text-sm font-black text-white transition hover:bg-[#24584d] disabled:cursor-not-allowed disabled:opacity-60 dark:bg-emerald-600 dark:hover:bg-emerald-500"
            >
              {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <RotateCcw className="h-4 w-4" />}
              {snapshot ? "Recompute" : "Create Snapshot"}
            </button>
          )}
        </div>
      </div>

      <div className="grid grid-cols-1 divide-y divide-[var(--border-default)] border-b border-[var(--border-default)] md:grid-cols-3 md:divide-x md:divide-y-0">
        <div className="px-5 py-4">
          <p className="text-xs font-bold text-[var(--text-secondary)]">ผ้าส่งวันนี้</p>
          <p className="mt-1 text-3xl font-black tabular-nums text-[var(--text-primary)]">{formatNumber(totals.sent)}</p>
        </div>
        <div className="px-5 py-4">
          <p className="text-xs font-bold text-[var(--text-secondary)]">ผ้ารับวันนี้</p>
          <p className="mt-1 text-3xl font-black tabular-nums text-[var(--text-primary)]">{formatNumber(totals.received)}</p>
        </div>
        <div className="px-5 py-4">
          <p className="text-xs font-bold text-[var(--text-secondary)]">คงเหลือที่ Vendor</p>
          <p className="mt-1 text-3xl font-black tabular-nums text-[var(--text-primary)]">{formatNumber(totals.balance)}</p>
        </div>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3 bg-[var(--bg-body)] px-5 py-3 text-xs text-[var(--text-secondary)]">
        <div className="flex items-center gap-2">
          {isLoading || isValidating ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />}
          {snapshot
            ? `Computed ${new Date(snapshot.computed_at).toLocaleString("th-TH")} · recomputed ${snapshot.recomputed_count} time(s)`
            : "ยังไม่มี snapshot สำหรับวันนี้"}
        </div>
        {message && <p className="font-semibold text-[var(--text-primary)]">{message}</p>}
        {error && <p className="font-semibold text-rose-600 dark:text-rose-400">{error.message}</p>}
      </div>

      {snapshot ? (
        <div>
          {SECTIONS.map((section) => (
            <SectionTable key={section.key} section={section} items={snapshot.items} />
          ))}
        </div>
      ) : (
        <div className="px-5 py-12 text-center">
          <p className="font-thai text-base font-bold text-[var(--text-primary)]">ยังไม่มี Snapshot ของวันที่เลือก</p>
          <p className="mt-1 font-thai text-sm text-[var(--text-secondary)]">
            ระบบจะสร้างอัตโนมัติตอน EOD หรือให้ Admin/Supervisor กด Create Snapshot ได้ทันที
          </p>
        </div>
      )}
    </section>
  );
}
