"use client";

import React, { useCallback, useEffect, useState } from "react";
import type { TM30GuestRecord, TM30Validation } from "@/lib/gov-export/types";

// ============================================================
// Helpers
// ============================================================

function getBangkokToday(): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Bangkok",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date());
  
  const y = parts.find((p) => p.type === "year")?.value;
  const m = parts.find((p) => p.type === "month")?.value;
  const d = parts.find((p) => p.type === "day")?.value;
  
  if (y && m && d) return `${y}-${m}-${d}`;
  return new Date().toISOString().split("T")[0]; // Fallback
}

function fmtDate(dateStr: string | null): string {
  if (!dateStr) return "-";
  const d = new Date(dateStr + "T00:00:00");
  if (isNaN(d.getTime())) return dateStr;
  return d.toLocaleDateString("en-GB", { timeZone: "Asia/Bangkok", day: "2-digit", month: "2-digit", year: "numeric" });
}

// ============================================================
// Component
// ============================================================

export default function TM30Page() {
  const [date, setDate] = useState(() => getBangkokToday());
  const [guests, setGuests] = useState<TM30GuestRecord[]>([]);
  const [validations, setValidations] = useState<TM30Validation[]>([]);
  const [loading, setLoading] = useState(false);
  const [savingKeys, setSavingKeys] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);

  const toggleKey = (guest: TM30GuestRecord) =>
    `${guest.report_date}:${guest.reservation_id}:${guest.guest_profile_id}:${guest.entry_kind}`;

  const loadData = useCallback(async () => {
    if (!date) return;
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/reports/tm30?date=${encodeURIComponent(date)}`);
      const json = await res.json();

      if (!res.ok || !json.success) {
        throw new Error(json.error ?? "Failed to load TM.30 records");
      }

      setGuests(json.guests ?? []);
      setValidations(json.validations ?? []);
    } catch (err) {
      setGuests([]);
      setValidations([]);
      setError(err instanceof Error ? err.message : "Failed to load TM.30 data");
    } finally {
      setLoading(false);
    }
  }, [date]);

  useEffect(() => {
    void loadData();
  }, [loadData]);

  const exportableGuests = guests.filter((guest) => !guest.excluded_from_export);
  const lateDuplicateCount = guests.filter((guest) => guest.entry_kind === "late_added_duplicate").length;
  const excludedCount = guests.filter((guest) => guest.excluded_from_export).length;
  const warningCount = validations.length + lateDuplicateCount;
  const canExport = exportableGuests.length > 0;

  async function handleLateDuplicateToggle(guest: TM30GuestRecord, shouldInclude: boolean) {
    const key = toggleKey(guest);
    const nextExcluded = !shouldInclude;
    setSavingKeys((prev) => [...prev, key]);
    setGuests((prev) =>
      prev.map((entry) =>
        toggleKey(entry) === key ? { ...entry, excluded_from_export: nextExcluded } : entry
      )
    );
    setError(null);

    try {
      const res = await fetch("/api/reports/tm30", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          date: guest.report_date,
          reservation_id: guest.reservation_id,
          guest_profile_id: guest.guest_profile_id,
          entry_kind: guest.entry_kind,
          excluded: nextExcluded,
        }),
      });
      const json = await res.json().catch(() => null);
      if (!res.ok || !json?.success) {
        throw new Error(json?.error ?? "Failed to update TM.30 exclusion");
      }
    } catch (err) {
      setGuests((prev) =>
        prev.map((entry) =>
          toggleKey(entry) === key ? { ...entry, excluded_from_export: guest.excluded_from_export } : entry
        )
      );
      setError(err instanceof Error ? err.message : "Failed to update TM.30 exclusion");
    } finally {
      setSavingKeys((prev) => prev.filter((entry) => entry !== key));
    }
  }

  return (
    <div className="mx-auto max-w-[1200px] space-y-4 p-4 pb-10">
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <div className="flex items-center gap-2">
            <h1 className="text-xl font-bold text-[var(--text-primary)]">TM.30 — แจ้งที่พักคนต่างชาติ</h1>
          </div>
          <p className="text-sm text-[var(--text-muted)] mt-0.5">
            Daily foreign guest accommodation report (Immigration)
          </p>
        </div>

        <div className="flex items-center gap-2">
          {canExport ? (
            <a
              href={`/api/reports/tm30?date=${encodeURIComponent(date)}&format=xls`}
              download
              className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 transition-colors inline-flex items-center gap-2"
            >
              📥 Download .xls
            </a>
          ) : (
            <button
              disabled
              className="rounded-lg bg-gray-200 dark:bg-gray-800 text-gray-400 dark:text-gray-500 px-4 py-2 text-sm font-medium cursor-not-allowed inline-flex items-center gap-2 border border-gray-300 dark:border-gray-700"
            >
              📥 Download .xls
            </button>
          )}
        </div>
      </div>

      {/* Date Filter */}
      <div className="flex flex-wrap items-center gap-3 rounded-lg border border-black/10 dark:border-white/10 bg-[var(--bg-surface)] p-3">
        <div className="flex items-center gap-2">
          <label className="text-sm font-medium text-[var(--text-secondary)]">Date:</label>
          <input
            type="date"
            className="rounded border border-black/10 dark:border-white/10 bg-[var(--bg-primary)] px-2 py-1.5 text-sm text-[var(--text-primary)]"
            value={date}
            onChange={(e) => setDate(e.target.value)}
          />
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
        <div className="rounded-lg border border-black/10 dark:border-white/10 bg-[var(--bg-surface)] overflow-hidden">
          <div className="p-3 border-b border-black/10 dark:border-white/10 flex items-center justify-between">
             <h2 className="text-sm font-semibold text-[var(--text-primary)]">
               Summary: {guests.length} guests <span className="text-[var(--text-muted)] font-normal mx-2">|</span>
               <span className="text-[var(--text-secondary)]">{exportableGuests.length} ready to export</span>
               {excludedCount > 0 && (
                 <>
                   <span className="text-[var(--text-muted)] font-normal mx-2">|</span>
                   <span className="text-slate-500">{excludedCount} excluded</span>
                 </>
               )}
               <span className="text-[var(--text-muted)] font-normal mx-2">|</span>
               {warningCount > 0 ? (
                 <span className="text-amber-600">⚠ {warningCount} warning{warningCount > 1 ? "s" : ""}</span>
               ) : (
                 <span className="text-emerald-600">0 warnings</span>
               )}
             </h2>
          </div>
          
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-black/10 dark:border-white/10 bg-[var(--bg-muted)]">
                  <th className="p-3 text-left font-semibold text-[var(--text-muted)] whitespace-nowrap">First Name</th>
                  <th className="p-3 text-left font-semibold text-[var(--text-muted)] whitespace-nowrap">Last Name</th>
                  <th className="p-3 text-left font-semibold text-[var(--text-muted)] whitespace-nowrap">Passport</th>
                  <th className="p-3 text-left font-semibold text-[var(--text-muted)] whitespace-nowrap">Nationality</th>
                  <th className="p-3 text-left font-semibold text-[var(--text-muted)] whitespace-nowrap">Gender</th>
                  <th className="p-3 text-center font-semibold text-[var(--text-muted)] whitespace-nowrap">Check-in</th>
                  <th className="p-3 text-center font-semibold text-[var(--text-muted)] whitespace-nowrap">Room</th>
                  <th className="p-3 text-left font-semibold text-[var(--text-muted)] w-1/4">Warning</th>
                </tr>
              </thead>
              <tbody>
                {loading ? (
                  <tr>
                    <td colSpan={8} className="p-8 text-center text-[var(--text-muted)] animate-pulse">
                      Loading data...
                    </td>
                  </tr>
                ) : guests.length === 0 ? (
                  <tr>
                    <td colSpan={8} className="p-8 text-center text-[var(--text-muted)]">
                      No TM.30 records found for {date}
                    </td>
                  </tr>
                ) : (
                  guests.map((guest, idx) => {
                    const guestValidations = validations.filter(v => v.guest_profile_id === guest.guest_profile_id);
                    const hasWarning = guestValidations.length > 0;
                    const isLateDuplicate = guest.entry_kind === "late_added_duplicate";
                    const isSaving = savingKeys.includes(toggleKey(guest));
                    
                    return (
                      <tr 
                        key={`${guest.reservation_id}-${guest.guest_profile_id}-${idx}`}
                        className={`border-b border-black/5 dark:border-white/5 hover:bg-[var(--bg-muted)] transition-colors ${(hasWarning || isLateDuplicate) ? "bg-amber-50 dark:bg-amber-900/10" : ""} ${guest.excluded_from_export ? "opacity-70" : ""}`}
                      >
                        <td className="p-3">
                          {(hasWarning || isLateDuplicate) && <span className="text-amber-500 mr-2" title="Warning">⚠</span>}
                          <span className="font-medium text-[var(--text-primary)]">{guest.first_name || "-"}</span>
                        </td>
                        <td className="p-3 text-[var(--text-primary)]">{guest.last_name || "-"}</td>
                        <td className="p-3 font-mono text-[var(--text-secondary)]">{guest.passport_no || "-"}</td>
                        <td className="p-3 font-medium text-[var(--text-secondary)]">{guest.nationality_code || "-"}</td>
                        <td className="p-3 text-[var(--text-secondary)]">{guest.gender || "-"}</td>
                        <td className="p-3 text-center text-[var(--text-secondary)]">{fmtDate(guest.checkin_date)}</td>
                        <td className="p-3 text-center font-semibold text-[var(--text-secondary)]">{guest.room_number || "-"}</td>
                        <td className="p-3">
                          {hasWarning || isLateDuplicate ? (
                            <div className="space-y-2">
                              <div className="flex flex-wrap gap-1">
                                {isLateDuplicate ? (
                                  <>
                                    <span className="px-1.5 py-0.5 rounded bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-300 text-[10px] font-semibold tracking-wide uppercase">
                                      late-added
                                    </span>
                                    {guest.excluded_from_export ? (
                                      <span className="px-1.5 py-0.5 rounded bg-slate-200 text-slate-700 dark:bg-slate-800 dark:text-slate-300 text-[10px] font-semibold tracking-wide uppercase">
                                        excluded
                                      </span>
                                    ) : null}
                                  </>
                                ) : null}
                                {guestValidations.map((v, i) => (
                                  <span key={i} className="px-1.5 py-0.5 rounded bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-300 text-[10px] font-semibold tracking-wide uppercase">
                                    {v.field}
                                  </span>
                                ))}
                              </div>
                              {isLateDuplicate ? (
                                <div className="space-y-1">
                                  <p className="text-xs text-amber-700 dark:text-amber-300">
                                    Added to this checked-in reservation on a later day. Keep checked only if this guest still needs to be sent again for {fmtDate(date)}.
                                  </p>
                                  <label className="inline-flex items-center gap-2 text-xs text-[var(--text-secondary)]">
                                    <input
                                      type="checkbox"
                                      className="h-4 w-4 rounded border-black/10 dark:border-white/10"
                                      checked={!guest.excluded_from_export}
                                      disabled={isSaving}
                                      onChange={(e) => void handleLateDuplicateToggle(guest, e.target.checked)}
                                    />
                                    Include in export
                                  </label>
                                </div>
                              ) : null}
                            </div>
                          ) : (
                            <span className="text-[var(--text-muted)] text-xs">-</span>
                          )}
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
