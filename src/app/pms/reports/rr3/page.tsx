"use client";

import React, { useCallback, useEffect, useMemo, useState } from "react";
import type { RR3GuestRecord, RR3Validation } from "@/lib/gov-export/types";

// ============================================================
// Helpers
// ============================================================

const MONTHS = [
  "มกราคม", "กุมภาพันธ์", "มีนาคม", "เมษายน", "พฤษภาคม", "มิถุนายน",
  "กรกฎาคม", "สิงหาคม", "กันยายน", "ตุลาคม", "พฤศจิกายน", "ธันวาคม",
];

function getBangkokNow(): { year: number; month: number } {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Bangkok",
    year: "numeric",
    month: "2-digit",
  }).formatToParts(new Date());
  const y = Number(parts.find((p) => p.type === "year")?.value ?? new Date().getFullYear());
  const m = Number(parts.find((p) => p.type === "month")?.value ?? new Date().getMonth() + 1);
  return { year: y, month: m };
}

function fmtDate(dateStr: string | null): string {
  if (!dateStr) return "-";
  const d = new Date(dateStr + "T00:00:00");
  if (isNaN(d.getTime())) return dateStr;
  return d.toLocaleDateString("en-GB", { timeZone: "Asia/Bangkok", day: "2-digit", month: "2-digit" });
}

function fmtDateTime(isoString: string | null): string {
  if (!isoString) return "-";
  const d = new Date(isoString);
  if (isNaN(d.getTime())) return isoString;
  const dateObj = d.toLocaleDateString("en-GB", { timeZone: "Asia/Bangkok", day: "2-digit", month: "2-digit", year: "numeric" });
  const timeObj = d.toLocaleTimeString("en-GB", { timeZone: "Asia/Bangkok", hour: "2-digit", minute: "2-digit" });
  return `${dateObj} ${timeObj}`;
}

function fmtMoney(num: number): string {
  return num.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

// ============================================================
// Component
// ============================================================

export default function RR3Page() {
  const now = getBangkokNow();
  const defaultMonth = now.month;
  const defaultYear = now.year;

  const [selectedYear, setSelectedYear] = useState(defaultYear);
  const [selectedMonth, setSelectedMonth] = useState(defaultMonth);

  // Filters
  const [sources, setSources] = useState<string[]>(["ota", "walkin", "direct"]);
  const [taxInvoiceOnly, setTaxInvoiceOnly] = useState(false);
  const [includeAccompanying, setIncludeAccompanying] = useState(true);

  // Data
  const [entries, setEntries] = useState<RR3GuestRecord[]>([]);
  const [validations, setValidations] = useState<RR3Validation[]>([]);
  const [summary, setSummary] = useState({ total_price: 0 });
  
  // UI Loading/Error
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const yearOptions = useMemo(() => {
    const years: number[] = [];
    for (let y = 2025; y <= now.year + 1; y++) years.push(y);
    return years;
  }, [now.year]);

  const loadData = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams();
      params.set("year", String(selectedYear));
      params.set("month", String(selectedMonth));
      if (sources.length > 0) params.set("sources", sources.join(","));
      params.set("tax_invoice", String(taxInvoiceOnly));
      params.set("include_accompanying", String(includeAccompanying));

      const res = await fetch(`/api/reports/rr3?${params.toString()}`);
      const json = await res.json();

      if (!res.ok || !json.success) {
        throw new Error(json.error ?? "Failed to load รร.3 records");
      }

      setEntries(json.entries ?? []);
      setValidations(json.validations ?? []);
      const apiTotalPrice = Number(json.summary?.total_price);
      if (Number.isFinite(apiTotalPrice)) {
        setSummary({ total_price: apiTotalPrice });
      } else {
        const totalPrice = (json.entries ?? []).reduce((acc: number, entry: RR3GuestRecord) => {
          if (entry.role === "primary") return acc + (entry.total_price || 0);
          return acc;
        }, 0);
        setSummary({ total_price: totalPrice });
      }

    } catch (err) {
      setEntries([]);
      setValidations([]);
      setSummary({ total_price: 0 });
      setError(err instanceof Error ? err.message : "Failed to load รร.3 data");
    } finally {
      setLoading(false);
    }
  }, [selectedYear, selectedMonth, sources, taxInvoiceOnly, includeAccompanying]);

  useEffect(() => {
    void loadData();
  }, [loadData]);

  const handleSourceToggle = (val: string) => {
    setSources((prev) =>
      prev.includes(val) ? prev.filter((s) => s !== val) : [...prev, val]
    );
  };

  const getExportHref = () => {
    const params = new URLSearchParams();
    params.set("year", String(selectedYear));
    params.set("month", String(selectedMonth));
    if (sources.length > 0) params.set("sources", sources.join(","));
    params.set("tax_invoice", String(taxInvoiceOnly));
    params.set("include_accompanying", String(includeAccompanying));
    params.set("format", "xlsx");
    return `/api/reports/rr3?${params.toString()}`;
  };

  const canExport = entries.length > 0;

  return (
    <div className="mx-auto max-w-[1400px] space-y-4 p-4 pb-10">
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <div className="flex items-center gap-2">
            <h1 className="text-xl font-bold text-[var(--text-primary)]">รร.3 — ทะเบียนผู้เข้าพัก</h1>
          </div>
          <p className="text-sm text-[var(--text-muted)] mt-0.5">
            Monthly guest registration form (Hotel Registration)
          </p>
        </div>

        <div className="flex items-center gap-2">
          {canExport ? (
            <a
              href={getExportHref()}
              download
              className="rounded-lg bg-emerald-600 px-4 py-2 text-sm font-medium text-white hover:bg-emerald-700 transition-colors inline-flex items-center gap-2 shadow-sm"
            >
              📥 Download .xlsx
            </a>
          ) : (
            <button
              disabled
              className="rounded-lg bg-gray-200 dark:bg-gray-800 text-gray-400 dark:text-gray-500 px-4 py-2 text-sm font-medium cursor-not-allowed inline-flex items-center gap-2 border border-gray-300 dark:border-gray-700"
            >
              📥 Download .xlsx
            </button>
          )}
        </div>
      </div>

      {/* Filters Panel */}
      <div className="flex flex-col gap-4 rounded-lg border border-black/10 dark:border-white/10 bg-[var(--bg-surface)] p-4 shadow-sm">
        <div className="flex flex-wrap items-center gap-3 border-b border-black/5 dark:border-white/5 pb-4">
          <div className="flex items-center gap-2">
            <label className="text-sm font-semibold text-[var(--text-secondary)]">Month:</label>
            <select
              className="rounded border border-black/10 dark:border-white/10 bg-[var(--bg-primary)] px-2 py-1.5 text-sm text-[var(--text-primary)] min-w-[120px]"
              value={selectedMonth}
              onChange={(e) => setSelectedMonth(Number(e.target.value))}
            >
              {MONTHS.map((label, idx) => (
                <option key={idx} value={idx + 1}>{label}</option>
              ))}
            </select>
          </div>
          <div className="flex items-center gap-2">
            <label className="text-sm font-semibold text-[var(--text-secondary)]">Year:</label>
            <select
              className="rounded border border-black/10 dark:border-white/10 bg-[var(--bg-primary)] px-2 py-1.5 text-sm text-[var(--text-primary)]"
              value={selectedYear}
              onChange={(e) => setSelectedYear(Number(e.target.value))}
            >
              {yearOptions.map((y) => (
                <option key={y} value={y}>{y}</option>
              ))}
            </select>
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-6 pt-2">
          <div>
            <label className="block text-xs font-semibold uppercase tracking-wider text-[var(--text-muted)] mb-2">Source</label>
            <div className="flex items-center gap-4">
              {["ota", "walkin", "direct"].map((val) => (
                <label key={val} className="flex items-center gap-2 cursor-pointer text-sm font-medium text-[var(--text-secondary)] hover:text-[var(--text-primary)]">
                  <input
                    type="checkbox"
                    className="rounded border-black/20 dark:border-white/20 text-brand-600 focus:ring-brand-500 cursor-pointer h-4 w-4"
                    checked={sources.includes(val)}
                    onChange={() => handleSourceToggle(val)}
                  />
                  {val === "ota" ? "OTA" : val === "walkin" ? "Walk-in" : "Direct"}
                </label>
              ))}
            </div>
          </div>

          <div>
            <label className="block text-xs font-semibold uppercase tracking-wider text-[var(--text-muted)] mb-2">Full Tax Invoice</label>
            <label className="flex items-center gap-2 cursor-pointer text-sm font-medium text-[var(--text-secondary)] hover:text-[var(--text-primary)]">
              <input
                type="checkbox"
                className="rounded-full border-black/20 dark:border-white/20 text-brand-600 focus:ring-brand-500 cursor-pointer h-4 w-4 transition-all"
                checked={taxInvoiceOnly}
                onChange={(e) => setTaxInvoiceOnly(e.target.checked)}
              />
              เฉพาะ Full Tax Invoice ที่ออกแล้ว
            </label>
          </div>

          <div>
            <label className="block text-xs font-semibold uppercase tracking-wider text-[var(--text-muted)] mb-2">Guests</label>
            <label className="flex items-center gap-2 cursor-pointer text-sm font-medium text-[var(--text-secondary)] hover:text-[var(--text-primary)]">
              <input
                type="checkbox"
                className="rounded border-black/20 dark:border-white/20 text-brand-600 focus:ring-brand-500 cursor-pointer h-4 w-4 transition-all"
                checked={includeAccompanying}
                onChange={(e) => setIncludeAccompanying(e.target.checked)}
              />
              รวม Accompanying Guest
            </label>
          </div>
        </div>
      </div>

      {/* Error */}
      {error && (
        <div className="rounded-lg border border-rose-200 bg-rose-50 p-3 text-sm text-rose-700 dark:border-rose-800 dark:bg-rose-900/30 dark:text-rose-300">
          {error}
        </div>
      )}

      {/* Summary and Table */}
      {!error && (
        <div className="rounded-lg border border-black/10 dark:border-white/10 bg-[var(--bg-surface)] overflow-hidden shadow-sm">
          <div className="p-3 border-b border-black/10 dark:border-white/10 flex flex-wrap items-center justify-between bg-[var(--bg-muted)]">
             <h2 className="text-sm font-semibold text-[var(--text-primary)]">
               Summary: {entries.length} entries <span className="text-[var(--text-muted)] font-normal mx-2">|</span> 
               <span className="font-mono text-[var(--text-secondary)]">฿ {fmtMoney(summary.total_price)}</span>
             </h2>
          </div>
          
          <div className="overflow-x-auto">
            <table className="w-full text-xs xl:text-sm whitespace-nowrap">
              <thead>
                <tr className="border-b border-black/10 dark:border-white/10 bg-[var(--bg-surface)]">
                  <th className="p-2.5 px-3 text-center font-semibold text-[var(--text-muted)] w-10 border-r border-black/5 dark:border-white/5">#</th>
                  <th className="p-2.5 px-3 text-left font-semibold text-[var(--text-muted)] border-r border-black/5 dark:border-white/5">CI Date</th>
                  <th className="p-2.5 px-3 text-center font-semibold text-[var(--text-muted)] border-r border-black/5 dark:border-white/5">Room</th>
                  <th className="p-2.5 px-3 text-left font-semibold text-[var(--text-muted)] border-r border-black/5 dark:border-white/5">Name</th>
                  <th className="p-2.5 px-3 text-left font-semibold text-[var(--text-muted)] border-r border-black/5 dark:border-white/5">Nat</th>
                  <th className="p-2.5 px-3 text-left font-semibold text-[var(--text-muted)] border-r border-black/5 dark:border-white/5">ID / Passport</th>
                  <th className="p-2.5 px-3 text-left font-semibold text-[var(--text-muted)] border-r border-black/5 dark:border-white/5 max-w-xs truncate">Address</th>
                  <th className="p-2.5 px-3 text-left font-semibold text-[var(--text-muted)] border-r border-black/5 dark:border-white/5 max-w-xs truncate">Coming From</th>
                  <th className="p-2.5 px-3 text-left font-semibold text-[var(--text-muted)] border-r border-black/5 dark:border-white/5 max-w-xs truncate">Going To</th>
                  <th className="p-2.5 px-3 text-left font-semibold text-[var(--text-muted)] border-r border-black/5 dark:border-white/5">CO Date</th>
                  <th className="p-2.5 px-3 text-right font-semibold text-[var(--text-muted)] border-r border-black/5 dark:border-white/5">Price</th>
                  <th className="p-2.5 px-3 text-left font-semibold text-[var(--text-muted)] w-48">Remarks</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-black/5 dark:divide-white/5">
                {loading ? (
                  <tr>
                    <td colSpan={12} className="p-8 text-center text-[var(--text-muted)] animate-pulse">
                      Loading data...
                    </td>
                  </tr>
                ) : entries.length === 0 ? (
                  <tr>
                    <td colSpan={12} className="p-8 text-center text-[var(--text-muted)]">
                      No รร.3 records found for the selected filters.
                    </td>
                  </tr>
                ) : (
                  entries.map((entry, idx) => {
                    const entryValidations = validations.filter(v => v.reservation_id === entry.reservation_id && v.guest_profile_id === entry.guest_profile_id);
                    const currentAddress = entry.nationality_code === "THA" ? entry.province : entry.country;
                    
                    return (
                      <tr 
                        key={`${entry.reservation_id}-${entry.guest_profile_id}`} 
                        className="hover:bg-[var(--bg-muted)] transition-colors"
                      >
                        <td className="p-2.5 px-3 text-center text-[var(--text-muted)] border-r border-black/5 dark:border-white/5">{idx + 1}</td>
                        <td className="p-2.5 px-3 text-[var(--text-secondary)] border-r border-black/5 dark:border-white/5">{fmtDateTime(entry.checked_in_at || entry.checkin_date)}</td>
                        <td className="p-2.5 px-3 text-center font-semibold text-[var(--text-primary)] border-r border-black/5 dark:border-white/5">{entry.room_number || "-"}</td>
                        <td className="p-2.5 px-3 text-[var(--text-primary)] font-medium border-r border-black/5 dark:border-white/5">
                          {entry.first_name || ""} {entry.last_name || ""} {entry.role === "accompanying" ? <span className="text-[10px] uppercase bg-slate-100 text-slate-500 dark:bg-slate-800 dark:text-slate-400 px-1 ml-1 rounded">ACC</span> : null}
                        </td>
                        <td className="p-2.5 px-3 text-[var(--text-secondary)] border-r border-black/5 dark:border-white/5">{entry.nationality_code || "-"}</td>
                        <td className="p-2.5 px-3 font-mono text-[var(--text-secondary)] border-r border-black/5 dark:border-white/5">{entry.id_number || entry.passport_no || "-"}</td>
                        <td className="p-2.5 px-3 text-[var(--text-secondary)] border-r border-black/5 dark:border-white/5 max-w-xs truncate" title={currentAddress || undefined}>{currentAddress || "-"}</td>
                        <td className="p-2.5 px-3 text-[var(--text-secondary)] border-r border-black/5 dark:border-white/5 max-w-xs truncate" title={currentAddress || undefined}>{currentAddress || "-"}</td>
                        <td className="p-2.5 px-3 text-[var(--text-secondary)] border-r border-black/5 dark:border-white/5">ตัวอย่าง</td>
                        <td className="p-2.5 px-3 text-[var(--text-secondary)] border-r border-black/5 dark:border-white/5">{fmtDateTime(entry.checked_out_at || entry.checkout_date)}</td>
                        <td className="p-2.5 px-3 text-right font-mono text-[var(--text-secondary)] border-r border-black/5 dark:border-white/5">
                          {entry.role === "primary" ? fmtMoney(entry.total_price) : <span className="text-[var(--text-muted)]">-</span>}
                        </td>
                        <td className="p-2.5 px-3 text-[11px] text-rose-500 w-48 whitespace-normal">
                          {entryValidations.length > 0 ? (
                            <span>Missing: {entryValidations.map(v => v.field).join(", ")}</span>
                          ) : ""}
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
