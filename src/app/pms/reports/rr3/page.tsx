"use client";

import React, { useCallback, useEffect, useMemo, useState } from "react";
import { FileText, Save, X } from "lucide-react";
import { normalizeThaiGovBuddhistDateText } from "@/lib/gov-export/constants";
import type {
  RR3GuestRecord,
  RR3PriceSummary,
  RR3PriceSummaryGroup,
  RR3RowOverrideFields,
  RR3Validation,
} from "@/lib/gov-export/types";

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

function fmtDateOnly(isoString: string | null): string {
  if (!isoString) return "";
  return normalizeThaiGovBuddhistDateText(isoString) || isoString;
}

function stripRR3Time(value: string): string {
  return normalizeThaiGovBuddhistDateText(value);
}

function fmtMoney(num: number): string {
  return num.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function fmtSummaryNumber(num: number): string {
  return num.toLocaleString("en-US", {
    minimumFractionDigits: Number.isInteger(num) ? 0 : 2,
    maximumFractionDigits: 2,
  });
}

function emptyPriceSummaryGroup(label: string): RR3PriceSummaryGroup {
  return {
    label,
    rows: [],
    total_quantity: 0,
    total_amount: 0,
    copy_text: `${label}\nยอดรวม = 0`,
  };
}

function emptyPriceSummary(): RR3PriceSummary {
  return {
    ota_tax: emptyPriceSummaryGroup("รร.3 OTA + Tax invoice"),
    walkin_direct: emptyPriceSummaryGroup("รร.3 Walk-in + Direct"),
  };
}

type OverrideForm = RR3RowOverrideFields;

function blankOverrideForm(): OverrideForm {
  return {
    checkin_datetime: "",
    room_number: "",
    full_name: "",
    nationality: "",
    id_or_passport: "",
    current_address: "",
    occupation: "รับจ้าง",
    coming_from: "",
    going_to: "ตัวอย่าง",
    checkout_datetime: "",
    remarks: "",
  };
}

function baseRowForm(entry: RR3GuestRecord): OverrideForm {
  const currentAddress = entry.nationality_code === "THA" ? entry.province : entry.country;
  return {
    checkin_datetime: fmtDateOnly(entry.checked_in_at || entry.checkin_date),
    room_number: entry.room_number || "",
    full_name: [entry.first_name, entry.last_name].filter(Boolean).join(" "),
    nationality: entry.nationality_code || "",
    id_or_passport: entry.id_number || entry.passport_no || "",
    current_address: currentAddress || "",
    occupation: "รับจ้าง",
    coming_from: currentAddress || "",
    going_to: "ตัวอย่าง",
    checkout_datetime: fmtDateOnly(entry.checked_out_at || entry.checkout_date),
    remarks: "",
  };
}

function entryToOverrideForm(entry: RR3GuestRecord): OverrideForm {
  const base = baseRowForm(entry);
  const override = entry.rr3_override;
  if (!override) return base;
  return {
    checkin_datetime: stripRR3Time(override.checkin_datetime || base.checkin_datetime),
    room_number: override.room_number || base.room_number,
    full_name: override.full_name || base.full_name,
    nationality: override.nationality || base.nationality,
    id_or_passport: override.id_or_passport || base.id_or_passport,
    current_address: override.current_address || base.current_address,
    occupation: override.occupation || base.occupation,
    coming_from: override.coming_from || base.coming_from,
    going_to: override.going_to || base.going_to,
    checkout_datetime: stripRR3Time(override.checkout_datetime || base.checkout_datetime),
    remarks: override.remarks || base.remarks,
  };
}

function PriceSummaryPanel({
  group,
  copied,
  onCopy,
}: {
  group: RR3PriceSummaryGroup;
  copied: boolean;
  onCopy: () => void;
}) {
  return (
    <section className="min-w-0 rounded-lg border border-black/10 bg-[var(--bg-primary)] p-4 dark:border-white/10">
      <div className="mb-3 flex items-start justify-between gap-3">
        <div>
          <h3 className="text-sm font-bold text-[var(--text-primary)]">{group.label}</h3>
          <p className="mt-0.5 text-xs text-[var(--text-muted)]">
            {group.total_quantity.toLocaleString("en-US")} คืน · ฿ {fmtMoney(group.total_amount)}
          </p>
        </div>
        <button
          type="button"
          onClick={onCopy}
          className="shrink-0 rounded-md border border-black/10 px-3 py-1.5 text-xs font-semibold text-[var(--text-secondary)] transition hover:bg-[var(--bg-muted)] hover:text-[var(--text-primary)] dark:border-white/10"
        >
          {copied ? "Copied" : "Copy"}
        </button>
      </div>

      <div className="overflow-hidden rounded-md border border-black/5 dark:border-white/10">
        <table className="w-full text-sm">
          <thead className="bg-[var(--bg-muted)] text-xs uppercase tracking-wide text-[var(--text-muted)]">
            <tr>
              <th className="px-3 py-2 text-left">Rate</th>
              <th className="px-3 py-2 text-right">Nights</th>
              <th className="px-3 py-2 text-right">Total</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-black/5 dark:divide-white/10">
            {group.rows.length === 0 ? (
              <tr>
                <td colSpan={3} className="px-3 py-5 text-center text-xs text-[var(--text-muted)]">
                  No document totals yet.
                </td>
              </tr>
            ) : (
              group.rows.map((row) => (
                <tr key={`${group.label}-${row.unit_price}`} className="text-[var(--text-secondary)]">
                  <td className="px-3 py-2 font-mono">{fmtSummaryNumber(row.unit_price)}</td>
                  <td className="px-3 py-2 text-right font-mono">{row.quantity.toLocaleString("en-US")}</td>
                  <td className="px-3 py-2 text-right font-mono text-[var(--text-primary)]">
                    {fmtSummaryNumber(row.total)}
                  </td>
                </tr>
              ))
            )}
          </tbody>
          <tfoot className="border-t border-black/10 bg-[var(--bg-muted)] font-bold text-[var(--text-primary)] dark:border-white/10">
            <tr>
              <td className="px-3 py-2">Total</td>
              <td className="px-3 py-2 text-right font-mono">{group.total_quantity.toLocaleString("en-US")}</td>
              <td className="px-3 py-2 text-right font-mono">{fmtSummaryNumber(group.total_amount)}</td>
            </tr>
          </tfoot>
        </table>
      </div>
    </section>
  );
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
  const [priceSummary, setPriceSummary] = useState<RR3PriceSummary>(emptyPriceSummary());
  const [copiedSummary, setCopiedSummary] = useState<keyof RR3PriceSummary | null>(null);
  const [overrideCanEdit, setOverrideCanEdit] = useState(false);
  const [overrideReason, setOverrideReason] = useState<string | null>(null);
  const [overrideSaving, setOverrideSaving] = useState(false);
  const [editingEntry, setEditingEntry] = useState<RR3GuestRecord | null>(null);
  const [overrideForm, setOverrideForm] = useState<OverrideForm>(blankOverrideForm());
  
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
      setPriceSummary(json.price_summary ?? emptyPriceSummary());
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
      setPriceSummary(emptyPriceSummary());
      setError(err instanceof Error ? err.message : "Failed to load รร.3 data");
    } finally {
      setLoading(false);
    }
  }, [selectedYear, selectedMonth, sources, taxInvoiceOnly, includeAccompanying]);

  useEffect(() => {
    void loadData();
  }, [loadData]);

  const loadOverrideState = useCallback(async () => {
    try {
      const params = new URLSearchParams();
      params.set("year", String(selectedYear));
      params.set("month", String(selectedMonth));
      const res = await fetch(`/api/reports/rr3/row-overrides?${params.toString()}`, { cache: "no-store" });
      const json = await res.json();
      if (!json.success) throw new Error(json.error ?? "Failed to load RR3 edit state");
      setOverrideCanEdit(Boolean(json.can_edit));
      setOverrideReason(json.edit_reason ?? null);
    } catch (err) {
      setOverrideCanEdit(false);
      setOverrideReason(err instanceof Error ? err.message : "Failed to load RR3 edit state");
    }
  }, [selectedYear, selectedMonth]);

  useEffect(() => {
    void loadOverrideState();
    setEditingEntry(null);
    setOverrideForm(blankOverrideForm());
  }, [loadOverrideState]);

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

  const getPrintHref = () => {
    const params = new URLSearchParams();
    if (sources.length > 0) params.set("sources", sources.join(","));
    params.set("tax_invoice", String(taxInvoiceOnly));
    params.set("include_accompanying", String(includeAccompanying));
    return `/pms/reports/rr3/print/${selectedYear}/${selectedMonth}?${params.toString()}`;
  };

  const canExport = entries.length > 0;

  const copySummary = async (key: keyof RR3PriceSummary) => {
    const text = priceSummary[key]?.copy_text ?? "";
    if (!text) return;
    await navigator.clipboard.writeText(text);
    setCopiedSummary(key);
    window.setTimeout(() => setCopiedSummary(null), 1500);
  };

  const submitOverride = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!editingEntry || !overrideCanEdit) return;
    setOverrideSaving(true);
    try {
      const params = new URLSearchParams();
      params.set("year", String(selectedYear));
      params.set("month", String(selectedMonth));
      const payload = {
        reservation_id: editingEntry.reservation_id,
        guest_profile_id: editingEntry.guest_profile_id,
        ...overrideForm,
        checkin_datetime: stripRR3Time(overrideForm.checkin_datetime),
        checkout_datetime: stripRR3Time(overrideForm.checkout_datetime),
      };
      const res = await fetch(`/api/reports/rr3/row-overrides?${params.toString()}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const json = await res.json();
      if (!json.success) throw new Error(json.error ?? "Failed to save RR3 row");
      setEditingEntry(null);
      setOverrideForm(blankOverrideForm());
      await loadData();
    } catch (err) {
      alert(err instanceof Error ? err.message : "Failed to save RR3 row");
    } finally {
      setOverrideSaving(false);
    }
  };

  const clearOverride = async () => {
    if (!editingEntry || !overrideCanEdit || !confirm("Clear saved RR3 correction for this row?")) return;
    setOverrideSaving(true);
    try {
      const params = new URLSearchParams();
      params.set("year", String(selectedYear));
      params.set("month", String(selectedMonth));
      const res = await fetch(`/api/reports/rr3/row-overrides?${params.toString()}`, {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          reservation_id: editingEntry.reservation_id,
          guest_profile_id: editingEntry.guest_profile_id,
        }),
      });
      const json = await res.json();
      if (!json.success) throw new Error(json.error ?? "Failed to clear RR3 row correction");
      setEditingEntry(null);
      setOverrideForm(blankOverrideForm());
      await loadData();
    } catch (err) {
      alert(err instanceof Error ? err.message : "Failed to clear RR3 row correction");
    } finally {
      setOverrideSaving(false);
    }
  };

  const updateOverrideField = (field: keyof OverrideForm, value: string) => {
    setOverrideForm((prev) => ({ ...prev, [field]: value }));
  };

  const openOverrideModal = (entry: RR3GuestRecord) => {
    setEditingEntry(entry);
    setOverrideForm(entryToOverrideForm(entry));
  };

  return (
    <div className="mx-auto max-w-[1400px] space-y-4 p-4 pb-10">
      {editingEntry && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm">
          <form
            onSubmit={submitOverride}
            className="w-full max-w-4xl rounded-2xl border border-[var(--border-default)] bg-[var(--bg-surface)] p-5 shadow-2xl"
          >
            <div className="mb-4 flex items-start justify-between gap-4 border-b border-black/10 pb-4 dark:border-white/10">
              <div>
                <h2 className="text-lg font-bold text-[var(--text-primary)]">Correct RR3 Row</h2>
                <p className="mt-1 text-xs text-[var(--text-muted)]">
                  แก้เฉพาะข้อมูลในเอกสาร รร.3 ไม่กระทบ Booking, Guest Profile หรือ Monthly Audit
                </p>
              </div>
              <button
                type="button"
                onClick={() => setEditingEntry(null)}
                className="rounded-lg p-2 text-[var(--text-muted)] transition hover:bg-[var(--bg-muted)] hover:text-[var(--text-primary)]"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            {!overrideCanEdit && (
              <div className="mb-4 rounded-md border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs font-medium text-amber-700 dark:text-amber-300">
                {overrideReason || "RR3 row correction is locked for this month."}
              </div>
            )}

            <div className="grid gap-3 md:grid-cols-12">
              <input className="rounded-md border border-black/10 bg-[var(--bg-primary)] px-3 py-2 text-sm text-[var(--text-primary)] dark:border-white/10 md:col-span-3" placeholder="วันเวลาที่มาเข้าพัก" value={overrideForm.checkin_datetime} disabled={!overrideCanEdit} onChange={(e) => updateOverrideField("checkin_datetime", e.target.value)} />
              <input className="rounded-md border border-black/10 bg-[var(--bg-primary)] px-3 py-2 text-sm text-[var(--text-primary)] dark:border-white/10 md:col-span-2" placeholder="ห้องพักเลขที่" value={overrideForm.room_number} disabled={!overrideCanEdit} onChange={(e) => updateOverrideField("room_number", e.target.value)} />
              <input className="rounded-md border border-black/10 bg-[var(--bg-primary)] px-3 py-2 text-sm text-[var(--text-primary)] dark:border-white/10 md:col-span-4" placeholder="ชื่อตัวและชื่อสกุล" value={overrideForm.full_name} disabled={!overrideCanEdit} onChange={(e) => updateOverrideField("full_name", e.target.value)} required />
              <input className="rounded-md border border-black/10 bg-[var(--bg-primary)] px-3 py-2 text-sm text-[var(--text-primary)] dark:border-white/10 md:col-span-3" placeholder="สัญชาติ" value={overrideForm.nationality} disabled={!overrideCanEdit} onChange={(e) => updateOverrideField("nationality", e.target.value)} />
              <input className="rounded-md border border-black/10 bg-[var(--bg-primary)] px-3 py-2 text-sm text-[var(--text-primary)] dark:border-white/10 md:col-span-4" placeholder="เลขบัตร / Passport" value={overrideForm.id_or_passport} disabled={!overrideCanEdit} onChange={(e) => updateOverrideField("id_or_passport", e.target.value)} />
              <input className="rounded-md border border-black/10 bg-[var(--bg-primary)] px-3 py-2 text-sm text-[var(--text-primary)] dark:border-white/10 md:col-span-5" placeholder="ที่อยู่ปัจจุบัน" value={overrideForm.current_address} disabled={!overrideCanEdit} onChange={(e) => updateOverrideField("current_address", e.target.value)} />
              <input className="rounded-md border border-black/10 bg-[var(--bg-primary)] px-3 py-2 text-sm text-[var(--text-primary)] dark:border-white/10 md:col-span-3" placeholder="อาชีพ" value={overrideForm.occupation} disabled={!overrideCanEdit} onChange={(e) => updateOverrideField("occupation", e.target.value)} />
              <input className="rounded-md border border-black/10 bg-[var(--bg-primary)] px-3 py-2 text-sm text-[var(--text-primary)] dark:border-white/10 md:col-span-4" placeholder="มาจาก" value={overrideForm.coming_from} disabled={!overrideCanEdit} onChange={(e) => updateOverrideField("coming_from", e.target.value)} />
              <input className="rounded-md border border-black/10 bg-[var(--bg-primary)] px-3 py-2 text-sm text-[var(--text-primary)] dark:border-white/10 md:col-span-4" placeholder="จะไปที่" value={overrideForm.going_to} disabled={!overrideCanEdit} onChange={(e) => updateOverrideField("going_to", e.target.value)} />
              <input className="rounded-md border border-black/10 bg-[var(--bg-primary)] px-3 py-2 text-sm text-[var(--text-primary)] dark:border-white/10 md:col-span-2" placeholder="วันเวลาที่ออกไป" value={overrideForm.checkout_datetime} disabled={!overrideCanEdit} onChange={(e) => updateOverrideField("checkout_datetime", e.target.value)} />
              <input className="rounded-md border border-black/10 bg-[var(--bg-primary)] px-3 py-2 text-sm text-[var(--text-primary)] dark:border-white/10 md:col-span-6" placeholder="หมายเหตุ" value={overrideForm.remarks} disabled={!overrideCanEdit} onChange={(e) => updateOverrideField("remarks", e.target.value)} />
            </div>

            <div className="mt-5 flex flex-wrap justify-end gap-2 border-t border-black/10 pt-4 dark:border-white/10">
              {editingEntry.rr3_override && (
                <button
                  type="button"
                  onClick={() => void clearOverride()}
                  disabled={!overrideCanEdit || overrideSaving}
                  className="rounded-lg border border-rose-500/30 px-4 py-2 text-sm font-semibold text-rose-600 transition hover:bg-rose-500/10 disabled:opacity-50"
                >
                  Clear Correction
                </button>
              )}
              <button type="button" onClick={() => setEditingEntry(null)} className="rounded-lg border border-black/10 px-4 py-2 text-sm font-semibold text-[var(--text-secondary)] transition hover:bg-[var(--bg-muted)] dark:border-white/10">
                Cancel
              </button>
              <button
                type="submit"
                disabled={!overrideCanEdit || overrideSaving}
                className="inline-flex items-center gap-2 rounded-lg bg-brand-600 px-4 py-2 text-sm font-bold text-white transition hover:bg-brand-700 disabled:cursor-not-allowed disabled:opacity-50"
              >
                <Save className="h-4 w-4" />
                Save Row
              </button>
            </div>
          </form>
        </div>
      )}

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

        <div className="flex flex-wrap items-center gap-2">
          <a
            href={getPrintHref()}
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center gap-2 rounded-lg border border-blue-500/30 bg-blue-600 px-4 py-2 text-sm font-semibold text-white shadow-sm transition hover:bg-blue-700"
          >
            <FileText className="h-4 w-4" />
            Print Current Filter
          </a>
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

      {!error && (
        <div className="rounded-lg border border-black/10 bg-[var(--bg-surface)] p-4 shadow-sm dark:border-white/10">
          <div className="mb-4 flex flex-wrap items-end justify-between gap-3 border-b border-black/5 pb-3 dark:border-white/10">
            <div>
              <h2 className="text-sm font-bold text-[var(--text-primary)]">RR3 Document Price Summary</h2>
              <p className="mt-0.5 text-xs text-[var(--text-muted)]">
                สรุปจากใบกำกับภาษีอย่างย่อที่ออกแล้ว และ Full Tax Invoice ที่ออกแล้ว เรียงราคาต่อคืนจากต่ำไปสูง
              </p>
            </div>
            <div className="text-right text-xs text-[var(--text-muted)]">
              Document total · ฿ {fmtMoney(priceSummary.ota_tax.total_amount + priceSummary.walkin_direct.total_amount)}
            </div>
          </div>

          <div className="grid gap-4 lg:grid-cols-2">
            <PriceSummaryPanel
              group={priceSummary.ota_tax}
              copied={copiedSummary === "ota_tax"}
              onCopy={() => void copySummary("ota_tax")}
            />
            <PriceSummaryPanel
              group={priceSummary.walkin_direct}
              copied={copiedSummary === "walkin_direct"}
              onCopy={() => void copySummary("walkin_direct")}
            />
          </div>
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
                  <th className="p-2.5 px-3 text-left font-semibold text-[var(--text-muted)] border-r border-black/5 dark:border-white/5 w-48">Remarks</th>
                  <th className="p-2.5 px-3 text-right font-semibold text-[var(--text-muted)] w-24">Action</th>
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
                    const override = entry.rr3_override ?? null;
                    const currentAddress = override?.current_address || (entry.nationality_code === "THA" ? entry.province : entry.country);
                    const displayName = override?.full_name || [entry.first_name, entry.last_name].filter(Boolean).join(" ");
                    const displayRoom = override?.room_number || entry.room_number || "-";
                    const displayNationality = override?.nationality || entry.nationality_code || "-";
                    const displayId = override?.id_or_passport || entry.id_number || entry.passport_no || "-";
                    const displayCheckin = stripRR3Time(override?.checkin_datetime || fmtDateOnly(entry.checked_in_at || entry.checkin_date)) || "-";
                    const displayCheckout = stripRR3Time(override?.checkout_datetime || fmtDateOnly(entry.checked_out_at || entry.checkout_date)) || "-";
                    const displayComingFrom = override?.coming_from || currentAddress || "-";
                    const displayGoingTo = override?.going_to || "ตัวอย่าง";
                    const displayRemarks = override?.remarks || "";
                    
                    return (
                      <tr 
                        key={`${entry.reservation_id}-${entry.guest_profile_id}`} 
                        className="hover:bg-[var(--bg-muted)] transition-colors"
                      >
                        <td className="p-2.5 px-3 text-center text-[var(--text-muted)] border-r border-black/5 dark:border-white/5">{idx + 1}</td>
                        <td className="p-2.5 px-3 text-[var(--text-secondary)] border-r border-black/5 dark:border-white/5">{displayCheckin}</td>
                        <td className="p-2.5 px-3 text-center font-semibold text-[var(--text-primary)] border-r border-black/5 dark:border-white/5">{displayRoom}</td>
                        <td className="p-2.5 px-3 text-[var(--text-primary)] font-medium border-r border-black/5 dark:border-white/5">
                          {displayName || "-"} {entry.role === "accompanying" ? <span className="text-[10px] uppercase bg-slate-100 text-slate-500 dark:bg-slate-800 dark:text-slate-400 px-1 ml-1 rounded">ACC</span> : null}
                          {override ? <span className="ml-1 rounded bg-amber-500/15 px-1 text-[10px] font-bold text-amber-700 dark:text-amber-300">EDITED</span> : null}
                        </td>
                        <td className="p-2.5 px-3 text-[var(--text-secondary)] border-r border-black/5 dark:border-white/5">{displayNationality}</td>
                        <td className="p-2.5 px-3 font-mono text-[var(--text-secondary)] border-r border-black/5 dark:border-white/5">{displayId}</td>
                        <td className="p-2.5 px-3 text-[var(--text-secondary)] border-r border-black/5 dark:border-white/5 max-w-xs truncate" title={currentAddress || undefined}>{currentAddress || "-"}</td>
                        <td className="p-2.5 px-3 text-[var(--text-secondary)] border-r border-black/5 dark:border-white/5 max-w-xs truncate" title={displayComingFrom}>{displayComingFrom}</td>
                        <td className="p-2.5 px-3 text-[var(--text-secondary)] border-r border-black/5 dark:border-white/5">{displayGoingTo}</td>
                        <td className="p-2.5 px-3 text-[var(--text-secondary)] border-r border-black/5 dark:border-white/5">{displayCheckout}</td>
                        <td className="p-2.5 px-3 text-[11px] text-rose-500 w-48 whitespace-normal border-r border-black/5 dark:border-white/5">
                          {entryValidations.length > 0 ? (
                            <span>Missing: {entryValidations.map(v => v.field).join(", ")}</span>
                          ) : displayRemarks}
                        </td>
                        <td className="p-2.5 px-3 text-right">
                          <button
                            type="button"
                            onClick={() => openOverrideModal(entry)}
                            className="rounded-md border border-black/10 px-2 py-1 text-xs font-semibold text-[var(--text-secondary)] transition hover:bg-[var(--bg-muted)] dark:border-white/10"
                          >
                            Edit
                          </button>
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
