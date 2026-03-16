"use client";

import { useEffect, useState } from "react";
import type { DayUseSettings } from "@/lib/types";

type NoShowPaymentMethod = "cash" | "transfer" | "credit_card";

type DayUseCheckinSidebarProps = {
  roomId: string;
  roomNumber: string;
  onClose: () => void;
  onSuccess: () => void;
};

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

export function DayUseCheckinSidebar({
  roomId,
  roomNumber,
  onClose,
  onSuccess,
}: DayUseCheckinSidebarProps) {
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");

  const [settings, setSettings] = useState<DayUseSettings | null>(null);
  const [guestName, setGuestName] = useState("");
  const [phone, setPhone] = useState("");
  const [rate, setRate] = useState("0");
  const [paymentMethod, setPaymentMethod] = useState<NoShowPaymentMethod>("cash");
  const [paymentAmount, setPaymentAmount] = useState("0");
  const [note, setNote] = useState("");
  const [paymentNote, setPaymentNote] = useState("");
  const [showValidation, setShowValidation] = useState(false);

  useEffect(() => {
    let active = true;
    async function loadSettings() {
      setLoading(true);
      setError("");
      try {
        const res = await fetch("/api/dayuse/settings");
        const data = await res.json();
        if (!res.ok || !data.success) {
          throw new Error(data.error ?? "Failed to load day use settings.");
        }
        if (!active) return;
        const s = data.settings as DayUseSettings;
        setSettings(s);
        const defaultRate = round2(Number(s.dayuse_rate ?? 200));
        setRate(String(defaultRate));
        setPaymentAmount(String(defaultRate));
      } catch (err) {
        if (!active) return;
        setError(err instanceof Error ? err.message : "Network error.");
      } finally {
        if (active) setLoading(false);
      }
    }
    loadSettings();
    return () => {
      active = false;
    };
  }, []);

  async function handleSubmit() {
    setShowValidation(true);
    const parsedRate = round2(Number(rate));
    const parsedPayment = round2(Number(paymentAmount));
    if (!Number.isFinite(parsedRate) || parsedRate < 0) {
      setError("Invalid rate.");
      return;
    }
    if (!Number.isFinite(parsedPayment) || parsedPayment < 0) {
      setError("Invalid payment amount.");
      return;
    }

    setSubmitting(true);
    setError("");
    try {
      const res = await fetch("/api/dayuse/checkin", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          room_id: roomId,
          guest_name: guestName.trim(),
          phone: phone.trim(),
          rate: parsedRate,
          payment_method: paymentMethod,
          payment_amount: parsedPayment,
          payment_note: paymentNote.trim(),
          note: note.trim(),
        }),
      });
      const data = await res.json();
      if (!res.ok || !data.success) {
        setError(data.error ?? "Failed to check in day use guest.");
        return;
      }
      onSuccess();
    } catch {
      setError("Network error.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="fixed inset-0 z-[70] flex">
      <div className="absolute inset-0 bg-black/40" onClick={onClose} />
      <aside className="ml-auto h-full w-full max-w-md bg-[var(--bg-surface)] shadow-2xl relative z-[71] flex flex-col">
        <div className="border-b border-[var(--border-default)] px-5 py-4 flex items-center justify-between">
          <div>
            <p className="text-xs font-semibold uppercase tracking-widest text-rose-600">Day Use</p>
            <h3 className="text-lg font-bold text-[var(--text-primary)]">Walk-in Check In · Room {roomNumber}</h3>
          </div>
          <button className="btn btn-ghost btn-sm" onClick={onClose}>Close</button>
        </div>

        <div className="p-5 space-y-4 overflow-y-auto">
          {loading && (
            <div className="text-sm text-[var(--text-muted)]">Loading settings...</div>
          )}

          {!loading && (
            <>
              {error && (
                <div className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700">
                  {error}
                </div>
              )}

              <div>
                <label className="block text-xs font-semibold text-[var(--text-secondary)] mb-1">Room</label>
                <input className="form-input bg-[var(--bg-body)]" value={roomNumber} disabled />
              </div>

              <div>
                <label className="block text-xs font-semibold text-[var(--text-secondary)] mb-1">Guest Name (optional)</label>
                <input
                  className="form-input"
                  value={guestName}
                  onChange={(e) => setGuestName(e.target.value)}
                  placeholder="Leave blank for auto name"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-[var(--text-secondary)] mb-1">Phone (optional)</label>
                <input
                  className="form-input"
                  value={phone}
                  onChange={(e) => setPhone(e.target.value)}
                  placeholder="08x-xxx-xxxx"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-semibold text-[var(--text-secondary)] mb-1">Rate (THB)</label>
                  <input
                    type="number"
                    min={0}
                    step="0.01"
                    className="form-input"
                    value={rate}
                    onChange={(e) => {
                      setRate(e.target.value);
                      setPaymentAmount(e.target.value);
                    }}
                    required
                    aria-invalid={showValidation && (!Number.isFinite(Number(rate)) || Number(rate) < 0)}
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-[var(--text-secondary)] mb-1">Payment Amount (THB)</label>
                  <input
                    type="number"
                    min={0}
                    step="0.01"
                    className="form-input"
                    value={paymentAmount}
                    onChange={(e) => setPaymentAmount(e.target.value)}
                    required
                    aria-invalid={showValidation && (!Number.isFinite(Number(paymentAmount)) || Number(paymentAmount) < 0)}
                  />
                </div>
              </div>

              <div>
                <label className="block text-xs font-semibold text-[var(--text-secondary)] mb-1">Payment Method</label>
                <select
                  className="form-input"
                  value={paymentMethod}
                  onChange={(e) => setPaymentMethod(e.target.value as NoShowPaymentMethod)}
                >
                  <option value="cash">Cash</option>
                  <option value="transfer">Bank Transfer</option>
                  <option value="credit_card">Credit Card</option>
                </select>
              </div>

              <div>
                <label className="block text-xs font-semibold text-[var(--text-secondary)] mb-1">Payment Note (optional)</label>
                <input
                  className="form-input"
                  value={paymentNote}
                  onChange={(e) => setPaymentNote(e.target.value)}
                  placeholder="Cashier note / reference"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-[var(--text-secondary)] mb-1">Reservation Note (optional)</label>
                <textarea
                  className="form-input min-h-[80px]"
                  value={note}
                  onChange={(e) => setNote(e.target.value)}
                  placeholder="Internal note"
                />
              </div>

              {settings && (
                <p className="text-xs text-[var(--text-muted)]">
                  Default duration: {settings.dayuse_duration_min} min · Extend default: ฿{settings.dayuse_extend_rate} / {settings.dayuse_extend_min} min
                </p>
              )}
            </>
          )}
        </div>

        <div className="border-t border-[var(--border-default)] p-4 flex items-center justify-end gap-2">
          <button className="btn btn-secondary btn-sm" onClick={onClose} disabled={submitting}>Cancel</button>
          <button className="btn btn-primary btn-sm" onClick={handleSubmit} disabled={loading || submitting}>
            {submitting ? "Checking in..." : "Confirm Check In"}
          </button>
        </div>
      </aside>
    </div>
  );
}
