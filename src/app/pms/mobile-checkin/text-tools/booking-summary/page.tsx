"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { ArrowLeft, Copy, RefreshCw, Search } from "lucide-react";

type Candidate = {
  reservation_id: string;
  booking_code: string;
  guest_name: string;
  room_number: string | null;
  checkin_date: string;
  checkout_date: string;
  total_price: number;
  booking_group_id: string | null;
  group_code: string | null;
  group_name: string | null;
  group_member_count: number;
};

export default function MobileBookingSummaryPage() {
  const today = new Date().toISOString().slice(0, 10);
  const [checkin, setCheckin] = useState(today);
  const [query, setQuery] = useState("");
  const [items, setItems] = useState<Candidate[]>([]);
  const [selectedId, setSelectedId] = useState("");
  const [text, setText] = useState("");
  const [loadingList, setLoadingList] = useState(false);
  const [loadingText, setLoadingText] = useState(false);
  const [error, setError] = useState("");
  const [copySuccess, setCopySuccess] = useState(false);

  const fetchCandidates = async () => {
    setLoadingList(true);
    setError("");
    try {
      const qs = new URLSearchParams({ checkin });
      if (query.trim()) qs.set("q", query.trim());
      const res = await fetch(`/api/mobile-text/booking-candidates?${qs.toString()}`, { cache: "no-store" });
      const json = await res.json().catch(() => null);
      if (!res.ok || !json?.success) throw new Error(json?.error || "Failed to load due-in guests.");
      const nextItems = Array.isArray(json.data?.items) ? (json.data.items as Candidate[]) : [];
      setItems(nextItems);
      setSelectedId((current) => (nextItems.some((item) => item.reservation_id === current) ? current : nextItems[0]?.reservation_id ?? ""));
      setText("");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load due-in guests.");
      setItems([]);
      setSelectedId("");
      setText("");
    } finally {
      setLoadingList(false);
    }
  };

  useEffect(() => {
    void fetchCandidates();
  }, [checkin]);

  const selected = useMemo(
    () => items.find((item) => item.reservation_id === selectedId) ?? null,
    [items, selectedId]
  );

  const generateSummary = async () => {
    if (!selectedId) return;
    setLoadingText(true);
    setError("");
    setCopySuccess(false);
    try {
      const res = await fetch("/api/mobile-text/booking-summary", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ reservation_id: selectedId }),
      });
      const json = await res.json().catch(() => null);
      if (!res.ok || !json?.success) throw new Error(json?.error || "Failed to generate summary.");
      setText(String(json.data?.text ?? ""));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to generate summary.");
      setText("");
    } finally {
      setLoadingText(false);
    }
  };

  const handleCopy = async () => {
    if (!text) return;
    await navigator.clipboard.writeText(text);
    setCopySuccess(true);
    window.setTimeout(() => setCopySuccess(false), 2000);
  };

  return (
    <div className="flex flex-col min-h-screen">
      <header className="px-6 py-4 border-b border-[var(--border-default)] bg-[var(--bg-surface)] flex items-center gap-4">
        <Link
          href="/pms/mobile-checkin/text-tools"
          className="p-3 -ml-3 rounded-full hover:bg-[var(--bg-surface-hover)] text-[var(--text-secondary)] transition"
        >
          <ArrowLeft className="w-6 h-6" />
        </Link>
        <div>
          <h1 className="text-xl font-bold tracking-tight">Booking Summary</h1>
          <p className="text-sm text-[var(--text-secondary)]">UI in English, copied message in Thai.</p>
        </div>
      </header>

      <main className="flex-1 p-6 space-y-4">
        <div className="space-y-3 rounded-2xl border border-[var(--border-default)] bg-[var(--bg-surface)] p-4">
          <div>
            <label className="block text-[11px] font-bold uppercase tracking-widest text-[var(--text-muted)] mb-2">
              Check-in Date
            </label>
            <input
              type="date"
              value={checkin}
              onChange={(event) => setCheckin(event.target.value)}
              className="form-input w-full"
            />
          </div>

          <div>
            <label className="block text-[11px] font-bold uppercase tracking-widest text-[var(--text-muted)] mb-2">
              Search Guest / Booking
            </label>
            <div className="flex gap-2">
              <div className="relative flex-1">
                <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-[var(--text-muted)]" />
                <input
                  type="text"
                  value={query}
                  onChange={(event) => setQuery(event.target.value)}
                  placeholder="Guest name, booking code, room"
                  className="form-input w-full pl-9"
                />
              </div>
              <button type="button" className="btn btn-secondary whitespace-nowrap" onClick={fetchCandidates} disabled={loadingList}>
                {loadingList ? <span className="btn-spinner" /> : "Search"}
              </button>
            </div>
          </div>
        </div>

        <div className="rounded-2xl border border-[var(--border-default)] bg-[var(--bg-surface)] overflow-hidden">
          <div className="px-4 py-3 border-b border-[var(--border-default)] flex items-center justify-between">
            <div>
              <h2 className="font-bold text-[var(--text-primary)]">Due-in Guests</h2>
              <p className="text-xs text-[var(--text-secondary)]">{items.length} result{items.length === 1 ? "" : "s"}</p>
            </div>
            <button type="button" onClick={fetchCandidates} disabled={loadingList} className="p-2 rounded-lg hover:bg-[var(--bg-surface-hover)] text-[var(--text-secondary)]">
              <RefreshCw className={`w-4 h-4 ${loadingList ? "animate-spin" : ""}`} />
            </button>
          </div>

          {items.length === 0 ? (
            <div className="p-4 text-sm text-[var(--text-muted)]">No due-in guest found for this date.</div>
          ) : (
            <div className="divide-y divide-[var(--border-default)]">
              {items.map((item) => {
                const isSelected = item.reservation_id === selectedId;
                return (
                  <label
                    key={item.reservation_id}
                    className={`block p-4 cursor-pointer transition ${isSelected ? "bg-brand-50 dark:bg-brand-500/10" : "hover:bg-[var(--bg-surface-hover)]"}`}
                  >
                    <div className="flex items-start gap-3">
                      <input
                        type="radio"
                        name="reservation_id"
                        checked={isSelected}
                        onChange={() => setSelectedId(item.reservation_id)}
                        className="mt-1"
                      />
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <p className="font-semibold text-[var(--text-primary)] truncate">{item.guest_name}</p>
                          <span className="text-xs font-semibold text-[var(--text-muted)]">{item.booking_code}</span>
                          {item.room_number && <span className="text-xs font-semibold text-[var(--text-muted)]">Room {item.room_number}</span>}
                        </div>
                        {(item.group_name || item.group_member_count > 1) && (
                          <p className="text-xs text-brand-600 mt-1">
                            Group summary will include all linked rooms
                            {item.group_name ? ` · ${item.group_name}` : ""}
                            {item.group_member_count > 1 ? ` · ${item.group_member_count} rooms` : ""}
                          </p>
                        )}
                      </div>
                    </div>
                  </label>
                );
              })}
            </div>
          )}
        </div>

        <div className="flex justify-end">
          <button type="button" className="btn btn-primary px-6" onClick={generateSummary} disabled={!selected || loadingText}>
            {loadingText ? <span className="btn-spinner border-white" /> : "Generate"}
          </button>
        </div>

        {error && (
          <div className="p-3 bg-rose-50 border border-rose-100 rounded-lg text-sm text-rose-700">{error}</div>
        )}

        {text && (
          <div className="rounded-2xl border border-emerald-300 bg-[var(--bg-surface)] p-4 space-y-3">
            <textarea value={text} readOnly className="w-full min-h-[280px] rounded-xl border border-[var(--border-default)] bg-[var(--bg-body)] p-3 text-sm" />
            <div className="flex items-center justify-between gap-3">
              <p className={`text-sm ${copySuccess ? "text-emerald-600" : "text-[var(--text-secondary)]"}`}>
                {copySuccess ? "Copied." : "Thai message format is kept the same as the old GAS version."}
              </p>
              <button type="button" className="btn btn-secondary inline-flex items-center gap-2" onClick={handleCopy}>
                <Copy className="w-4 h-4" />
                Copy Text
              </button>
            </div>
          </div>
        )}
      </main>
    </div>
  );
}
