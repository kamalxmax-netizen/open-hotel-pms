"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { ArrowLeft, Copy } from "lucide-react";
import NightCounter from "@/components/night-counter";

export default function MobileRoomAvailabilityTextPage() {
  const today = new Date().toISOString().slice(0, 10);
  const tomorrow = new Date(Date.now() + 86400000).toISOString().slice(0, 10);
  const [checkin, setCheckin] = useState(today);
  const [checkout, setCheckout] = useState(tomorrow);
  const [nights, setNights] = useState(1);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [text, setText] = useState("");
  const [copySuccess, setCopySuccess] = useState(false);

  const canGenerate = useMemo(() => Boolean(checkin && checkout && checkout > checkin), [checkin, checkout]);

  const generateText = async () => {
    if (!canGenerate) return;
    setLoading(true);
    setError("");
    setCopySuccess(false);
    try {
      const qs = new URLSearchParams({ checkin, checkout });
      const res = await fetch(`/api/mobile-text/availability?${qs.toString()}`, { cache: "no-store" });
      const json = await res.json().catch(() => null);
      if (!res.ok || !json?.success) throw new Error(json?.error || "Failed to load room availability text.");
      setText(String(json.data?.text ?? ""));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load room availability text.");
      setText("");
    } finally {
      setLoading(false);
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
          <h1 className="text-xl font-bold tracking-tight">Room Availability</h1>
          <p className="text-sm text-[var(--text-secondary)]">Use the same C/I - NightX+ - C/O pattern, then copy Thai text.</p>
        </div>
      </header>

      <main className="flex-1 p-6 space-y-4">
        <div className="rounded-2xl border border-[var(--border-default)] bg-[var(--bg-surface)] p-4 space-y-3">
          <label className="block text-[11px] font-bold uppercase tracking-widest text-[var(--text-muted)]">
            Stay Range
          </label>
          <NightCounter
            checkinDate={checkin}
            checkoutDate={checkout}
            nights={nights}
            useNativeDatePicker
            compact
            onChange={(nextCheckin, nextCheckout, nextNights) => {
              setCheckin(nextCheckin);
              setCheckout(nextCheckout);
              setNights(nextNights);
              setText("");
              setCopySuccess(false);
            }}
          />
          <div className="flex justify-end">
            <button type="button" className="btn btn-primary px-6" onClick={generateText} disabled={!canGenerate || loading}>
              {loading ? <span className="btn-spinner border-white" /> : "Generate"}
            </button>
          </div>
        </div>

        {error && (
          <div className="p-3 bg-rose-50 border border-rose-100 rounded-lg text-sm text-rose-700">{error}</div>
        )}

        {text && (
          <div className="rounded-2xl border border-emerald-300 bg-[var(--bg-surface)] p-4 space-y-3">
            <textarea value={text} readOnly className="w-full min-h-[320px] rounded-xl border border-[var(--border-default)] bg-[var(--bg-body)] p-3 text-sm" />
            <div className="flex items-center justify-between gap-3">
              <p className={`text-sm ${copySuccess ? "text-emerald-600" : "text-[var(--text-secondary)]"}`}>
                {copySuccess ? "Copied." : "Thai text is ready to send in LINE or chat."}
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
